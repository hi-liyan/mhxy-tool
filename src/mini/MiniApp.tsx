/**
 * 置顶小窗：显示计时和收益，快速记梦幻币或常用物品。
 * 不直接读写数据，所有操作发给主窗口执行（见 src/desktop.ts）。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../storage";
import { EV, MAIN_LABEL, type MiniAction, type MiniCommand, type MiniResult, type MiniSnapshot } from "../desktop";
import { useNow } from "../store";
import { onlineAccounts } from "../sessionTime";
import { QUICK_WAN } from "../components/drops";
import { ItemIcon } from "../components/items";
import { WanInput, profitTone, useUi } from "../components/ui";
import { dropValue, fmtClock, fmtCoin, fmtTime, fromWan, sessionStats } from "../utils";

const RESULT_TIMEOUT = 3000;

export default function MiniApp() {
  const { toast } = useUi();
  const now = useNow(1000);
  const [snap, setSnap] = useState<MiniSnapshot | null>(null);
  const [coin, setCoin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const pending = useRef(new Map<number, (r: MiniResult) => void>());

  const focusInput = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const hideIfTransient = async () => {
    if (await desktop.miniIsTransient()) await desktop.miniHide();
  };

  useEffect(() => {
    if (!desktop.available) return;
    const offs: Promise<UnlistenFn>[] = [
      listen<MiniSnapshot>(EV.snapshot, (e) => setSnap(e.payload)),
      listen<MiniResult>(EV.result, (e) => {
        const resolve = pending.current.get(e.payload.id);
        if (!resolve) return;
        pending.current.delete(e.payload.id);
        resolve(e.payload);
      }),
      // 获得焦点时直接可以输入金额；快捷键临时呼出的小窗在点回游戏后自动隐藏
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) focusInput();
        else hideIfTransient().catch(() => {});
      }),
    ];
    Promise.all(offs).then(() => emitTo(MAIN_LABEL, EV.ready).catch(() => {}));
    return () => offs.forEach((p) => p.then((off) => off()));
  }, []);

  const send = (action: MiniAction) =>
    new Promise<MiniResult>((resolve) => {
      const id = ++seq.current;
      pending.current.set(id, resolve);
      const fail = (message: string) => {
        if (pending.current.delete(id)) resolve({ id, ok: false, message });
      };
      const cmd: MiniCommand = { ...action, id };
      emitTo(MAIN_LABEL, EV.command, cmd).catch((e) => fail(String(e)));
      setTimeout(() => fail("主窗口没有响应，请重新打开应用"), RESULT_TIMEOUT);
    });

  /** 执行操作并提示结果；hideAfter：成功后若是快捷键临时呼出的小窗则自动隐藏 */
  const act = async (action: MiniAction, hideAfter = false) => {
    const r = await send(action);
    if (r.message) toast(r.message, r.ok ? "ok" : "err");
    if (r.ok && hideAfter) await hideIfTransient().catch(() => {});
    return r.ok;
  };

  const addCoin = async () => {
    const v = fromWan(coin);
    if (!v) return toast("请输入梦幻币数量", "err");
    if (await act({ type: "coin", coins: v }, true)) setCoin("");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    desktop
      .miniIsTransient()
      .then((t) => (t ? desktop.miniHide() : inputRef.current?.blur()))
      .catch(() => {});
  };

  if (!desktop.available) {
    return <div className="mini boot muted">置顶小窗需要在桌面应用中使用</div>;
  }

  const active = snap?.active ?? null;
  const st = active ? sessionStats(active, now) : null;
  const today = (snap?.todayEndedProfit ?? 0) + (st?.profit ?? 0);
  const recent = active ? [...active.drops].sort((a, b) => b.time - a.time).slice(0, 3) : [];

  return (
    <div className="mini" data-tauri-drag-region="deep" onKeyDown={onKeyDown}>
      <header className="mini-head">
        {active ? <span className="live-dot" /> : <span className="mini-dot-off" />}
        <b className="mini-clock">{st ? fmtClock(st.duration) : "未上线"}</b>
        <span className="mini-spacer" />
        <button className="icon-btn" title="打开主窗口" onClick={() => act({ type: "openMain" })}>
          ↗
        </button>
        <button className="icon-btn" title="隐藏小窗" onClick={() => desktop.miniHide()}>
          ✕
        </button>
      </header>

      {!snap ? (
        <div className="mini-body muted small">正在连接主窗口…</div>
      ) : !active || !st ? (
        <div className="mini-body mini-idle">
          <div className="mini-kv">
            <span className="muted">今日净收益</span>
            <b className={profitTone(today)}>{fmtCoin(today)}</b>
          </div>
          <button className="btn primary" onClick={() => act({ type: "start" })}>
            开刷（默认上线的号）
          </button>
        </div>
      ) : (
        <div className="mini-body">
          <div className="mini-stats">
            <div>
              <span className="muted small">本场净收益</span>
              <b className={profitTone(st.profit)}>{fmtCoin(st.profit)}</b>
            </div>
            <div>
              <span className="muted small">
                {onlineAccounts(active).length}/{active.accounts.length} 号在线
              </span>
              <button className="link small" onClick={() => act({ type: "offline" })}>
                下线结算
              </button>
            </div>
          </div>

          <div className="row">
            <WanInput ref={inputRef} value={coin} onChange={setCoin} placeholder="获得多少万" autoFocus onEnter={addCoin} />
            <button className="btn primary" onClick={addCoin}>
              记录
            </button>
          </div>
          <div className="quick">
            {QUICK_WAN.map((w) => (
              <button key={w} className="chip" onClick={() => setCoin(String((parseFloat(coin) || 0) + w))}>
                +{w}万
              </button>
            ))}
          </div>

          {snap.quickItems.length > 0 ? (
            <div className="mini-items">
              {snap.quickItems.map((it) => (
                <button
                  key={it.id}
                  className="mini-item"
                  title={`${it.name} · ${fmtCoin(it.value)}，点击记录 1 个`}
                  onClick={() => act({ type: "item", itemId: it.id, qty: 1 }, true)}
                >
                  <ItemIcon item={it} size={30} />
                  <span>{it.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="muted small">在物品库给物品设置估值后，常用物品会出现在这里</div>
          )}

          <ul className="mini-recent">
            {recent.map((d, i) => (
              <li key={d.id}>
                <span className="muted">{fmtTime(d.time)}</span>
                <span className="title">{d.kind === "coin" ? "梦幻币" : `${d.itemName} ×${d.qty}`}</span>
                <span className="gain">+{fmtCoin(dropValue(d))}</span>
                {i === 0 && (
                  <button className="link small" onClick={() => act({ type: "undo", dropId: d.id })}>
                    撤销
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snap?.hotkeys.quickAdd && (
        <footer className="mini-foot muted small">
          {snap.hotkeys.quickAdd} 快速记账 · Esc 收起
        </footer>
      )}
    </div>
  );
}

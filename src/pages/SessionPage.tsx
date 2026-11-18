import { useEffect, useMemo, useState } from "react";
import type { Session, SessionAccount } from "../types";
import { useNow, useStore } from "../store";
import { DropForm, DropList } from "../components/drops";
import { Modal, Stat, profitTone, useUi } from "../components/ui";
import { useGoldRefresh } from "../components/gold";
import { desktop } from "../storage";
import { setAccountOnline, startSession } from "../sessionActions";
import { accountHours, isAccountOnline, lastLeaveAt, onlineAccounts } from "../sessionTime";
import {
  autoPoints,
  fmtClock,
  fmtCoin,
  fmtDateTime,
  fmtDuration,
  fmtPoints,
  fmtTime,
  fromLocalInput,
  resolveEnd,
  sessionStats,
  startOfToday,
  sumStats,
  toLocalInput,
} from "../utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function SessionPage({ offlineRequested, onOfflineHandled }: { offlineRequested: boolean; onOfflineHandled: () => void }) {
  const { db } = useStore();
  const active = db.sessions.find((s) => s.endAt === null);
  // 没有进行中的场次时无需结算
  useEffect(() => {
    if (offlineRequested && !active) onOfflineHandled();
  }, [offlineRequested, active, onOfflineHandled]);
  return active ? <ActiveSession session={active} offlineRequested={offlineRequested} onOfflineHandled={onOfflineHandled} /> : <StartPanel />;
}

function StartPanel() {
  const { db, update } = useStore();
  const { toast } = useUi();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(db.accounts.filter((a) => a.defaultSelected).map((a) => a.id)));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = () => {
    try {
      update((d) => void startSession(d, [...selected]));
      toast("开刷！祝你出神兜");
    } catch (e) {
      toast(errText(e), "err");
    }
  };

  const gold$ = useGoldRefresh();
  const n = selected.size;
  const hourPoints = n * db.settings.pointsPerHour;

  const today = useMemo(() => {
    const t0 = startOfToday();
    const list = db.sessions.filter((s) => s.endAt !== null && s.startAt >= t0);
    return { count: list.length, stats: sumStats(list.map((s) => sessionStats(s))) };
  }, [db.sessions]);

  const recent = useMemo(
    () =>
      db.sessions
        .filter((s) => s.endAt !== null)
        .sort((a, b) => b.startAt - a.startAt)
        .slice(0, 5),
    [db.sessions],
  );

  return (
    <div className="page">
      <h1>开刷</h1>

      <section className="card">
        <div className="card-head">
          <h2>选择本次上线的号</h2>
          <div className="actions">
            <button className="link" onClick={() => setSelected(new Set(db.accounts.map((a) => a.id)))}>
              全选
            </button>
            <button className="link" onClick={() => setSelected(new Set())}>
              清空
            </button>
          </div>
        </div>
        {db.accounts.length === 0 ? (
          <div className="empty">还没有账号，请到「设置」中添加</div>
        ) : (
          <div className="accounts">
            {db.accounts.map((a) => (
              <button key={a.id} className={`account ${selected.has(a.id) ? "on" : ""}`} onClick={() => toggle(a.id)}>
                <span className="check">{selected.has(a.id) ? "✓" : ""}</span>
                {a.name}
              </button>
            ))}
          </div>
        )}
        <div className="start-row">
          <div className="muted">
            {n} 个号 · 每小时约 {fmtPoints(hourPoints)} 点 ≈ {fmtCoin(hourPoints * db.settings.coinPerPoint)} 梦幻币
            <div className="small" style={{ marginTop: 4 }}>
              金价 1 元 = {fmtCoin(db.settings.goldPrice)}
              {db.settings.goldHistory[0] && `（${fmtDateTime(db.settings.goldHistory[0].time)} ${db.settings.goldHistory[0].source === "cbg" ? "藏宝阁" : "手动"}）`}
              {gold$.available && (
                <button className="link" style={{ marginLeft: 8 }} onClick={gold$.refresh} disabled={gold$.loading}>
                  {gold$.loading ? "获取中…" : "刷新金价"}
                </button>
              )}
            </div>
          </div>
          <button className="btn primary big" onClick={start} disabled={n === 0}>
            开刷
          </button>
        </div>
      </section>

      <section className="card">
        <h2>今日</h2>
        <div className="stats">
          <Stat label="场次" value={today.count} />
          <Stat label="在线时长" value={fmtDuration(today.stats.duration)} />
          <Stat label="点卡消耗" value={fmtCoin(today.stats.cost)} sub={`${fmtPoints(today.stats.points)} 点`} />
          <Stat label="总收入" value={fmtCoin(today.stats.income)} tone="gold" />
          <Stat label="净收益" value={fmtCoin(today.stats.profit)} tone={profitTone(today.stats.profit)} />
        </div>
      </section>

      {recent.length > 0 && (
        <section className="card">
          <h2>最近几次</h2>
          <table className="table">
            <thead>
              <tr>
                <th>上线时间</th>
                <th>时长</th>
                <th>号数</th>
                <th className="num">点卡</th>
                <th className="num">收入</th>
                <th className="num">净收益</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => {
                const st = sessionStats(s);
                return (
                  <tr key={s.id}>
                    <td>{fmtDateTime(s.startAt)}</td>
                    <td>{fmtDuration(st.duration)}</td>
                    <td>{s.accounts.length}</td>
                    <td className="num loss">-{fmtCoin(st.cost)}</td>
                    <td className="num">{fmtCoin(st.income)}</td>
                    <td className={`num ${profitTone(st.profit)}`}>{fmtCoin(st.profit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function ActiveSession({ session, offlineRequested, onOfflineHandled }: { session: Session; offlineRequested: boolean; onOfflineHandled: () => void }) {
  const { update } = useStore();
  const { confirm, toast } = useUi();
  const now = useNow(1000);
  const [offline, setOffline] = useState(false);
  const st = sessionStats(session, now);
  const online = onlineAccounts(session).length;

  // 托盘或小窗发起的下线结算
  useEffect(() => {
    if (!offlineRequested) return;
    setOffline(true);
    onOfflineHandled();
  }, [offlineRequested, onOfflineHandled]);

  const cancel = async () => {
    const ok = await confirm({
      title: "取消本次",
      message: "将删除本次上线记录（包括已记录的收入），不会保存到历史。确定吗？",
      okText: "删除本次",
      danger: true,
    });
    if (!ok) return;
    update((d) => {
      d.sessions = d.sessions.filter((s) => s.id !== session.id);
    });
    toast("已取消");
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <span className="live-dot" /> 正在刷
        </h1>
        <div className="actions">
          {desktop.available && (
            <button className="btn" onClick={() => desktop.miniShow().catch((e) => toast(errText(e), "err"))}>
              置顶小窗
            </button>
          )}
          <button className="btn ghost" onClick={cancel}>
            取消本次
          </button>
          <button className="btn danger big" onClick={() => setOffline(true)}>
            下线
          </button>
        </div>
      </div>

      <section className="card hero">
        <div className="clock">{fmtClock(st.duration)}</div>
        <div className="muted">
          {fmtDateTime(session.startAt)} 上线 · {online}/{session.accounts.length} 号在线
        </div>
        <div className="stats">
          <Stat label="点卡消耗" value={`${fmtPoints(st.points)} 点`} sub={`≈ ${fmtCoin(st.cost)} 梦幻币`} tone="loss" />
          <Stat label="梦幻币收入" value={fmtCoin(st.coinIncome)} tone="gold" />
          <Stat label="物品价值" value={fmtCoin(st.itemIncome)} tone="gold" />
          <Stat label="净收益" value={fmtCoin(st.profit)} tone={profitTone(st.profit)} />
        </div>
        <div className="muted small">
          计费：累计 {fmtPoints(accountHours(session, now))} 号·小时 × {fmtPoints(session.pointsPerHour)} 点，1 点 = {fmtCoin(session.coinPerPoint)} 梦幻币
        </div>
      </section>

      <SessionAccounts session={session} />

      <div className="two-col">
        <section className="card">
          <h2>记录收入</h2>
          <DropForm
            onAdd={(drop) =>
              update((d) => {
                d.sessions.find((s) => s.id === session.id)?.drops.push(drop);
              })
            }
          />
        </section>
        <section className="card">
          <h2>本次明细（{session.drops.length}）</h2>
          <DropList
            drops={session.drops}
            onRemove={(id) =>
              update((d) => {
                const s = d.sessions.find((x) => x.id === session.id);
                if (s) s.drops = s.drops.filter((x) => x.id !== id);
              })
            }
          />
        </section>
      </div>

      {offline && <OfflineModal session={session} onClose={() => setOffline(false)} />}
    </div>
  );
}

/** 场次中途让号下线、再上线或加号 */
function SessionAccounts({ session }: { session: Session }) {
  const { db, update } = useStore();
  const { toast } = useUi();
  const [adding, setAdding] = useState(false);
  const others = db.accounts.filter((a) => !session.accounts.some((x) => x.id === a.id));

  const toggle = (a: SessionAccount) => {
    const online = !isAccountOnline(a);
    try {
      update((d) => setAccountOnline(d, session.id, a.id, online));
      toast(`${a.name} 已${online ? "上线" : "下线"}`);
    } catch (e) {
      toast(errText(e), "err");
    }
  };

  const add = (id: string, name: string) => {
    try {
      update((d) => setAccountOnline(d, session.id, id, true));
      toast(`${name} 已加入本场`);
      if (others.length <= 1) setAdding(false);
    } catch (e) {
      toast(errText(e), "err");
    }
  };

  /** 中途上线或下线的时间 */
  const changedAt = (a: SessionAccount) => {
    const last = a.spans?.[a.spans.length - 1];
    if (!last) return null;
    if (last.to !== null) return `${fmtTime(last.to)} 下线`;
    return last.from !== null && last.from > session.startAt ? `${fmtTime(last.from)} 上线` : null;
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>上线的号</h2>
        {others.length > 0 && (
          <button className="link" onClick={() => setAdding((v) => !v)}>
            {adding ? "收起" : "＋ 中途加号"}
          </button>
        )}
      </div>
      <div className="accounts">
        {session.accounts.map((a) => {
          const on = isAccountOnline(a);
          const at = changedAt(a);
          return (
            <button key={a.id} className={`account ${on ? "on" : ""}`} onClick={() => toggle(a)} title={on ? "点击让这个号下线" : "点击让这个号重新上线"}>
              <span className="check">{on ? "✓" : ""}</span>
              {a.name}
              {at && <span className="account-at">{at}</span>}
            </button>
          );
        })}
      </div>
      {adding && (
        <div className="accounts add-accounts">
          {others.map((a) => (
            <button key={a.id} className="account" onClick={() => add(a.id, a.name)}>
              <span className="check">＋</span>
              {a.name}
            </button>
          ))}
        </div>
      )}
      <p className="muted small">点击切换上线 / 下线，点卡按每个号各自的在线时间计算；所有号都下线的时段不计入在线时长。</p>
    </section>
  );
}

function OfflineModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { update } = useStore();
  const { toast } = useUi();
  const now = useNow(1000);
  // 所有号都已下线时，默认下线时间取最后一个号下线的时刻
  const lastLeave = lastLeaveAt(session);
  // null 表示没改过：下线时间默认跟随当前时间（或最后一个号下线的时刻），确认时取精确时刻
  const [endInput, setEndInput] = useState<string | null>(null);
  const [pointsInput, setPointsInput] = useState("");
  const [note, setNote] = useState(session.note);

  const edited = endInput === null ? null : fromLocalInput(endInput);
  const endAt = endInput === null ? (lastLeave ?? now) : edited === null ? null : resolveEnd(session.startAt, edited);
  const endError = endAt === null ? "下线时间不能早于上线时间" : endAt > Date.now() + 60_000 ? "下线时间不能晚于现在" : null;
  const draft: Session = { ...session, endAt: endError ? now : endAt };
  const computed = autoPoints(draft);
  const override = pointsInput.trim() === "" ? null : parseFloat(pointsInput);
  draft.pointsOverride = override !== null && Number.isFinite(override) && override >= 0 ? override : null;
  const st = sessionStats(draft);

  const confirmOffline = () => {
    if (endError) return toast(endError, "err");
    const finalEnd = endInput === null ? (lastLeave ?? Date.now()) : endAt!;
    update((d) => {
      const s = d.sessions.find((x) => x.id === session.id);
      if (!s) return;
      s.endAt = finalEnd;
      s.pointsOverride = draft.pointsOverride;
      s.note = note.trim();
    });
    toast(`已下线，本次净收益 ${fmtCoin(st.profit)}`);
    onClose();
  };

  return (
    <Modal
      title="下线结算"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            继续刷
          </button>
          <button className="btn danger" onClick={confirmOffline}>
            确认下线
          </button>
        </>
      }
    >
      <div className="form">
        <div className="grid-2">
          <div className="field">
            <label>
              下线时间（默认{lastLeave === null ? "现在" : "最后一个号下线的时间"}，忘记点下线可以改）
              {endInput !== null && (
                <button className="link" style={{ marginLeft: 6 }} onClick={() => setEndInput(null)}>
                  恢复默认
                </button>
              )}
            </label>
            <input type="datetime-local" value={endInput ?? toLocalInput(lastLeave ?? now)} onChange={(e) => setEndInput(e.target.value)} />
            {endError && <span className="loss small">{endError}</span>}
          </div>
          <div className="field">
            <label>点卡消耗（点，留空按时长自动算）</label>
            <input type="number" min={0} step="any" placeholder={fmtPoints(computed)} value={pointsInput} onChange={(e) => setPointsInput(e.target.value)} />
          </div>
        </div>
        <div className="summary">
          <div>
            <span>在线时长</span>
            <b>{fmtDuration(st.duration)}</b>
          </div>
          <div>
            <span>号·小时（{session.accounts.length} 个号）</span>
            <b>{fmtPoints(accountHours(draft))}</b>
          </div>
          <div>
            <span>点卡消耗</span>
            <b className="loss">
              {fmtPoints(st.points)} 点 ≈ -{fmtCoin(st.cost)}
            </b>
          </div>
          <div>
            <span>梦幻币收入</span>
            <b className="gold">{fmtCoin(st.coinIncome)}</b>
          </div>
          <div>
            <span>物品价值</span>
            <b className="gold">{fmtCoin(st.itemIncome)}</b>
          </div>
          <div className="total">
            <span>净收益</span>
            <b className={profitTone(st.profit)}>{fmtCoin(st.profit)}</b>
          </div>
        </div>
        <div className="field">
          <label>备注</label>
          <input placeholder="例如：五开抓鬼 + 秘境" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

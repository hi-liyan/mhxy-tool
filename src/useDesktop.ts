/**
 * 主窗口专用：执行小窗 / 托盘发来的操作、把状态推给小窗、同步托盘提示、注册全局快捷键。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import type { DB, Hotkeys } from "./types";
import { useNow, useStore } from "./store";
import { useUi } from "./components/ui";
import { desktop } from "./storage";
import { EV, MINI_LABEL, buildMiniSnapshot, trayText, type MiniAction, type MiniCommand, type MiniResult } from "./desktop";
import { LedgerError, activeSession, addDrop, coinDrop, itemDrop, removeDrop, startSession } from "./sessionActions";
import { fmtCoin } from "./utils";

export type HotkeyErrors = Partial<Record<keyof Hotkeys, string>>;

/** 订阅 Tauri 事件，卸载时取消订阅 */
function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!desktop.available) return;
    const off: Promise<UnlistenFn> = listen<T>(event, (e) => ref.current(e.payload));
    return () => void off.then((f) => f());
  }, [event]);
}

// 快捷键注册是异步的，串行执行，避免 StrictMode 下重复挂载时互相覆盖
let hotkeyChain: Promise<void> = Promise.resolve();

export function useDesktop({ onOffline }: { onOffline: () => void }) {
  const { db, items, update } = useStore();
  const { toast } = useUi();
  const [hotkeyErrors, setHotkeyErrors] = useState<HotkeyErrors>({});
  const [hoverTick, setHoverTick] = useState(0);
  const now = useNow(30_000);

  const snapshot = useMemo(() => buildMiniSnapshot(db, items), [db, items]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // ---------- 状态推送给小窗 ----------
  useEffect(() => {
    if (desktop.available) emitTo(MINI_LABEL, EV.snapshot, snapshot).catch(() => {});
  }, [snapshot]);
  useTauriEvent(EV.ready, () => {
    emitTo(MINI_LABEL, EV.snapshot, snapshotRef.current).catch(() => {});
  });

  // ---------- 执行操作 ----------
  /** 执行一次操作，返回提示文字；校验失败时抛出 LedgerError */
  const run = (cmd: MiniAction): string => {
    const inSession = (fn: (d: DB, sessionId: string) => void) =>
      update((d) => {
        const s = activeSession(d);
        if (!s) throw new LedgerError("当前未上线");
        fn(d, s.id);
      });
    switch (cmd.type) {
      case "coin":
        inSession((d, sid) => addDrop(d, sid, coinDrop(cmd.coins)));
        return `已记录 ${fmtCoin(cmd.coins)} 梦幻币`;
      case "item": {
        const it = itemsRef.current.find((x) => x.id === cmd.itemId && x.origin === "user");
        if (!it) throw new LedgerError("物品不存在");
        if (it.value <= 0) throw new LedgerError("该物品还没有估值，请在主窗口记录");
        inSession((d, sid) => addDrop(d, sid, itemDrop(it, cmd.qty)));
        return `已记录 ${it.name} ×${cmd.qty}`;
      }
      case "undo":
        inSession((d, sid) => removeDrop(d, sid, cmd.dropId));
        return "已撤销";
      case "start":
        update((d) => void startSession(d));
        return "开刷！祝你出神兜";
      case "offline":
        onOffline();
        return "";
      case "openMain":
        desktop.mainShow().catch(() => {});
        return "";
    }
  };

  useTauriEvent<MiniCommand>(EV.command, (cmd) => {
    let result: MiniResult;
    try {
      result = { id: cmd.id, ok: true, message: run(cmd) };
    } catch (e) {
      result = { id: cmd.id, ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    emitTo(MINI_LABEL, EV.result, result).catch(() => {});
  });

  useTauriEvent<string>(EV.trayAction, (action) => {
    if (action === "offline") return onOffline();
    if (action !== "start") return;
    try {
      toast(run({ type: "start" }));
    } catch (e) {
      // 托盘操作没有其他反馈渠道，失败时打开主窗口提示
      desktop.mainShow().catch(() => {});
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  });

  // ---------- 托盘 ----------
  useTauriEvent(EV.trayHover, () => setHoverTick((n) => n + 1));
  useEffect(() => {
    if (!desktop.available) return;
    const t = trayText(db);
    desktop.trayUpdate(t.status, t.tooltip, t.active).catch(() => {});
  }, [db, now, hoverTick]);

  // ---------- 全局快捷键 ----------
  const { quickAdd, toggleMini } = db.settings.hotkeys;
  useEffect(() => {
    if (!desktop.available) return;
    let cancelled = false;
    const actions: [keyof Hotkeys, string | null, () => Promise<void>][] = [
      ["quickAdd", quickAdd, () => desktop.miniShow(true)],
      ["toggleMini", toggleMini, () => desktop.miniToggle()],
    ];
    hotkeyChain = hotkeyChain.then(async () => {
      if (cancelled) return;
      await unregisterAll().catch(() => {});
      const errors: HotkeyErrors = {};
      for (const [key, accel, action] of actions) {
        if (!accel) continue;
        try {
          await register(accel, (e) => {
            if (e.state === "Pressed") action().catch(() => {});
          });
        } catch (e) {
          errors[key] = `注册失败，可能已被其他程序占用（${String(e)}）`;
        }
      }
      if (!cancelled) setHotkeyErrors(errors);
    });
    return () => {
      cancelled = true;
    };
  }, [quickAdd, toggleMini]);

  return { hotkeyErrors };
}

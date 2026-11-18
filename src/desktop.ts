/**
 * 主窗口与置顶小窗、托盘之间的事件约定。
 * 记账数据只由主窗口读写：小窗和托盘发命令给主窗口，主窗口执行后把快照推给小窗。
 */
import type { DB, Hotkeys, Item, Session } from "./types";
import { onlineAccounts } from "./sessionTime";
import { fmtCoin, fmtDuration, itemCounts, sessionStats, startOfToday } from "./utils";

export const MINI_LABEL = "mini";
export const MAIN_LABEL = "main";

export const EV = {
  /** 主窗口 → 小窗：最新状态 */
  snapshot: "mini-snapshot",
  /** 小窗 → 主窗口：小窗已加载，请求状态 */
  ready: "mini-ready",
  /** 小窗 → 主窗口：执行操作 */
  command: "mini-command",
  /** 主窗口 → 小窗：操作结果 */
  result: "mini-result",
  /** Rust → 主窗口：托盘菜单操作（start / offline） */
  trayAction: "tray-action",
  /** Rust → 主窗口：鼠标悬停托盘图标 */
  trayHover: "tray-hover",
} as const;

export interface QuickItem {
  id: string;
  name: string;
  value: number;
  image?: string;
}

export interface MiniSnapshot {
  active: Session | null;
  /** 今日已下线场次的净收益（进行中的场次由小窗实时计算） */
  todayEndedProfit: number;
  quickItems: QuickItem[];
  hotkeys: Hotkeys;
}

export type MiniAction =
  | { type: "coin"; coins: number }
  | { type: "item"; itemId: string; qty: number }
  | { type: "undo"; dropId: string }
  | { type: "start" }
  | { type: "offline" }
  | { type: "openMain" };

/** id 用于把执行结果对应回小窗的请求 */
export type MiniCommand = MiniAction & { id: number };

export interface MiniResult {
  id: number;
  ok: boolean;
  message: string;
}

const QUICK_ITEM_COUNT = 8;

/** 小窗可快速记录的物品：已设估值的用户物品，按累计获得数量取前几个 */
export function quickItems(db: DB, items: Item[]): QuickItem[] {
  const counts = itemCounts(db.sessions);
  return items
    .filter((it) => it.origin === "user" && it.value > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, "zh"))
    .slice(0, QUICK_ITEM_COUNT)
    .map(({ id, name, value, image }) => ({ id, name, value, image }));
}

export function todayEndedProfit(db: DB): number {
  const t0 = startOfToday();
  return db.sessions.filter((s) => s.endAt !== null && s.startAt >= t0).reduce((sum, s) => sum + sessionStats(s).profit, 0);
}

export function buildMiniSnapshot(db: DB, items: Item[]): MiniSnapshot {
  return {
    active: db.sessions.find((s) => s.endAt === null) ?? null,
    todayEndedProfit: todayEndedProfit(db),
    quickItems: quickItems(db, items),
    hotkeys: db.settings.hotkeys,
  };
}

const signed = (n: number) => (n > 0 ? "+" : "") + fmtCoin(n);

/** 托盘菜单状态行与悬停提示 */
export function trayText(db: DB, now = Date.now()): { status: string; tooltip: string; active: boolean } {
  const active = db.sessions.find((s) => s.endAt === null);
  if (!active) {
    const today = todayEndedProfit(db);
    return { status: "未上线", tooltip: `梦幻记账\n未上线 · 今日净收益 ${signed(today)}`, active: false };
  }
  const st = sessionStats(active, now);
  const online = onlineAccounts(active).length;
  const line = `正在刷 ${fmtDuration(st.duration)} · ${online} 号在线`;
  return { status: line, tooltip: `梦幻记账\n${line}\n本场净收益 ${signed(st.profit)}`, active: true };
}

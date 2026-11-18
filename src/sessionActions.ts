/**
 * 对草稿 DB 的修改操作，供主界面、置顶小窗、托盘和快捷键共用。
 * 在 update((d) => ...) 内调用；校验失败时抛出 LedgerError，update 不会提交任何修改。
 */
import type { CoinDrop, DB, Item, ItemDrop, Session } from "./types";
import { isAccountOnline, markOffline, markOnline } from "./sessionTime";
import { uid } from "./utils";

export class LedgerError extends Error {}

export function activeSession(d: DB): Session | undefined {
  return d.sessions.find((s) => s.endAt === null);
}

function requireSession(d: DB, sessionId: string): Session {
  const s = d.sessions.find((x) => x.id === sessionId);
  if (!s) throw new LedgerError("场次不存在");
  return s;
}

/** 开刷；不指定账号时使用设置中默认勾选的号 */
export function startSession(d: DB, accountIds?: string[], at = Date.now()): Session {
  if (activeSession(d)) throw new LedgerError("已经在刷了");
  const ids = new Set(accountIds ?? d.accounts.filter((a) => a.defaultSelected).map((a) => a.id));
  const accounts = d.accounts.filter((a) => ids.has(a.id)).map((a) => ({ id: a.id, name: a.name }));
  if (accounts.length === 0) throw new LedgerError(accountIds ? "至少选择一个号" : "没有默认上线的号，请在主窗口选择");
  const s: Session = {
    id: uid(),
    startAt: at,
    endAt: null,
    accounts,
    pointsPerHour: d.settings.pointsPerHour,
    coinPerPoint: d.settings.coinPerPoint,
    pointsOverride: null,
    drops: [],
    note: "",
  };
  d.sessions.push(s);
  return s;
}

export function coinDrop(coins: number, time = Date.now(), note?: string): CoinDrop {
  if (!(coins > 0)) throw new LedgerError("请输入梦幻币数量");
  return { id: uid(), time, kind: "coin", coins, note };
}

export function itemDrop(item: Item, qty: number, unitValue = item.value, time = Date.now(), note?: string): ItemDrop {
  if (!Number.isInteger(qty) || qty <= 0) throw new LedgerError("数量不正确");
  return { id: uid(), time, kind: "item", itemId: item.id, itemName: item.name, qty, unitValue, note };
}

export function addDrop(d: DB, sessionId: string, drop: CoinDrop | ItemDrop): void {
  requireSession(d, sessionId).drops.push(drop);
}

export function removeDrop(d: DB, sessionId: string, dropId: string): void {
  const s = requireSession(d, sessionId);
  s.drops = s.drops.filter((x) => x.id !== dropId);
}

/** 场次进行中让号上线 / 下线；不在本场的号上线即为中途加号 */
export function setAccountOnline(d: DB, sessionId: string, accountId: string, online: boolean, at = Date.now()): void {
  const s = requireSession(d, sessionId);
  if (s.endAt !== null) throw new LedgerError("场次已结束");
  const a = s.accounts.find((x) => x.id === accountId);
  if (!a) {
    if (!online) return;
    const src = d.accounts.find((x) => x.id === accountId);
    if (!src) throw new LedgerError("账号不存在");
    s.accounts.push({ id: src.id, name: src.name, spans: [{ from: at, to: null }] });
    return;
  }
  if (online === isAccountOnline(a)) return;
  if (online) markOnline(a, at);
  else markOffline(a, at);
}

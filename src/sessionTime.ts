/**
 * 场次在线时间计算：支持场次中途让部分号下线、再上线或加号。
 * 纯函数、无运行时依赖（可直接用 node --experimental-strip-types 测试）。
 */
import type { Session, SessionAccount } from "./types";

export type Interval = [number, number];

/** 场次的计时窗口 [上线, 下线或现在] */
export function sessionWindow(s: Session, now = Date.now()): Interval {
  const end = Math.max(s.startAt, s.endAt ?? now);
  return [s.startAt, end];
}

/** 某个号的在线区间，已夹到场次窗口内并去掉空区间 */
export function resolveSpans(s: Session, a: SessionAccount, now = Date.now()): Interval[] {
  const [start, end] = sessionWindow(s, now);
  if (!a.spans) return end > start ? [[start, end]] : [];
  const out: Interval[] = [];
  for (const sp of a.spans) {
    const from = Math.max(start, sp.from ?? start);
    const to = Math.min(end, sp.to ?? end);
    if (to > from) out.push([from, to]);
  }
  return out;
}

/** 合并重叠区间 */
export function unionIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const length = (list: Interval[]) => list.reduce((sum, [a, b]) => sum + (b - a), 0);

/** 某个号在本场的在线毫秒数 */
export function accountOnlineMs(s: Session, a: SessionAccount, now = Date.now()): number {
  return length(resolveSpans(s, a, now));
}

/** 在线时长：至少有一个号在线的时间（所有号都下线的时段不计入） */
export function sessionDuration(s: Session, now = Date.now()): number {
  return length(unionIntervals(s.accounts.flatMap((a) => resolveSpans(s, a, now))));
}

/** 号·小时：各号在线时长之和 */
export function accountHours(s: Session, now = Date.now()): number {
  return s.accounts.reduce((sum, a) => sum + accountOnlineMs(s, a, now), 0) / 3_600_000;
}

/** 号当前（进行中的场次）或下线时（已结束的场次）是否在线：最后一段没有结束时间 */
export function isAccountOnline(a: SessionAccount): boolean {
  if (!a.spans || a.spans.length === 0) return !a.spans;
  return a.spans[a.spans.length - 1].to === null;
}

export function onlineAccounts(s: Session): SessionAccount[] {
  return s.accounts.filter(isAccountOnline);
}

/** 最后一个号下线的时刻；仍有号在线或没有明确下线时间时返回 null */
export function lastLeaveAt(s: Session): number | null {
  if (s.accounts.length === 0 || s.accounts.some(isAccountOnline)) return null;
  let last: number | null = null;
  for (const a of s.accounts) {
    const to = a.spans?.[a.spans.length - 1]?.to ?? null;
    if (to !== null && (last === null || to > last)) last = to;
  }
  return last;
}

/** 让号在 at 时刻下线（就地修改） */
export function markOffline(a: SessionAccount, at: number): void {
  if (!isAccountOnline(a)) return;
  if (!a.spans) a.spans = [{ from: null, to: at }];
  else a.spans[a.spans.length - 1].to = at;
}

/** 让号在 at 时刻上线（就地修改） */
export function markOnline(a: SessionAccount, at: number): void {
  if (isAccountOnline(a)) return;
  (a.spans ??= []).push({ from: at, to: null });
}

/** 号的上下线变化，用于时间线展示（不含场次开始/结束本身） */
export function accountEvents(s: Session, a: SessionAccount): { at: number; online: boolean }[] {
  if (!a.spans) return [];
  const out: { at: number; online: boolean }[] = [];
  for (const sp of a.spans) {
    if (sp.from !== null && sp.from > s.startAt) out.push({ at: sp.from, online: true });
    if (sp.to !== null && (s.endAt === null || sp.to < s.endAt)) out.push({ at: sp.to, online: false });
  }
  return out;
}

/**
 * 统计分析：按周期分桶、收益拆分、偶然高价值掉落识别。
 * 纯函数，不依赖 React。
 */
import type { Drop, ItemDrop, Session } from "./types";
import { sessionStats } from "./utils";

export type Granularity = "day" | "week" | "month";
export type RangeKey = "30d" | "90d" | "1y" | "all";

export const RANGES: { key: RangeKey; label: string; gran: Granularity }[] = [
  { key: "30d", label: "近 30 天", gran: "day" },
  { key: "90d", label: "近 90 天", gran: "week" },
  { key: "1y", label: "近一年", gran: "month" },
  { key: "all", label: "全部", gran: "month" },
];

export const GRANS: { key: Granularity; label: string }[] = [
  { key: "day", label: "按日" },
  { key: "week", label: "按周" },
  { key: "month", label: "按月" },
];

// ---------- 时间 ----------

function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 周期起点：日 0 点 / 周一 0 点 / 每月 1 日 0 点 */
export function bucketStart(ms: number, g: Granularity): number {
  const d = new Date(dayStart(ms));
  if (g === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (g === "month") d.setDate(1);
  return d.getTime();
}

export function nextBucket(start: number, g: Granularity): number {
  const d = new Date(start);
  if (g === "day") d.setDate(d.getDate() + 1);
  else if (g === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/** 统计区间 [from, to)，from 对齐到周期起点，保证每个桶都是完整周期 */
export function rangeBounds(key: RangeKey, g: Granularity, sessions: Session[], now = Date.now()): [number, number] {
  const to = addDays(dayStart(now), 1);
  let from: number;
  if (key === "30d") from = addDays(to, -30);
  else if (key === "90d") from = addDays(to, -90);
  else if (key === "1y") from = addDays(to, -365);
  else from = sessions.length ? Math.min(...sessions.map((s) => s.startAt)) : addDays(to, -1);
  return [bucketStart(from, g), to];
}

const pad = (n: number) => String(n).padStart(2, "0");
const md = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function bucketLabels(start: number, end: number, g: Granularity): { label: string; fullLabel: string } {
  const d = new Date(start);
  if (g === "day") {
    const wd = "日一二三四五六"[d.getDay()];
    return { label: md(start), fullLabel: `${d.getFullYear()}/${md(start)} 周${wd}` };
  }
  if (g === "week") return { label: md(start), fullLabel: `${md(start)} – ${md(addDays(end, -1))}` };
  return { label: `${d.getMonth() + 1}月`, fullLabel: `${d.getFullYear()}年${pad(d.getMonth() + 1)}月` };
}

// ---------- 偶然高价值 ----------

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** 自动阈值：所有已结束场次总收入的中位数（"一场的典型收入"） */
export function autoThreshold(sessions: Session[]): number {
  const incomes = sessions
    .filter((s) => s.endAt !== null)
    .map((s) => sessionStats(s).income)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  return incomes.length ? median(incomes) : Infinity;
}

/** 单件估值达到阈值的物品掉落视为偶然高价值 */
export function isWindfall(d: Drop, threshold: number): boolean {
  return d.kind === "item" && d.unitValue > 0 && d.unitValue >= threshold;
}

// ---------- 汇总 ----------

export interface Breakdown {
  count: number;
  duration: number;
  points: number;
  cost: number;
  coin: number;
  /** 常规物品收益 */
  regular: number;
  /** 偶然高价值物品收益 */
  windfall: number;
  income: number;
  profit: number;
  /** 剔除偶然收益后的净收益 */
  stable: number;
}

export function breakdown(sessions: Session[], threshold: number): Breakdown {
  const b: Breakdown = { count: 0, duration: 0, points: 0, cost: 0, coin: 0, regular: 0, windfall: 0, income: 0, profit: 0, stable: 0 };
  for (const s of sessions) {
    const st = sessionStats(s);
    b.count += 1;
    b.duration += st.duration;
    b.points += st.points;
    b.cost += st.cost;
    for (const d of s.drops) {
      if (d.kind === "coin") b.coin += d.coins;
      else if (isWindfall(d, threshold)) b.windfall += d.qty * d.unitValue;
      else b.regular += d.qty * d.unitValue;
    }
  }
  b.income = b.coin + b.regular + b.windfall;
  b.profit = b.income - b.cost;
  b.stable = b.profit - b.windfall;
  return b;
}

/** 每小时收益，没有在线时长时返回 null */
export function perHour(value: number, duration: number): number | null {
  return duration > 0 ? value / (duration / 3_600_000) : null;
}

export interface Bucket extends Breakdown {
  start: number;
  end: number;
  label: string;
  fullLabel: string;
}

export function inRange(sessions: Session[], from: number, to: number): Session[] {
  return sessions.filter((s) => s.endAt !== null && s.startAt >= from && s.startAt < to);
}

export function buildBuckets(sessions: Session[], from: number, to: number, g: Granularity, threshold: number): Bucket[] {
  const list: Bucket[] = [];
  for (let start = bucketStart(from, g); start < to; start = nextBucket(start, g)) {
    const end = nextBucket(start, g);
    list.push({ start, end, ...bucketLabels(start, end, g), ...breakdown(inRange(sessions, start, end), threshold) });
  }
  return list;
}

// ---------- 物品 ----------

export interface ItemStat {
  itemId: string;
  name: string;
  qty: number;
  value: number;
  /** 出现过该物品的场次数 */
  sessionHits: number;
  /** 出现率 = sessionHits / 区间内场次数 */
  rate: number;
  windfall: boolean;
}

export function itemStats(sessions: Session[], threshold: number): ItemStat[] {
  const m = new Map<string, ItemStat>();
  for (const s of sessions) {
    const seen = new Set<string>();
    for (const d of s.drops) {
      if (d.kind !== "item") continue;
      const e = m.get(d.itemId) ?? { itemId: d.itemId, name: d.itemName, qty: 0, value: 0, sessionHits: 0, rate: 0, windfall: false };
      e.qty += d.qty;
      e.value += d.qty * d.unitValue;
      e.windfall ||= isWindfall(d, threshold);
      if (!seen.has(d.itemId)) {
        e.sessionHits += 1;
        seen.add(d.itemId);
      }
      m.set(d.itemId, e);
    }
  }
  const n = sessions.length || 1;
  return [...m.values()].map((e) => ({ ...e, rate: e.sessionHits / n })).sort((a, b) => b.value - a.value);
}

export interface WindfallEvent {
  drop: ItemDrop;
  session: Session;
  value: number;
  /** 占当场总收入的比例 */
  shareOfSession: number;
}

export function windfallEvents(sessions: Session[], threshold: number): WindfallEvent[] {
  const out: WindfallEvent[] = [];
  for (const s of sessions) {
    const income = sessionStats(s).income;
    for (const d of s.drops) {
      if (d.kind !== "item" || !isWindfall(d, threshold)) continue;
      const value = d.qty * d.unitValue;
      out.push({ drop: d, session: s, value, shareOfSession: income > 0 ? value / income : 0 });
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

import type { Drop, Session } from "./types";

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const WAN = 10_000;
const YI = 100_000_000;

/** 保留 digits 位小数并去掉小数部分末尾的 0（整数不受影响：4130 不能变成 413） */
function trimNum(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 梦幻币友好显示：1234万 / 1.23亿 */
export function fmtCoin(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 && Math.round(a) > 0 ? "-" : "";
  if (a >= YI) return sign + trimNum(a / YI, 2) + "亿";
  if (a >= WAN) return sign + trimNum(a / WAN, a >= 1_000 * WAN ? 0 : 1) + "万";
  return sign + Math.round(a).toString();
}

/** 原始梦幻币 → "万" 输入框的值 */
export function toWan(n: number): string {
  return trimNum(n / WAN, 4);
}

/** "万" 输入框的值 → 原始梦幻币，非法返回 null */
export function fromWan(s: string): number | null {
  const v = parseFloat(s);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * WAN);
}

export function fmtPoints(n: number): string {
  return trimNum(n, 1);
}

/** 计时器格式 H:MM:SS */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 时长文字 2小时15分 */
export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}分钟`;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 用于 <input type="datetime-local"> */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(s: string): number | null {
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

export function stampNow(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------- 场次计算 ----------

export function sessionDuration(s: Session, now = Date.now()): number {
  return Math.max(0, (s.endAt ?? now) - s.startAt);
}

/** 按时长自动计算的点卡消耗 */
export function autoPoints(s: Session, now = Date.now()): number {
  const hours = sessionDuration(s, now) / 3_600_000;
  return hours * s.accounts.length * s.pointsPerHour;
}

export function sessionPoints(s: Session, now = Date.now()): number {
  return s.pointsOverride ?? autoPoints(s, now);
}

export function dropValue(d: Drop): number {
  return d.kind === "coin" ? d.coins : d.qty * d.unitValue;
}

export interface SessionStats {
  duration: number;
  points: number;
  cost: number;
  coinIncome: number;
  itemIncome: number;
  income: number;
  profit: number;
}

export function sessionStats(s: Session, now = Date.now()): SessionStats {
  const points = sessionPoints(s, now);
  const cost = points * s.coinPerPoint;
  let coinIncome = 0;
  let itemIncome = 0;
  for (const d of s.drops) {
    if (d.kind === "coin") coinIncome += d.coins;
    else itemIncome += d.qty * d.unitValue;
  }
  const income = coinIncome + itemIncome;
  return {
    duration: sessionDuration(s, now),
    points,
    cost,
    coinIncome,
    itemIncome,
    income,
    profit: income - cost,
  };
}

export function sumStats(list: SessionStats[]): SessionStats {
  const acc: SessionStats = { duration: 0, points: 0, cost: 0, coinIncome: 0, itemIncome: 0, income: 0, profit: 0 };
  for (const s of list) {
    acc.duration += s.duration;
    acc.points += s.points;
    acc.cost += s.cost;
    acc.coinIncome += s.coinIncome;
    acc.itemIncome += s.itemIncome;
    acc.income += s.income;
    acc.profit += s.profit;
  }
  return acc;
}

// ---------- 图片 ----------

/** 把图片缩放到 max 像素内并转成 PNG dataURL，避免数据文件过大 */
export function resizeImage(file: Blob, max = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("无法处理图片"));
        return;
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

// ---------- 时间输入（datetime-local 只精确到分钟） ----------

const MINUTE = 60_000;
const minuteOf = (ms: number) => Math.floor(ms / MINUTE);

/** 输入的下线时间：与上线同一分钟视为合法（夹到上线时刻）；早于上线所在分钟返回 null */
export function resolveEnd(start: number, end: number): number | null {
  if (minuteOf(end) < minuteOf(start)) return null;
  return Math.max(end, start);
}

/** 输入的上线时间：与下线同一分钟视为合法（夹到下线时刻）；晚于下线所在分钟返回 null */
export function resolveStart(start: number, end: number): number | null {
  if (minuteOf(start) > minuteOf(end)) return null;
  return Math.min(start, end);
}

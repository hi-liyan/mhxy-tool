/**
 * 战报分享图：汇总场次数据并用 Canvas 绘制成 PNG。
 * 颜色取自 styles.css 的 CSS 变量，高价值掉落沿用图表配色 VIZ.windfall。
 */
import type { Item, Session } from "./types";
import { itemStats, perHour } from "./analysis";
import { accountHours } from "./sessionTime";
import { VIZ } from "./components/charts";
import { fmtCoin, fmtDateTime, fmtDuration, fmtPoints, sessionStats, sumStats } from "./utils";

export interface ReportOptions {
  /** 显示账号名（单场战报） */
  showAccounts: boolean;
  /** 显示出货明细 */
  showItems: boolean;
}

export interface ReportItem {
  name: string;
  qty: number;
  value: number;
  image?: string;
  windfall: boolean;
}

export interface ReportData {
  title: string;
  rangeText: string;
  profit: number;
  hourly: number | null;
  duration: number;
  count: number;
  accountHours: number;
  cost: number;
  coinIncome: number;
  itemIncome: number;
  accounts: string[] | null;
  items: ReportItem[];
  moreItems: number;
}

const MAX_ITEMS = 6;

export function buildReport(
  { title, rangeText, sessions, single }: { title: string; rangeText: string; sessions: Session[]; single: boolean },
  items: Item[],
  threshold: number,
  opts: ReportOptions,
): ReportData {
  const total = sumStats(sessions.map((s) => sessionStats(s)));
  const stats = opts.showItems ? itemStats(sessions, threshold) : [];
  return {
    title,
    rangeText,
    profit: total.profit,
    hourly: perHour(total.profit, total.duration),
    duration: total.duration,
    count: sessions.length,
    accountHours: sessions.reduce((sum, s) => sum + accountHours(s), 0),
    cost: total.cost,
    coinIncome: total.coinIncome,
    itemIncome: total.itemIncome,
    accounts: single && opts.showAccounts ? sessions[0].accounts.map((a) => a.name) : null,
    items: stats.slice(0, MAX_ITEMS).map((it) => ({
      name: it.name,
      qty: it.qty,
      value: it.value,
      image: items.find((x) => x.id === it.itemId)?.image,
      windfall: it.windfall,
    })),
    moreItems: Math.max(0, stats.length - MAX_ITEMS),
  };
}

// ---------- 绘制 ----------

const W = 750;
const PAD = 32;
const SCALE = 2;

function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v("--bg"),
    panel: v("--panel"),
    panel2: v("--panel-2"),
    line: v("--line"),
    lineStrong: v("--line-strong"),
    gold: v("--gold"),
    goldLight: v("--gold-light"),
    goldPale: v("--gold-pale"),
    red: v("--red"),
    redDark: v("--red-dark"),
    text: v("--text"),
    muted: v("--muted"),
    gain: v("--gain"),
    loss: v("--loss"),
    kai: v("--font-kai"),
    sans: css.fontFamily,
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function ellipsis(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}

const signed = (n: number) => (n > 0 ? "+" : "") + fmtCoin(n);

export async function renderReport(data: ReportData): Promise<Blob> {
  const c = palette();
  await document.fonts.ready;
  const icons = await Promise.all(data.items.map((it) => (it.image ? loadImage(it.image) : Promise.resolve(null))));

  const HEADER = 112;
  const HERO = 132;
  const TILE_H = 76;
  const GRID = TILE_H * 2 + 12;
  const ACCOUNTS = data.accounts ? 40 : 0;
  const ROW = 52;
  const itemsH = data.items.length ? 48 + data.items.length * ROW + (data.moreItems ? 28 : 0) : 0;
  const FOOT = 56;
  const H = PAD + HEADER + HERO + GRID + ACCOUNTS + (itemsH ? 20 + itemsH : 0) + FOOT + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法生成图片");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  // 宣纸底 + 描金边框
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = c.panel;
  ctx.strokeStyle = c.lineStrong;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(PAD / 2, PAD / 2, W - PAD, H - PAD, 16);
  ctx.fill();
  ctx.stroke();

  const x0 = PAD;
  const inner = W - PAD * 2;
  let y = PAD;

  // 朱红标题栏
  const grad = ctx.createLinearGradient(0, y, 0, y + HEADER - 16);
  grad.addColorStop(0, c.red);
  grad.addColorStop(1, c.redDark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x0, y, inner, HEADER - 16, 12);
  ctx.fill();
  ctx.strokeStyle = c.goldLight;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0 + 5, y + 5, inner - 10, HEADER - 26, 9);
  ctx.stroke();
  ctx.fillStyle = c.goldLight;
  ctx.font = `700 34px ${c.kai}`;
  ctx.textAlign = "left";
  ctx.fillText(data.title, x0 + 28, y + 52);
  ctx.fillStyle = c.goldPale;
  ctx.font = `15px ${c.sans}`;
  ctx.fillText(data.rangeText, x0 + 28, y + 80);
  ctx.textAlign = "right";
  ctx.font = `700 18px ${c.kai}`;
  ctx.fillText("梦幻记账", x0 + inner - 28, y + 52);
  ctx.textAlign = "left";
  y += HEADER;

  // 净收益
  ctx.fillStyle = c.muted;
  ctx.font = `16px ${c.sans}`;
  ctx.fillText("净收益", x0 + 8, y + 26);
  ctx.fillStyle = data.profit >= 0 ? c.gain : c.loss;
  ctx.font = `700 56px ${c.sans}`;
  ctx.fillText(signed(data.profit), x0 + 4, y + 92);
  ctx.textAlign = "right";
  ctx.fillStyle = c.muted;
  ctx.font = `16px ${c.sans}`;
  ctx.fillText("平均每小时", x0 + inner - 8, y + 50);
  ctx.fillStyle = data.hourly !== null && data.hourly < 0 ? c.loss : c.text;
  ctx.font = `700 26px ${c.sans}`;
  ctx.fillText(data.hourly === null ? "—" : signed(data.hourly), x0 + inner - 8, y + 88);
  ctx.textAlign = "left";
  y += HERO;

  // 指标格
  const tiles: [string, string, string?][] = [
    ["在线时长", fmtDuration(data.duration)],
    ["场次", `${data.count} 场`],
    ["号·小时", fmtPoints(data.accountHours)],
    ["点卡消耗", `-${fmtCoin(data.cost)}`, c.loss],
    ["梦幻币收入", fmtCoin(data.coinIncome), c.gold],
    ["物品价值", fmtCoin(data.itemIncome), c.gold],
  ];
  const tw = (inner - 24) / 3;
  tiles.forEach(([label, value, color], i) => {
    const tx = x0 + (i % 3) * (tw + 12);
    const ty = y + Math.floor(i / 3) * (TILE_H + 12);
    ctx.fillStyle = c.panel2;
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, TILE_H, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.muted;
    ctx.font = `14px ${c.sans}`;
    ctx.fillText(label, tx + 16, ty + 28);
    ctx.fillStyle = color ?? c.text;
    ctx.font = `700 22px ${c.sans}`;
    ctx.fillText(ellipsis(ctx, value, tw - 32), tx + 16, ty + 58);
  });
  y += GRID;

  if (data.accounts) {
    ctx.fillStyle = c.muted;
    ctx.font = `15px ${c.sans}`;
    ctx.fillText(ellipsis(ctx, `上线的号：${data.accounts.join("、")}`, inner - 16), x0 + 8, y + 28);
    y += ACCOUNTS;
  }

  // 出货
  if (data.items.length) {
    y += 20;
    ctx.save();
    ctx.translate(x0 + 12, y + 18);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = c.gold;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.fillStyle = c.redDark;
    ctx.font = `700 21px ${c.kai}`;
    ctx.fillText("出货", x0 + 28, y + 25);
    y += 48;
    data.items.forEach((it, i) => {
      const ry = y + i * ROW;
      if (it.windfall) {
        ctx.fillStyle = c.goldPale;
        ctx.fillRect(x0, ry + 2, inner, ROW - 4);
        ctx.fillStyle = VIZ.windfall;
        ctx.fillRect(x0, ry + 2, 4, ROW - 4);
      }
      const icon = icons[i];
      const ix = x0 + 14;
      const iy = ry + 8;
      if (icon) {
        ctx.drawImage(icon, ix, iy, 36, 36);
      } else {
        ctx.fillStyle = c.goldPale;
        ctx.strokeStyle = c.lineStrong;
        ctx.beginPath();
        ctx.roundRect(ix, iy, 36, 36, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = c.redDark;
        ctx.font = `700 18px ${c.kai}`;
        ctx.textAlign = "center";
        ctx.fillText(it.name.slice(0, 1), ix + 18, iy + 25);
        ctx.textAlign = "left";
      }
      ctx.fillStyle = c.text;
      ctx.font = `17px ${c.sans}`;
      const name = ellipsis(ctx, it.name, inner - 300);
      ctx.fillText(name, x0 + 64, ry + 32);
      const nameW = ctx.measureText(name).width;
      ctx.fillStyle = c.muted;
      ctx.font = `700 16px ${c.sans}`;
      ctx.fillText(`×${it.qty}`, x0 + 72 + nameW, ry + 32);
      if (it.windfall) {
        ctx.fillStyle = VIZ.windfall;
        ctx.font = `13px ${c.sans}`;
        ctx.fillText("高价值", x0 + inner - 150, ry + 31);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = c.gold;
      ctx.font = `700 17px ${c.sans}`;
      ctx.fillText(fmtCoin(it.value), x0 + inner - 14, ry + 32);
      ctx.textAlign = "left";
      if (i < data.items.length - 1) {
        ctx.strokeStyle = c.line;
        ctx.beginPath();
        ctx.moveTo(x0 + 64, ry + ROW);
        ctx.lineTo(x0 + inner, ry + ROW);
        ctx.stroke();
      }
    });
    y += data.items.length * ROW;
    if (data.moreItems) {
      ctx.fillStyle = c.muted;
      ctx.font = `14px ${c.sans}`;
      ctx.fillText(`另有 ${data.moreItems} 种物品`, x0 + 64, y + 22);
      y += 28;
    }
  }

  // 页脚
  ctx.textAlign = "center";
  ctx.fillStyle = c.muted;
  ctx.font = `13px ${c.sans}`;
  ctx.fillText(`梦幻记账 · 生成于 ${fmtDateTime(Date.now())}`, W / 2, H - PAD - 18);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("生成图片失败"))), "image/png"));
}

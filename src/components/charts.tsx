import { useEffect, useRef, useState, type ReactNode } from "react";

/** 图表配色（已用 dataviz validate_palette 校验：宣纸底 #fcf5e3，浅色模式，三色全部 PASS） */
export const VIZ = {
  coin: "#b87a00", // 梦幻币
  regular: "#009580", // 常规物品
  windfall: "#7b4fc4", // 偶然高价值
  cost: "#c9b79a", // 点卡成本（中性，零线以下）
  context: "#b3a185", // 对照线（去强调）
  ink: "#3d2514", // 净收益折线
  surface: "#fcf5e3",
  grid: "#eadcbf",
  axis: "#c9b48e",
  text: "#8c6a47",
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 取整刻度，包含 0 */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max - min <= 0) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** 顶部圆角（数据端）、底部直角（基线端）的矩形；dir=-1 时圆角朝下 */
function barPath(x: number, y0: number, y1: number, w: number, rounded: boolean, dir: 1 | -1 = 1): string {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const h = bottom - top;
  const r = rounded ? Math.min(4, h, w / 2) : 0;
  if (r === 0) return `M${x},${top}h${w}v${h}h${-w}z`;
  if (dir === 1)
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}z`;
  return `M${x},${top}H${x + w}V${bottom - r}Q${x + w},${bottom} ${x + w - r},${bottom}H${x + r}Q${x},${bottom} ${x},${bottom - r}z`;
}

// ---------- 图例 / 提示 ----------

export function Legend({ items }: { items: { label: string; color: string; kind: "rect" | "line" | "dash" }[] }) {
  return (
    <div className="viz-legend">
      {items.map((it) => (
        <span key={it.label} className="viz-legend-item">
          {it.kind === "rect" ? (
            <i className="key-rect" style={{ background: it.color }} />
          ) : (
            <i className={`key-line ${it.kind === "dash" ? "dash" : ""}`} style={{ borderColor: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export interface TipRow {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
}

function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: TipRow[] }) {
  const flip = x > width - 200;
  return (
    <div className="viz-tip" style={flip ? { right: width - x + 12 } : { left: x + 12 }}>
      <div className="viz-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className={`viz-tip-row ${r.strong ? "strong" : ""}`}>
          <b>{r.value}</b>
          <span>
            {r.color && <i className="key-line" style={{ borderColor: r.color }} />}
            {r.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- 收支构成：堆叠柱（零线以上收入、以下成本）+ 净收益折线 ----------

export interface StackDatum {
  label: string;
  fullLabel: string;
  stack: { key: string; label: string; value: number; color: string }[];
  negative: { label: string; value: number; color: string };
  line: { label: string; value: number | null; color: string };
  extra?: TipRow[];
}

const M = { l: 58, r: 16, t: 14, b: 30 };

export function StackChart({ data, height = 280, fmt }: { data: StackDatum[]; height?: number; fmt: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const pw = Math.max(0, width - M.l - M.r);
  const ph = height - M.t - M.b;

  const highs = data.map((d) => d.stack.reduce((a, s) => a + s.value, 0));
  const lines = data.map((d) => d.line.value ?? 0);
  const ticks = niceTicks(Math.min(0, ...data.map((d) => -d.negative.value), ...lines), Math.max(0, ...highs, ...lines));
  const dMin = ticks[0];
  const dMax = ticks[ticks.length - 1];
  const y = (v: number) => M.t + ((dMax - v) / (dMax - dMin)) * ph;
  const band = n ? pw / n : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const cx = (i: number) => M.l + band * (i + 0.5);
  const labelEvery = Math.max(1, Math.ceil(44 / Math.max(band, 1)));
  const showDots = band >= 14;

  const linePts = data
    .map((d, i) => (d.line.value === null ? null : ([cx(i), y(d.line.value)] as const)))
    .reduce<string[]>((acc, p, i, arr) => {
      if (!p) return acc;
      acc.push(`${arr[i - 1] ? "L" : "M"}${p[0]},${p[1]}`);
      return acc;
    }, [])
    .join("");

  return (
    <div className="viz" ref={ref} data-tauri-drag-region="false" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-tick">
                {fmt(t)}
              </text>
            </g>
          ))}
          {hover !== null && <rect x={M.l + band * hover} y={M.t} width={band} height={ph} fill="rgba(184,135,58,0.10)" />}

          {data.map((d, i) => {
            const x = cx(i) - barW / 2;
            const nonZero = d.stack.filter((s) => s.value > 0);
            let cum = 0;
            return (
              <g key={i}>
                {nonZero.map((s, j) => {
                  const y0 = y(cum) - (j > 0 ? 2 : 0); // 段与段之间 2px 底色间隙
                  cum += s.value;
                  const y1 = y(cum);
                  if (y0 - y1 <= 0) return null;
                  return <path key={s.key} d={barPath(x, y0, y1, barW, j === nonZero.length - 1)} fill={s.color} />;
                })}
                {d.negative.value > 0 && <path d={barPath(x, y(0) + 1, y(-d.negative.value), barW, true, -1)} fill={d.negative.color} />}
                {i % labelEvery === 0 && (
                  <text x={cx(i)} y={height - 10} textAnchor="middle" className="viz-tick">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}

          <path d={linePts} fill="none" stroke={VIZ.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) =>
            d.line.value === null || (!showDots && hover !== i) ? null : (
              <circle key={i} cx={cx(i)} cy={y(d.line.value)} r={4} fill={VIZ.ink} stroke={VIZ.surface} strokeWidth={2} />
            ),
          )}

          {/* 命中区域：整列，比柱子本身大 */}
          {data.map((d, i) => (
            <rect
              key={i}
              x={M.l + band * i}
              y={M.t}
              width={band}
              height={ph}
              fill="transparent"
              tabIndex={0}
              aria-label={`${d.fullLabel} ${d.line.label} ${d.line.value === null ? "无" : fmt(d.line.value)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip
          x={cx(hover)}
          width={width}
          title={data[hover].fullLabel}
          rows={[
            ...(data[hover].line.value === null ? [] : [{ label: data[hover].line.label, value: fmt(data[hover].line.value!), color: VIZ.ink, strong: true }]),
            ...data[hover].stack.map((s) => ({ label: s.label, value: fmt(s.value), color: s.color })),
            { label: data[hover].negative.label, value: `-${fmt(data[hover].negative.value)}`, color: data[hover].negative.color },
            ...(data[hover].extra ?? []),
          ]}
        />
      )}
    </div>
  );
}

// ---------- 折线：多条序列，十字线 + 末端直接标注 ----------

export interface LineSeries {
  label: string;
  color: string;
  dashed?: boolean;
  values: (number | null)[];
}

export function LineChart({
  labels,
  fullLabels,
  series,
  height = 240,
  fmt,
}: {
  labels: string[];
  fullLabels: string[];
  series: LineSeries[];
  height?: number;
  fmt: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const mr = 96; // 右侧留给末端标注
  const n = labels.length;
  const pw = Math.max(0, width - M.l - mr);
  const ph = height - M.t - M.b;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const dMin = ticks[0];
  const dMax = ticks[ticks.length - 1];
  const y = (v: number) => M.t + ((dMax - v) / (dMax - dMin)) * ph;
  const band = n ? pw / n : 0;
  const cx = (i: number) => M.l + band * (i + 0.5);
  const labelEvery = Math.max(1, Math.ceil(44 / Math.max(band, 1)));

  const path = (vals: (number | null)[]) =>
    vals.map((v, i) => (v === null ? "" : `${i > 0 && vals[i - 1] !== null ? "L" : "M"}${cx(i)},${y(v)}`)).join("");

  // 末端标注：两条线末端太近时不硬挤，交给图例和提示
  const ends = series.map((s) => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] === null) i--;
    return i >= 0 ? { i, v: s.values[i]! } : null;
  });
  const endYs = ends.map((e) => (e ? y(e.v) : null));
  const collide = endYs.some((a, i) => endYs.some((b, j) => i < j && a !== null && b !== null && Math.abs(a - b) < 16));

  return (
    <div className="viz" ref={ref} data-tauri-drag-region="false" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={M.l + pw} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-tick">
                {fmt(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={cx(i)} y={height - 10} textAnchor="middle" className="viz-tick">
                {l}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={M.t} y2={M.t + ph} stroke={VIZ.axis} strokeWidth={1} />}
          {series.map((s) => (
            <path
              key={s.label}
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* 前后都没有数据的孤立点：线段画不出来，用小圆点表示 */}
          {series.map((s) =>
            s.values.map((v, i) =>
              v !== null && (i === 0 || s.values[i - 1] === null) && (i === n - 1 || s.values[i + 1] === null) ? (
                <circle key={`${s.label}-${i}`} cx={cx(i)} cy={y(v)} r={3} fill={s.color} />
              ) : null,
            ),
          )}
          {series.map((s, k) => {
            const e = ends[k];
            if (!e) return null;
            return (
              <g key={s.label}>
                <circle cx={cx(e.i)} cy={y(e.v)} r={4} fill={s.color} stroke={VIZ.surface} strokeWidth={2} />
                {!collide && (
                  <text x={cx(e.i) + 10} y={y(e.v)} dy="0.32em" className="viz-end">
                    {fmt(e.v)}
                  </text>
                )}
              </g>
            );
          })}
          {hover !== null &&
            series.map((s) =>
              s.values[hover] === null ? null : (
                <circle key={s.label} cx={cx(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke={VIZ.surface} strokeWidth={2} />
              ),
            )}
          {labels.map((_, i) => (
            <rect
              key={i}
              x={M.l + band * i}
              y={M.t}
              width={band}
              height={ph}
              fill="transparent"
              tabIndex={0}
              aria-label={fullLabels[i]}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          x={cx(hover)}
          width={width}
          title={fullLabels[hover]}
          rows={series.map((s) => ({ label: s.label, value: s.values[hover] === null ? "无在线" : fmt(s.values[hover]!), color: s.color }))}
        />
      )}
    </div>
  );
}

/** 图表卡片：标题 + 图例 + 「图表 / 数据表」切换 */
export function ChartCard({ title, desc, legend, chart, table }: { title: string; desc?: ReactNode; legend?: ReactNode; chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <div className="seg small-seg">
          <button className={!asTable ? "active" : ""} onClick={() => setAsTable(false)}>
            图表
          </button>
          <button className={asTable ? "active" : ""} onClick={() => setAsTable(true)}>
            数据表
          </button>
        </div>
      </div>
      {desc && <p className="muted small viz-desc">{desc}</p>}
      {!asTable && legend}
      {asTable ? <div className="viz-table-wrap">{table}</div> : chart}
    </section>
  );
}

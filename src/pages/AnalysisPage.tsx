import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  GRANS,
  RANGES,
  autoThreshold,
  breakdown,
  buildBuckets,
  inRange,
  itemStats,
  perHour,
  rangeBounds,
  windfallEvents,
  type Breakdown,
  type Granularity,
  type RangeKey,
} from "../analysis";
import { ChartCard, Legend, LineChart, StackChart, VIZ } from "../components/charts";
import { ItemIcon } from "../components/items";
import { WanInput, profitTone, useUi } from "../components/ui";
import { fmtCoin, fmtDateTime, fmtDuration, fromWan, toWan } from "../utils";

const pct = (v: number) => `${(v * 100).toFixed(v >= 0.1 || v === 0 ? 0 : 1)}%`;

/** 环比：返回 +12% / -8%，无可比数据返回 null */
function delta(cur: number | null, prev: number | null): { text: string; up: boolean } | null {
  if (cur === null || prev === null || prev === 0) return null;
  const r = (cur - prev) / Math.abs(prev);
  return { text: `${r >= 0 ? "+" : ""}${(r * 100).toFixed(0)}%`, up: r >= 0 };
}

function Kpi({ label, value, sub, tone, d }: { label: string; value: string; sub?: string; tone?: string; d?: ReturnType<typeof delta> }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      <div className="stat-sub">
        {d && (
          <span className={d.up ? "gain" : "loss"}>
            {d.up ? "▲" : "▼"} {d.text}
          </span>
        )}
        {d && <span> 较上期</span>}
        {d && sub && <span> · </span>}
        {sub}
      </div>
    </div>
  );
}

export default function AnalysisPage() {
  const { db, update } = useStore();
  const { toast } = useUi();
  const [range, setRange] = useState<RangeKey>("30d");
  const [gran, setGran] = useState<Granularity>("day");
  const [thInput, setThInput] = useState(db.settings.windfallThreshold === null ? "" : toWan(db.settings.windfallThreshold));

  const ended = useMemo(() => db.sessions.filter((s) => s.endAt !== null), [db.sessions]);
  const auto = useMemo(() => autoThreshold(ended), [ended]);
  const threshold = db.settings.windfallThreshold ?? auto;

  const a = useMemo(() => {
    const [from, to] = rangeBounds(range, gran, ended);
    const sessions = inRange(ended, from, to);
    const total = breakdown(sessions, threshold);
    // 上一周期：紧挨着的同等长度区间（"全部" 不做对比）
    const prev = range === "all" ? null : breakdown(inRange(ended, from - (to - from), from), threshold);
    return {
      from,
      to,
      sessions,
      total,
      prev: prev && prev.count > 0 ? prev : null,
      buckets: buildBuckets(ended, from, to, gran, threshold),
      items: itemStats(sessions, threshold),
      windfalls: windfallEvents(sessions, threshold),
    };
  }, [ended, range, gran, threshold]);

  const t = a.total;
  const hourly = perHour(t.profit, t.duration);
  const stableHourly = perHour(t.stable, t.duration);
  const p = a.prev;

  const saveThreshold = () => {
    const v = thInput.trim() === "" ? null : fromWan(thInput);
    if (v === 0 || (thInput.trim() !== "" && v === null)) return toast("阈值需大于 0，留空为自动", "err");
    update((d) => {
      d.settings.windfallThreshold = v;
    });
    toast(v === null ? "已改为自动阈值" : `高价值阈值：${fmtCoin(v)}`);
  };

  const pickRange = (k: RangeKey) => {
    setRange(k);
    setGran(RANGES.find((r) => r.key === k)!.gran);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>统计分析</h1>
      </div>

      {/* 一行筛选，作用于下方所有内容 */}
      <div className="filter-row">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "active" : ""} onClick={() => pickRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="seg">
          {GRANS.map((g) => (
            <button key={g.key} className={gran === g.key ? "active" : ""} onClick={() => setGran(g.key)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="threshold">
          <span className="muted small">高价值判定：单件 ≥</span>
          <WanInput value={thInput} onChange={setThInput} placeholder={Number.isFinite(auto) ? `自动 ${toWan(auto)}` : "自动"} onEnter={saveThreshold} />
          <button className="btn" onClick={saveThreshold}>
            应用
          </button>
        </div>
      </div>

      {t.count === 0 ? (
        <section className="card empty big">这个时间段还没有下线的记录</section>
      ) : (
        <>
          <Insight t={t} hourly={hourly} stableHourly={stableHourly} windfallCount={a.windfalls.length} threshold={threshold} isAuto={db.settings.windfallThreshold === null} />

          <section className="card">
            <div className="stats">
              <Kpi
                label="净收益"
                value={fmtCoin(t.profit)}
                tone={profitTone(t.profit)}
                sub={`${t.count} 场 · ${fmtDuration(t.duration)}`}
                d={delta(t.profit, p?.profit ?? null)}
              />
              <Kpi label="实际时薪" value={hourly === null ? "—" : `${fmtCoin(hourly)}/时`} d={delta(hourly, p ? perHour(p.profit, p.duration) : null)} />
              <Kpi
                label="稳定时薪（剔除偶然）"
                value={stableHourly === null ? "—" : `${fmtCoin(stableHourly)}/时`}
                tone={stableHourly !== null && stableHourly < 0 ? "loss" : undefined}
                d={delta(stableHourly, p ? perHour(p.stable, p.duration) : null)}
              />
              <Kpi label="偶然收益占比" value={t.income > 0 ? pct(t.windfall / t.income) : "—"} sub={`${a.windfalls.length} 次 · ${fmtCoin(t.windfall)}`} />
            </div>
            <div className="stats" style={{ marginTop: 12 }}>
              <Kpi label="梦幻币收入" value={fmtCoin(t.coin)} sub={t.income > 0 ? `占收入 ${pct(t.coin / t.income)}` : undefined} />
              <Kpi label="常规物品" value={fmtCoin(t.regular)} sub={t.income > 0 ? `占收入 ${pct(t.regular / t.income)}` : undefined} />
              <Kpi label="偶然高价值物品" value={fmtCoin(t.windfall)} sub={t.income > 0 ? `占收入 ${pct(t.windfall / t.income)}` : undefined} />
              <Kpi label="点卡成本" value={fmtCoin(t.cost)} sub={`${Math.round(t.points)} 点`} tone="loss" />
            </div>
          </section>

          <ProfitTrend buckets={a.buckets} />
          <HourlyTrend buckets={a.buckets} />

          <div className="two-col">
            <ItemRanking items={a.items} sessionCount={t.count} />
            <WindfallList events={a.windfalls} total={t} />
          </div>
        </>
      )}
    </div>
  );
}

/** 一句话结论 */
function Insight({
  t,
  hourly,
  stableHourly,
  windfallCount,
  threshold,
  isAuto,
}: {
  t: Breakdown;
  hourly: number | null;
  stableHourly: number | null;
  windfallCount: number;
  threshold: number;
  isAuto: boolean;
}) {
  const share = t.income > 0 ? t.windfall / t.income : 0;
  let verdict: string;
  if (windfallCount === 0) verdict = "这段时间没有出现偶然的高价值掉落，收益比较稳定，可以作为常态参考。";
  else if (share >= 0.5) verdict = "收益有一半以上来自偶然高价值掉落，运气成分很大，不能当成常态收益。";
  else if (share >= 0.2) verdict = "有一部分收益来自偶然高价值掉落，评估常态收益时建议看「稳定时薪」。";
  else verdict = "偶然高价值掉落占比不高，收益主要来自稳定产出。";

  return (
    <section className="card insight">
      <p>
        共 <b>{t.count}</b> 场、在线 <b>{fmtDuration(t.duration)}</b>，净收益 <b className={profitTone(t.profit)}>{fmtCoin(t.profit)}</b>
        {hourly !== null && (
          <>
            （时薪 <b>{fmtCoin(hourly)}</b>）
          </>
        )}
        。
        {windfallCount > 0 && (
          <>
            其中 <b className="windfall-text">{fmtCoin(t.windfall)}</b>（{pct(share)}）来自 {windfallCount} 次高价值掉落，剔除后稳定时薪为{" "}
            <b className={stableHourly !== null && stableHourly < 0 ? "loss" : ""}>{stableHourly === null ? "—" : fmtCoin(stableHourly)}</b>。
          </>
        )}
      </p>
      <p className="muted small">
        {verdict} 高价值判定：单件估值 ≥ {Number.isFinite(threshold) ? fmtCoin(threshold) : "—"}
        {isAuto ? "（自动：取所有场次总收入的中位数，即「一场的典型收入」）" : "（手动设置）"}。
      </p>
    </section>
  );
}

function ProfitTrend({ buckets }: { buckets: ReturnType<typeof buildBuckets> }) {
  const data = buckets.map((b) => ({
    label: b.label,
    fullLabel: `${b.fullLabel} · ${b.count} 场 · ${fmtDuration(b.duration)}`,
    stack: [
      { key: "coin", label: "梦幻币", value: b.coin, color: VIZ.coin },
      { key: "regular", label: "常规物品", value: b.regular, color: VIZ.regular },
      { key: "windfall", label: "偶然高价值", value: b.windfall, color: VIZ.windfall },
    ],
    negative: { label: "点卡成本", value: b.cost, color: VIZ.cost },
    line: { label: "净收益", value: b.count > 0 ? b.profit : null, color: VIZ.ink },
  }));
  return (
    <ChartCard
      title="收支构成"
      desc="零线以上为收入（梦幻币 / 常规物品 / 偶然高价值），零线以下为点卡成本，折线为净收益。紫色段越高，该周期越依赖运气。"
      legend={
        <Legend
          items={[
            { label: "梦幻币", color: VIZ.coin, kind: "rect" },
            { label: "常规物品", color: VIZ.regular, kind: "rect" },
            { label: "偶然高价值", color: VIZ.windfall, kind: "rect" },
            { label: "点卡成本", color: VIZ.cost, kind: "rect" },
            { label: "净收益", color: VIZ.ink, kind: "line" },
          ]}
        />
      }
      chart={<StackChart data={data} fmt={fmtCoin} />}
      table={
        <table className="table">
          <thead>
            <tr>
              <th>周期</th>
              <th className="num">场次</th>
              <th className="num">时长</th>
              <th className="num">梦幻币</th>
              <th className="num">常规物品</th>
              <th className="num">偶然高价值</th>
              <th className="num">点卡成本</th>
              <th className="num">净收益</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <td>{b.fullLabel}</td>
                <td className="num">{b.count}</td>
                <td className="num">{b.count ? fmtDuration(b.duration) : "—"}</td>
                <td className="num">{fmtCoin(b.coin)}</td>
                <td className="num">{fmtCoin(b.regular)}</td>
                <td className="num">{fmtCoin(b.windfall)}</td>
                <td className="num">{fmtCoin(b.cost)}</td>
                <td className={`num strong ${b.count ? profitTone(b.profit) : ""}`}>{b.count ? fmtCoin(b.profit) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

function HourlyTrend({ buckets }: { buckets: ReturnType<typeof buildBuckets> }) {
  const actual = buckets.map((b) => perHour(b.profit, b.duration));
  const stable = buckets.map((b) => perHour(b.stable, b.duration));
  return (
    <ChartCard
      title="时薪趋势"
      desc="每小时净收益。两条线的差距就是偶然掉落带来的额外收益：差距越大，那段时间的收益越靠运气。没有在线的周期留空。"
      legend={
        <Legend
          items={[
            { label: "稳定时薪（剔除偶然）", color: VIZ.regular, kind: "line" },
            { label: "实际时薪", color: VIZ.context, kind: "line" },
          ]}
        />
      }
      chart={
        <LineChart
          labels={buckets.map((b) => b.label)}
          fullLabels={buckets.map((b) => b.fullLabel)}
          fmt={fmtCoin}
          series={[
            { label: "实际时薪", color: VIZ.context, values: actual },
            { label: "稳定时薪", color: VIZ.regular, values: stable },
          ]}
        />
      }
      table={
        <table className="table">
          <thead>
            <tr>
              <th>周期</th>
              <th className="num">实际时薪</th>
              <th className="num">稳定时薪</th>
              <th className="num">偶然贡献</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr key={b.start}>
                <td>{b.fullLabel}</td>
                <td className="num">{actual[i] === null ? "—" : fmtCoin(actual[i]!)}</td>
                <td className="num">{stable[i] === null ? "—" : fmtCoin(stable[i]!)}</td>
                <td className="num">{actual[i] === null ? "—" : fmtCoin(actual[i]! - stable[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

function ItemRanking({ items, sessionCount }: { items: ReturnType<typeof itemStats>; sessionCount: number }) {
  const { db } = useStore();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="card">
      <h2>物品收益排行</h2>
      <p className="muted small viz-desc">出现率 = 出过该物品的场次 / 总场次（{sessionCount} 场）。出现率低、价值高的物品不能指望每次都有。</p>
      {items.length === 0 ? (
        <div className="empty">这段时间没有物品收益</div>
      ) : (
        <div className="rank">
          {items.map((it) => (
            <div key={it.itemId} className="rank-row">
              <ItemIcon item={db.items.find((x) => x.id === it.itemId)} name={it.name} size={28} />
              <div className="rank-main">
                <div className="rank-name">
                  <span>{it.name}</span>
                  <span className="muted small">×{it.qty}</span>
                  {it.windfall && <span className="tag-windfall">偶然</span>}
                  <span className="muted small rank-rate">出现率 {pct(it.rate)}</span>
                </div>
                <div className="rank-bar">
                  <i style={{ width: `${(it.value / max) * 100}%`, background: it.windfall ? VIZ.windfall : VIZ.regular }} />
                  <b>{fmtCoin(it.value)}</b>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WindfallList({ events, total }: { events: ReturnType<typeof windfallEvents>; total: Breakdown }) {
  const { db } = useStore();
  return (
    <section className="card">
      <h2>高价值掉落</h2>
      <p className="muted small viz-desc">这些掉落不是每次都会有，它们推高了所在场次和周期的收益。</p>
      {events.length === 0 ? (
        <div className="empty">没有偶然高价值掉落</div>
      ) : (
        <ul className="windfall-list">
          {events.map((e) => (
            <li key={e.drop.id}>
              <ItemIcon item={db.items.find((x) => x.id === e.drop.itemId)} name={e.drop.itemName} size={32} />
              <div className="wf-main">
                <div>
                  <b>{e.drop.itemName}</b> ×{e.drop.qty}
                  <span className="tag-windfall">偶然</span>
                </div>
                <div className="muted small">
                  {fmtDateTime(e.drop.time)} · 占当场收入 {pct(e.shareOfSession)}
                  {total.income > 0 && ` · 占周期收入 ${pct(e.value / total.income)}`}
                </div>
              </div>
              <b className="windfall-text">+{fmtCoin(e.value)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

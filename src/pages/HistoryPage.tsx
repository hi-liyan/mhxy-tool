import { useMemo, useState } from "react";
import type { Session } from "../types";
import { useStore } from "../store";
import { DropForm, DropList } from "../components/drops";
import { ItemIcon } from "../components/items";
import { Stat, profitTone, useUi } from "../components/ui";
import {
  autoPoints,
  fmtCoin,
  fmtDateTime,
  fmtDuration,
  fmtPoints,
  fmtTime,
  fromLocalInput,
  resolveEnd,
  resolveStart,
  sessionStats,
  startOfToday,
  sumStats,
  toLocalInput,
} from "../utils";

const RANGES = [
  { key: "today", label: "今天" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function rangeStart(k: RangeKey): number {
  const t0 = startOfToday();
  if (k === "today") return t0;
  if (k === "7d") return t0 - 6 * 86_400_000;
  if (k === "30d") return t0 - 29 * 86_400_000;
  return 0;
}

export default function HistoryPage() {
  const { db } = useStore();
  const [range, setRange] = useState<RangeKey>("7d");
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useMemo(() => {
    const from = rangeStart(range);
    return db.sessions.filter((s) => s.endAt !== null && s.startAt >= from).sort((a, b) => b.startAt - a.startAt);
  }, [db.sessions, range]);

  const total = useMemo(() => sumStats(list.map((s) => sessionStats(s))), [list]);

  // 物品掉落汇总
  const itemAgg = useMemo(() => {
    const m = new Map<string, { itemId: string; name: string; qty: number; value: number }>();
    for (const s of list)
      for (const d of s.drops) {
        if (d.kind !== "item") continue;
        const e = m.get(d.itemId) ?? { itemId: d.itemId, name: d.itemName, qty: 0, value: 0 };
        e.qty += d.qty;
        e.value += d.qty * d.unitValue;
        m.set(d.itemId, e);
      }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [list]);

  const hours = total.duration / 3_600_000;

  return (
    <div className="page">
      <div className="page-head">
        <h1>历史记录</h1>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "active" : ""} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <section className="card">
        <div className="stats">
          <Stat label="场次" value={list.length} sub={fmtDuration(total.duration)} />
          <Stat label="点卡消耗" value={fmtCoin(total.cost)} sub={`${fmtPoints(total.points)} 点`} tone="loss" />
          <Stat label="梦幻币收入" value={fmtCoin(total.coinIncome)} tone="gold" />
          <Stat label="物品价值" value={fmtCoin(total.itemIncome)} tone="gold" />
          <Stat
            label="净收益"
            value={fmtCoin(total.profit)}
            tone={profitTone(total.profit)}
            sub={hours > 0 ? `平均 ${fmtCoin(total.profit / hours)}/小时` : undefined}
          />
        </div>
      </section>

      {itemAgg.length > 0 && (
        <section className="card">
          <h2>物品汇总</h2>
          <div className="agg">
            {itemAgg.map((a) => (
              <div key={a.itemId} className="agg-cell">
                <ItemIcon item={db.items.find((x) => x.id === a.itemId)} name={a.name} size={32} />
                <div>
                  <div>
                    {a.name} <b>×{a.qty}</b>
                  </div>
                  <div className="muted small">{fmtCoin(a.value)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>场次</h2>
        {list.length === 0 ? (
          <div className="empty">这个时间段没有记录</div>
        ) : (
          <div className="session-list">
            {list.map((s) => (
              <SessionRow key={s.id} session={s} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SessionRow({ session, open, onToggle }: { session: Session; open: boolean; onToggle: () => void }) {
  const st = sessionStats(session);
  return (
    <div className={`session ${open ? "open" : ""}`}>
      <button className="session-row" onClick={onToggle}>
        <span className="when">
          {fmtDateTime(session.startAt)} – {fmtTime(session.endAt!)}
        </span>
        <span className="muted">{fmtDuration(st.duration)}</span>
        <span className="muted">{session.accounts.length} 号</span>
        <span className="note">{session.note}</span>
        <span className="num loss">-{fmtCoin(st.cost)}</span>
        <span className="num gold">+{fmtCoin(st.income)}</span>
        <span className={`num strong ${profitTone(st.profit)}`}>{fmtCoin(st.profit)}</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && <SessionDetail session={session} />}
    </div>
  );
}

function SessionDetail({ session }: { session: Session }) {
  const { update } = useStore();
  const { confirm, toast } = useUi();

  const patch = (fn: (s: Session) => void) =>
    update((d) => {
      const s = d.sessions.find((x) => x.id === session.id);
      if (s) fn(s);
    });

  const setTime = (field: "startAt" | "endAt", v: string) => {
    const t = fromLocalInput(v);
    if (t === null) return;
    const resolved = field === "startAt" ? resolveStart(t, session.endAt!) : resolveEnd(session.startAt, t);
    if (resolved === null) return toast("下线时间不能早于上线时间", "err");
    patch((s) => {
      s[field] = resolved;
    });
  };

  const remove = async () => {
    const ok = await confirm({ title: "删除记录", message: "确定删除这一场记录？", okText: "删除", danger: true });
    if (ok) {
      update((d) => {
        d.sessions = d.sessions.filter((x) => x.id !== session.id);
      });
      toast("已删除");
    }
  };

  return (
    <div className="session-detail">
      <div className="grid-4">
        <div className="field">
          <label>上线</label>
          <input type="datetime-local" value={toLocalInput(session.startAt)} onChange={(e) => setTime("startAt", e.target.value)} />
        </div>
        <div className="field">
          <label>下线</label>
          <input type="datetime-local" value={toLocalInput(session.endAt!)} onChange={(e) => setTime("endAt", e.target.value)} />
        </div>
        <div className="field">
          <label>点卡（点，留空自动）</label>
          <input
            type="number"
            min={0}
            step="any"
            placeholder={fmtPoints(autoPoints(session))}
            value={session.pointsOverride ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              const n = parseFloat(v);
              patch((s) => {
                s.pointsOverride = v === "" || !Number.isFinite(n) || n < 0 ? null : n;
              });
            }}
          />
        </div>
        <div className="field">
          <label>备注</label>
          <input value={session.note} onChange={(e) => patch((s) => void (s.note = e.target.value))} />
        </div>
      </div>
      <div className="muted small">
        账号：{session.accounts.map((a) => a.name).join("、")} · 计费 {fmtPoints(session.pointsPerHour)} 点/号/小时 · 1 点 = {fmtCoin(session.coinPerPoint)}
      </div>

      <div className="two-col">
        <div>
          <h3>补录收入</h3>
          <DropForm defaultTime={() => session.endAt!} onAdd={(drop) => patch((s) => void s.drops.push(drop))} />
        </div>
        <div>
          <h3>明细（{session.drops.length}）</h3>
          <DropList drops={session.drops} onRemove={(id) => patch((s) => void (s.drops = s.drops.filter((x) => x.id !== id)))} />
        </div>
      </div>
      <div className="right">
        <button className="btn danger ghost" onClick={remove}>
          删除这一场
        </button>
      </div>
    </div>
  );
}

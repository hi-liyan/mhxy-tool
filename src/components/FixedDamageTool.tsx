import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Stat } from "./ui";
import {
  DEFAULT_INPUT,
  FIXED_DAMAGE_SOURCES,
  SKILLS,
  autoTargets,
  calcFixedDamage,
  marginalGains,
  nextTargetLevel,
  skillMeta,
  type DamageInput,
  type Formation,
  type SkillKey,
  type WudidongSchool,
} from "../fixedDamage";

/** 计算器的输入只是草稿，存在 localStorage，不进入记账数据 data.json */
const LS_KEY = "mhxy-tools.fixed-damage.v1";

type NumKey = { [K in keyof DamageInput]: DamageInput[K] extends number ? K : never }[keyof DamageInput];
const NUM_KEYS = (Object.keys(DEFAULT_INPUT) as (keyof DamageInput)[]).filter(
  (k): k is NumKey => typeof DEFAULT_INPUT[k] === "number",
);

type PerSkill = Partial<Record<SkillKey, DamageInput>>;

interface Saved {
  skill: SkillKey;
  inputs: PerSkill;
  /** 对比基准 */
  baselines: PerSkill;
}

function sanitize(v: unknown): DamageInput {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof DamageInput, unknown>>;
  const out: DamageInput = { ...DEFAULT_INPUT };
  for (const k of NUM_KEYS) {
    const x = o[k];
    if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  }
  if (o.formation === "none" || o.formation === "tian" || o.formation === "lei") out.formation = o.formation;
  if (typeof o.targets === "number" && Number.isFinite(o.targets)) out.targets = o.targets;
  out.meridian = o.meridian !== false;
  out.night = o.night === true;
  if (o.wudidongSchool === "hunshou" || o.wudidongSchool === "jinlian" || o.wudidongSchool === "other")
    out.wudidongSchool = o.wudidongSchool;
  return out;
}

function pickPerSkill(v: unknown): PerSkill {
  const out: PerSkill = {};
  if (!v || typeof v !== "object") return out;
  for (const s of SKILLS) {
    const x = (v as Record<string, unknown>)[s.key];
    if (x) out[s.key] = sanitize(x);
  }
  return out;
}

function load(): Saved {
  const empty: Saved = { skill: "difu", inputs: {}, baselines: {} };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return empty;
    const r = raw as Record<string, unknown>;
    const skill = SKILLS.find((s) => s.key === r.skill)?.key ?? "difu";
    return { skill, inputs: pickPerSkill(r.inputs), baselines: pickPerSkill(r.baselines) };
  } catch {
    return empty;
  }
}

const TIPS: Record<SkillKey, string> = {
  difu: "阎罗令的副秒伤害不分灵（灵饰固伤除外），点选目标另有聚伤加成。",
  putuo: "头盔、灵饰伤害、符石伤害和试剑石只加点选目标，副秒只吃武器伤害和龙附。",
  wudidong: "销魂噬骨不受阵法和分灵影响，但受修炼影响。",
  nverYuluo: "暗伤让武器伤害按 18% 转为固伤，但封印命中率降低 10%。凤舞九天对每个目标固定加伤，不受阵法、分灵和修炼影响。",
  nverAnqi: "暗器伤害 = 暗器命中 + 追加伤害 + 门派特色 50。凤舞九天不受阵法、分灵和修炼影响。",
};

/** 保留两位小数；-0 和 NaN 显示为 0 */
const fmt2 = (v: number) => String(Math.round(v * 100) / 100 || 0);

function Delta({ v }: { v: number }) {
  if (v === 0) return <span>与基准相同</span>;
  return (
    <span className={v > 0 ? "gain" : "loss"}>
      比基准 {v > 0 ? "+" : ""}
      {v}
    </span>
  );
}

function NumField({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label title={hint}>{label}</label>
      <input
        type="number"
        min={0}
        step="any"
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(Number.isFinite(v) && v > 0 ? v : 0);
        }}
      />
    </div>
  );
}

function Group({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="fd-group">
      <h3>
        {title}
        {extra && <span className="muted small">{extra}</span>}
      </h3>
      <div className="grid-3">{children}</div>
    </div>
  );
}

export function FixedDamageTool() {
  const [saved, setSaved] = useState(load);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(saved));
    } catch {
      // 存不下只影响下次打开时的回填，不影响计算
    }
  }, [saved]);

  const key = saved.skill;
  const meta = skillMeta(key);
  const inp = saved.inputs[key] ?? DEFAULT_INPUT;
  const baseline = saved.baselines[key] ?? null;
  const isNver = key === "nverYuluo" || key === "nverAnqi";

  const set = (patch: Partial<DamageInput>) =>
    setSaved((s) => ({ ...s, inputs: { ...s.inputs, [key]: { ...(s.inputs[key] ?? DEFAULT_INPUT), ...patch } } }));
  const setNum = (k: NumKey, v: number) => {
    const next = { ...inp };
    next[k] = v;
    set(next);
  };
  const num = (k: NumKey, label: string, hint?: string) => (
    <NumField key={k} label={label} hint={hint} value={inp[k]} onChange={(v) => setNum(k, v)} />
  );
  const setBaseline = (b: DamageInput | null) =>
    setSaved((s) => {
      const baselines = { ...s.baselines };
      if (b) baselines[key] = b;
      else delete baselines[key];
      return { ...s, baselines };
    });

  const result = useMemo(() => calcFixedDamage(key, inp), [key, inp]);
  const base = useMemo(() => (baseline ? calcFixedDamage(key, baseline) : null), [key, baseline]);
  const gains = useMemo(() => marginalGains(key, inp), [key, inp]);
  const agiGain = gains.find((g) => g.label === "敏捷")?.total ?? 0;
  const maxN = autoTargets(key, inp.skill);
  const next = nextTargetLevel(key, inp.skill);
  const multi = result.targets > 1;

  const formations: [Formation, string][] = [
    ["none", "无"],
    ["tian", `天阵 ×${meta.formation.tian}`],
    ["lei", `雷阵 ×${meta.formation.lei}`],
  ];

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>固伤计算</h2>
          <span className="muted small">对 NPC · 不计暴击 · 公式为玩家实测整理</span>
        </div>
        <div className="seg fd-skills">
          {SKILLS.map((s) => (
            <button key={s.key} className={s.key === key ? "active" : ""} onClick={() => setSaved((x) => ({ ...x, skill: s.key }))}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="fd-layout">
          <div className="fd-form">
            <Group title="技能与属性">
              {num("skill", `${meta.skillName}等级`)}
              {isNver && num("anqiSkill", "暗器技巧等级")}
              {num("agility", "敏捷", "属性面板上的敏捷")}
              <div className="field">
                <label>秒几</label>
                <select
                  value={inp.targets === null ? "auto" : String(result.targets)}
                  onChange={(e) => set({ targets: e.target.value === "auto" ? null : Number(e.target.value) })}
                >
                  <option value="auto">{meta.maxTargets ? `自动·秒 ${maxN}` : `默认·秒 ${maxN}`}</option>
                  {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      秒 {n}
                    </option>
                  ))}
                </select>
              </div>
              {key === "putuo" && num("jingangchu", "金刚杵", "佩戴法宝时约 25～40")}
              {key === "nverAnqi" && num("anqiHit", "暗器命中")}
              {key === "nverAnqi" && num("anqiExtra", "暗器追加伤害")}
              {key === "wudidong" && (
                <div className="field">
                  <label>流派</label>
                  <select value={inp.wudidongSchool} onChange={(e) => set({ wudidongSchool: e.target.value as WudidongSchool })}>
                    <option value="hunshou">幽冥巫煞（已点魂守）</option>
                    <option value="jinlian">妙谛金莲（×0.7）</option>
                    <option value="other">未点魂守 / 其他流派</option>
                  </select>
                </div>
              )}
            </Group>
            <div className="row fd-toggles">
              <div className="field">
                <label>阵法</label>
                <div className="seg small-seg">
                  {formations.map(([f, label]) => (
                    <button key={f} className={inp.formation === f ? "active" : ""} onClick={() => set({ formation: f })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {meta.meridianName && (
                <div className="field">
                  <label>经脉</label>
                  <div className="seg small-seg">
                    <button className={inp.meridian ? "active" : ""} onClick={() => set({ meridian: true })}>
                      已点【{meta.meridianName}】
                    </button>
                    <button className={inp.meridian ? "" : "active"} onClick={() => set({ meridian: false })}>
                      未点
                    </button>
                  </div>
                </div>
              )}
              {key === "difu" && (
                <div className="field">
                  <label>时间</label>
                  <div className="seg small-seg">
                    <button className={inp.night ? "" : "active"} onClick={() => set({ night: false })}>
                      白天
                    </button>
                    <button className={inp.night ? "active" : ""} onClick={() => set({ night: true })}>
                      夜晚 ×1.3
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Group title="装备伤害" extra="不含命中转化的伤害">
              {num("weapon", "武器伤害")}
              {num("dragon", "龙附")}
              {num("lingshiDmg", "灵饰伤害")}
              {num("helmet", "头盔伤害", "太阳石等")}
              {num("runeDmg", "符石伤害")}
              {num("sword", "试剑石")}
            </Group>

            <Group title="固伤加成">
              {num("lingshiFixed", "灵饰固伤", "含锐不可当")}
              {num("runeFixed", "符石固伤", "符石自带的固伤词条之和")}
              {num("combo", meta.comboName, "门派符石组合，按游戏内说明填写数值")}
              {num("shenmu", "神木符")}
            </Group>

            <Group title="修炼">
              {num("cultivation", "自身法术修炼")}
              {num("resist", "目标法抗修炼")}
            </Group>
          </div>

          <div className="fd-result">
            <Stat label="点选目标" value={result.primary} sub={base ? <Delta v={result.primary - base.primary} /> : undefined} />
            <Stat
              label="每个副秒"
              value={multi ? result.secondary : "—"}
              sub={base && multi ? <Delta v={result.secondary - base.secondary} /> : undefined}
            />
            <Stat
              label={`秒 ${result.targets} 总伤害`}
              value={result.total}
              tone="gold"
              sub={base ? <Delta v={result.total - base.total} /> : undefined}
            />
            <p className="muted small">
              {next
                ? `${meta.skillName}升到 ${next.level} 级可秒 ${next.targets}`
                : meta.maxTargets
                  ? "已达秒数上限"
                  : "秒几与技能等级的关系暂未查到，请按游戏内实际选择"}
            </p>
            <p className="muted small">{TIPS[key]}</p>
            <div className="row">
              <button className="btn" onClick={() => setBaseline(inp)}>
                设为对比基准
              </button>
              {baseline && (
                <button className="btn ghost" onClick={() => setBaseline(null)}>
                  清除基准
                </button>
              )}
            </div>
            {base && (
              <p className="muted small">
                基准：点选 {base.primary}
                {base.targets > 1 && ` · 副秒 ${base.secondary}`} · 秒 {base.targets} 总伤 {base.total}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>提升收益</h2>
        <p className="muted small">其余条件和秒数不变时，每项 +1 点带来的伤害增量。“折合敏捷”表示该项 1 点约等于多少点敏捷。</p>
        <table className="table">
          <thead>
            <tr>
              <th>项目（+1 点）</th>
              <th className="num">总伤增加</th>
              <th className="num">每个副秒增加</th>
              <th className="num">折合敏捷</th>
            </tr>
          </thead>
          <tbody>
            {gains.map((g) => (
              <tr key={g.label}>
                <td>{g.label}</td>
                <td className="num">{fmt2(g.total)}</td>
                <td className="num">{multi ? fmt2(g.secondary) : "—"}</td>
                <td className="num">{agiGain > 0 ? fmt2(g.total / agiGain) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">比较两件装备时，先点“设为对比基准”，再把数值改成另一件装备的，结果旁会显示差值。</p>
      </section>

      <section className="card">
        <h2>说明与来源</h2>
        <ul className="fd-notes">
          <li>只计算对 NPC 的固伤，不计暴击、燃血和经脉的特殊效果；公式没有区分经典服和畅玩服。</li>
          <li>公式来自玩家实测整理，不是官方数据。游戏内每一步都向下取整，这里只在最后取整，结果可能差几点，建议打一次怪对照。</li>
          <li>地府：有资料称对野外 NPC 时技能项还要再乘 1.5，与这里采用的公式不一致，请以实测为准。</li>
          <li>女儿村：秒几与技能等级的关系暂未查到，需要手动选择。</li>
          <li>武器伤害（含头盔、灵饰、符石上的伤害）要点了对应经脉才转为固伤：地府【阎罗】×15%、普陀【借灵】×24%、女儿村【暗伤】×18%。</li>
          <li>门派符石组合（索命无常、行云流水、销魂噬骨、凤舞九天）的数值请按游戏内说明填写。</li>
          <li>盘丝洞、天机城的资料不全或互相矛盾，暂未提供。</li>
        </ul>
        <h3>公式来源</h3>
        <ul className="fd-sources" data-tauri-drag-region="false">
          {FIXED_DAMAGE_SOURCES.map((s) => (
            <li key={s.url}>
              <div>
                {s.title}
                <span className="muted small"> · {s.note}</span>
              </div>
              <code>{s.url}</code>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

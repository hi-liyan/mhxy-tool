/**
 * 固伤（固定伤害）计算：只针对 NPC，不计暴击、燃血和经脉的特殊效果。
 * 公式来自玩家实测整理（见 FIXED_DAMAGE_SOURCES），不是官方数据。
 * 游戏内每一步都向下取整，这里只在最后取整，结果可能与实际差几点。
 * 纯函数、无运行时依赖（可直接用 node --experimental-strip-types 测试）。
 */

export type SkillKey = "difu" | "putuo" | "wudidong" | "nverYuluo" | "nverAnqi";
export type Formation = "none" | "tian" | "lei";
/** 无底洞流派：幽冥巫煞（已点"魂守"，基础伤害加倍）/ 妙谛金莲（伤害 ×0.7）/ 其他 */
export type WudidongSchool = "hunshou" | "jinlian" | "other";

export interface DamageInput {
  /** 师门技能等级：幽冥术 / 五行学说 / 鬼蛊灵蕴 / 沉鱼落雁 */
  skill: number;
  /** 敏捷（属性面板） */
  agility: number;
  weapon: number;
  dragon: number;
  lingshiDmg: number;
  helmet: number;
  runeDmg: number;
  sword: number;
  /** 灵饰固伤（含锐不可当） */
  lingshiFixed: number;
  /** 符石自带的固伤词条之和 */
  runeFixed: number;
  /** 门派符石组合：索命无常 / 行云流水 / 销魂噬骨 / 凤舞九天 */
  combo: number;
  /** 神木符 */
  shenmu: number;
  /** 自身法术修炼 */
  cultivation: number;
  /** 目标法术抗性修炼 */
  resist: number;
  formation: Formation;
  /** 秒几；null 表示按技能等级取上限 */
  targets: number | null;
  /** 已点让武器伤害转为固伤的经脉：地府【阎罗】、普陀【借灵】、女儿村【暗伤】 */
  meridian: boolean;
  /** 地府：夜晚 */
  night: boolean;
  /** 普陀：金刚杵（法宝） */
  jingangchu: number;
  wudidongSchool: WudidongSchool;
  /** 女儿村：暗器技巧等级 */
  anqiSkill: number;
  /** 女儿村暗器：暗器命中、追加伤害 */
  anqiHit: number;
  anqiExtra: number;
}

export interface SkillMeta {
  key: SkillKey;
  /** 门派·技能 */
  label: string;
  /** 决定伤害和秒几的师门技能 */
  skillName: string;
  /** 门派符石组合名称 */
  comboName: string;
  /** 让武器伤害转为固伤的经脉；null 表示该技能不需要 */
  meridianName: string | null;
  formation: { tian: number; lei: number };
  /** 按技能等级算最多秒几；null 表示资料未查到，需要手动选择 */
  maxTargets: ((skill: number) => number) | null;
  /** 手动选择秒几时的上限 */
  targetLimit: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const SKILLS: SkillMeta[] = [
  {
    key: "difu",
    label: "地府·阎罗令",
    skillName: "幽冥术",
    comboName: "索命无常",
    meridianName: "阎罗",
    formation: { tian: 1.15, lei: 1.2 },
    // 每 25 级多秒 1 个：50 级秒 3 … 150 级秒 7
    maxTargets: (l) => clamp(Math.floor(l / 25) + 1, 1, 7),
    targetLimit: 7,
  },
  {
    key: "putuo",
    label: "普陀·五行法术",
    skillName: "五行学说",
    comboName: "行云流水",
    meridianName: "借灵",
    formation: { tian: 1.15, lei: 1.2 },
    // 45 级前秒 2，每 45 级多秒 1 个，180 级秒 6
    maxTargets: (l) => clamp(Math.floor(l / 45) + 2, 1, 6),
    targetLimit: 6,
  },
  {
    key: "wudidong",
    label: "无底洞·夺命咒",
    skillName: "鬼蛊灵蕴",
    comboName: "销魂噬骨",
    meridianName: null,
    formation: { tian: 1.15, lei: 1.2 },
    // 1 + 技能等级 / 35，最多 5 个
    maxTargets: (l) => clamp(Math.floor(l / 35) + 1, 1, 5),
    targetLimit: 5,
  },
  {
    key: "nverYuluo",
    label: "女儿村·雨落寒沙",
    skillName: "沉鱼落雁",
    comboName: "凤舞九天",
    meridianName: "暗伤",
    // 女儿村的阵法加成与其他门派不同：天阵加法结算，雷阵乘法结算
    formation: { tian: 1.25, lei: 1.14 },
    maxTargets: null,
    targetLimit: 7,
  },
  {
    key: "nverAnqi",
    label: "女儿村·暗器",
    skillName: "沉鱼落雁",
    comboName: "凤舞九天",
    meridianName: null,
    formation: { tian: 1.25, lei: 1.14 },
    maxTargets: null,
    targetLimit: 7,
  },
];

export function skillMeta(key: SkillKey): SkillMeta {
  return SKILLS.find((s) => s.key === key)!;
}

export const DEFAULT_INPUT: DamageInput = {
  skill: 0,
  agility: 0,
  weapon: 0,
  dragon: 0,
  lingshiDmg: 0,
  helmet: 0,
  runeDmg: 0,
  sword: 0,
  lingshiFixed: 0,
  runeFixed: 0,
  combo: 0,
  shenmu: 0,
  cultivation: 0,
  resist: 0,
  formation: "none",
  targets: null,
  meridian: true,
  night: false,
  jingangchu: 0,
  wudidongSchool: "hunshou",
  anqiSkill: 0,
  anqiHit: 0,
  anqiExtra: 0,
};

/** 按技能等级可秒的上限（资料未查到的技能返回手动上限） */
export function autoTargets(key: SkillKey, skill: number): number {
  const m = skillMeta(key);
  return m.maxTargets ? m.maxTargets(skill) : m.targetLimit;
}

/** 实际秒几：手动选择的值不超过技能等级允许的上限 */
export function resolveTargets(key: SkillKey, input: DamageInput): number {
  const max = autoTargets(key, input.skill);
  return input.targets === null ? max : clamp(Math.floor(input.targets), 1, max);
}

/** 技能再升到多少级能多秒 1 个；已到上限或资料未查到时返回 null */
export function nextTargetLevel(key: SkillKey, skill: number): { level: number; targets: number } | null {
  const m = skillMeta(key);
  if (!m.maxTargets) return null;
  const cur = m.maxTargets(skill);
  for (let l = Math.floor(skill) + 1; l <= skill + 200; l++) {
    const t = m.maxTargets(l);
    if (t > cur) return { level: l, targets: t };
  }
  return null;
}

/** 装备伤害合计：武器 + 龙附 + 灵饰伤害 + 头盔 + 符石伤害 + 试剑石 */
function equipSum(i: DamageInput): number {
  return i.weapon + i.dragon + i.lingshiDmg + i.helmet + i.runeDmg + i.sword;
}

/** 分灵系数 = 系数 − 0.1 × 目标数，不低于下限（按十分位整数计算，避免 1.1 − 0.6 这类浮点误差） */
const fenling = (n: number, base: number, floor: number) => Math.max(floor, (Math.round(base * 10) - n) / 10);

interface RawDamage {
  /** 点选目标 */
  primary: number;
  /** 每个副秒目标 */
  secondary: number;
}

function raw(key: SkillKey, i: DamageInput, n: number): RawDamage {
  const m = skillMeta(key);
  const form = i.formation === "none" ? 1 : m.formation[i.formation];
  const diff = i.cultivation - i.resist;
  const cultMul = 1 + diff * 0.02;
  const cultAdd = diff * 5;
  const e = equipSum(i);
  // 点选附加项：只加在点选目标上
  const pick = e / 2;
  // 武器伤害转固伤需要对应经脉（阎罗 ×15%、借灵 ×24%、暗伤 ×18%）；点选附加项不受影响
  const conv = i.meridian ? 1 : 0;

  switch (key) {
    case "difu": {
      // 阎罗令本身不分灵，只有灵饰固伤分灵；点选目标另有聚伤加成
      const fl = fenling(n, 1, 0.5);
      const base =
        (i.skill * 1.5 + 30) * (i.night ? 1.3 : 1) + e * 0.15 * conv + i.agility * 0.35 + i.lingshiFixed * fl + i.combo + i.runeFixed;
      const juShang = 1 + (autoTargets(key, i.skill) - n) * 0.1;
      const hit = (mul: number) => base * form * mul * cultMul + cultAdd + i.shenmu;
      return { primary: hit(juShang) + pick, secondary: hit(1) };
    }
    case "putuo": {
      // 普陀只有武器伤害和龙附计入固伤，其他装备伤害只加点选目标
      const fl = fenling(n, 1.1, 0.55);
      const inner =
        (i.skill * 3 + 50 + (i.weapon + i.dragon) * 0.24 * conv + i.agility * 0.7 + i.lingshiFixed + i.combo + i.jingangchu) * form * fl +
        i.runeFixed;
      const secondary = inner * cultMul + cultAdd + i.shenmu;
      return { primary: secondary + pick, secondary };
    }
    case "wudidong": {
      // 销魂噬骨不受阵法和分灵影响，但受修炼影响；金莲系数最后结算
      const fl = fenling(n, 1.1, 0);
      const qyd = i.wudidongSchool === "hunshou" ? 2 : 1;
      const jinlian = i.wudidongSchool === "jinlian" ? 0.7 : 1;
      const inner = ((1.5 * i.skill + 20 + e * 0.125) * qyd + i.agility * 0.7 + i.lingshiFixed) * form * fl + i.runeFixed + i.combo;
      const base = inner * cultMul + cultAdd + i.shenmu;
      return { primary: (base + pick) * jinlian, secondary: base * jinlian };
    }
    case "nverYuluo":
    case "nverAnqi": {
      // 凤舞九天是固定伤害结果，不受阵法、分灵和修炼影响
      const fl = fenling(n, 1.1, 0.6);
      const skillTerm = (i.skill * i.skill) / 400 + i.skill / 2;
      const anqiTerm = (i.anqiSkill * i.anqiSkill) / 150 + i.anqiSkill;
      const own =
        key === "nverYuluo"
          ? e * 0.18 * conv + i.agility * 0.5 + (i.lingshiFixed * 5) / 6
          : i.anqiHit + i.anqiExtra + 50 + i.agility * 0.3 + i.lingshiFixed * 0.8;
      const base = (skillTerm + anqiTerm + own + i.runeFixed) * form * fl * cultMul + cultAdd + i.shenmu + i.combo;
      return { primary: base + pick, secondary: base };
    }
  }
}

export interface DamageResult {
  targets: number;
  /** 点选目标伤害 */
  primary: number;
  /** 每个副秒目标伤害（秒 1 时为 0） */
  secondary: number;
  total: number;
}

// 加一个极小量，避免 819.9999999 这类浮点误差被向下取整成 819
const floor0 = (v: number) => Math.max(0, Math.floor(v + 1e-9));

export function calcFixedDamage(key: SkillKey, input: DamageInput): DamageResult {
  const n = resolveTargets(key, input);
  const r = raw(key, input, n);
  const primary = floor0(r.primary);
  const secondary = n > 1 ? floor0(r.secondary) : 0;
  return { targets: n, primary, secondary, total: primary + secondary * (n - 1) };
}

/** 不取整的总伤，用于比较提升收益（取整会把小提升抹掉） */
function rawTotal(key: SkillKey, input: DamageInput, n: number): { total: number; secondary: number } {
  const r = raw(key, input, n);
  const secondary = n > 1 ? Math.max(0, r.secondary) : 0;
  return { total: Math.max(0, r.primary) + secondary * (n - 1), secondary };
}

export interface Gain {
  label: string;
  /** 每 +1 点总伤增加 */
  total: number;
  /** 每 +1 点每个副秒目标增加 */
  secondary: number;
}

/** 每项属性 +1 点能增加多少伤害（秒几保持不变），按总伤增量从高到低排列 */
export function marginalGains(key: SkillKey, input: DamageInput): Gain[] {
  const m = skillMeta(key);
  const n = resolveTargets(key, input);
  const fixed = { ...input, targets: n };
  const base = rawTotal(key, fixed, n);
  const fields: [keyof DamageInput, string][] = [
    ["agility", "敏捷"],
    ["weapon", "武器伤害"],
    ["helmet", "其他装备伤害（头盔、灵饰、符石）"],
    ["lingshiFixed", "灵饰固伤"],
    ["runeFixed", "符石固伤"],
    ["combo", m.comboName],
    ["cultivation", "法术修炼"],
    ["skill", m.skillName],
  ];
  if (key === "nverYuluo" || key === "nverAnqi") fields.push(["anqiSkill", "暗器技巧"]);
  if (key === "nverAnqi") fields.push(["anqiHit", "暗器伤害"]);
  return fields
    .map(([f, label]) => {
      const next = rawTotal(key, { ...fixed, [f]: (input[f] as number) + 1 }, n);
      return { label, total: next.total - base.total, secondary: next.secondary - base.secondary };
    })
    .sort((a, b) => b.total - a.total);
}

export const FIXED_DAMAGE_SOURCES = [
  {
    title: "233乐园《梦幻西游》固定伤害全门派公式解析（2026-07-11）",
    url: "https://www.233leyuan.com/post-detail/2075777149352157184",
    note: "地府、普陀、无底洞公式，整理自官方论坛、NGA、网易大神作者",
  },
  {
    title: "叶子猪《搞清固伤伤害机制，总结提升输出的方案》（2024-01）",
    url: "http://xyq.yzz.cn/focus/202401/1712560.shtml",
    note: "女儿村雨落寒沙、暗器公式及阵法系数",
  },
  {
    title: "233乐园《武器伤害怎么换算固伤？固伤系数详解》（2026-06）",
    url: "https://www.233leyuan.com/post-detail/2066471074169483264",
    note: "阎罗 ×15%、借灵 ×24%、暗伤 ×18% 的经脉条件",
  },
  {
    title: "233乐园《普陀山秒几？技能等级与秒数关系全解析》",
    url: "https://www.233leyuan.com/post-detail/2070094805454000128",
    note: "普陀每 45 级多秒 1 个",
  },
  {
    title: "233乐园《无底洞夺命咒能秒几个？》",
    url: "https://www.233leyuan.com/post-detail/2066471033297113088",
    note: "1 + 技能等级 ÷ 35，最多 5 个",
  },
  {
    title: "DVG《梦幻西游地府秒7技能要求解析》",
    url: "https://www.dvg.cn/news/71623.html",
    note: "幽冥术 150 级秒 7",
  },
];

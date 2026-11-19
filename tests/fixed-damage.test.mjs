// 固伤计算公式与秒数规则。运行：node --experimental-strip-types --test tests/fixed-damage.test.mjs
// 期望值按 src/fixedDamage.ts 注明来源的公式手算，用来防止系数抄错或写错位置。
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_INPUT, autoTargets, calcFixedDamage, marginalGains, nextTargetLevel, resolveTargets } from "../src/fixedDamage.ts";

const input = (over) => ({ ...DEFAULT_INPUT, ...over });

test("按技能等级算秒几", () => {
  const cases = {
    difu: [[49, 2], [50, 3], [75, 4], [100, 5], [125, 6], [149, 6], [150, 7], [180, 7]],
    putuo: [[44, 2], [45, 3], [90, 4], [135, 5], [179, 5], [180, 6]],
    wudidong: [[34, 1], [35, 2], [70, 3], [105, 4], [109, 4], [139, 4], [140, 5], [175, 5]],
  };
  for (const [key, rows] of Object.entries(cases))
    for (const [level, n] of rows) assert.equal(autoTargets(key, level), n, `${key} ${level} 级`);
  assert.equal(autoTargets("nverYuluo", 160), 7, "资料未查到的技能返回手动上限");
});

test("手动选择的秒几不超过技能等级上限", () => {
  assert.equal(resolveTargets("difu", input({ skill: 150, targets: 9 })), 7);
  assert.equal(resolveTargets("difu", input({ skill: 150, targets: 3 })), 3);
  assert.equal(resolveTargets("difu", input({ skill: 100, targets: 6 })), 5);
  assert.equal(resolveTargets("putuo", input({ skill: 180, targets: null })), 6);
});

test("下一档秒数", () => {
  assert.deepEqual(nextTargetLevel("difu", 130), { level: 150, targets: 7 });
  assert.deepEqual(nextTargetLevel("wudidong", 109), { level: 140, targets: 5 });
  assert.equal(nextTargetLevel("putuo", 180), null, "已到上限");
  assert.equal(nextTargetLevel("nverYuluo", 100), null, "资料未查到");
});

// 装备伤害合计 704
const difu = input({ skill: 150, agility: 500, weapon: 600, lingshiDmg: 40, helmet: 64, lingshiFixed: 100, runeFixed: 10, combo: 30, cultivation: 20, resist: 20 });

test("地府·阎罗令：白天秒 7", () => {
  // 基础 = 255 + 105.6 + 175 + 100×0.5 + 30 + 10 = 625.6；点选 = 625.6 + 704/2
  assert.deepEqual(calcFixedDamage("difu", difu), { targets: 7, primary: 977, secondary: 625, total: 977 + 625 * 6 });
});

test("地府·阎罗令：夜晚技能项 ×1.3", () => {
  // 基础 = 255×1.3 + 105.6 + 175 + 50 + 40 = 702.1
  assert.deepEqual(calcFixedDamage("difu", { ...difu, night: true }), { targets: 7, primary: 1054, secondary: 702, total: 1054 + 702 * 6 });
});

test("地府·阎罗令：秒 3 时灵饰固伤分灵减轻、点选聚伤 ×1.4", () => {
  // 基础 = 625.6 − 50 + 100×0.7 = 645.6；点选 = 645.6 × (1 + (7 − 3) × 0.1) + 352
  assert.deepEqual(calcFixedDamage("difu", { ...difu, targets: 3 }), { targets: 3, primary: 1255, secondary: 645, total: 1255 + 645 * 2 });
});

test("普陀·五行法术：天阵秒 6，分灵下限 0.55", () => {
  const r = calcFixedDamage(
    "putuo",
    input({ skill: 180, agility: 400, weapon: 500, lingshiDmg: 40, helmet: 64, lingshiFixed: 80, combo: 20, jingangchu: 40, runeFixed: 8, cultivation: 25, resist: 20, formation: "tian" }),
  );
  // 内项 = (590 + 120 + 280 + 80 + 20 + 40) × 1.15 × 0.55 + 8 = 722.725；副秒 = 722.725 × 1.1 + 25
  assert.deepEqual(r, { targets: 6, primary: 1121, secondary: 819, total: 1121 + 819 * 5 });
});

const wdd = input({ skill: 140, agility: 450, weapon: 500, helmet: 64, lingshiFixed: 60, runeFixed: 6, combo: 50, cultivation: 20, resist: 25, formation: "lei" });

test("无底洞·夺命咒：幽冥巫煞魂守，修炼差为负", () => {
  // 内项 = ((230 + 70.5) × 2 + 315 + 60) × 1.2 × 0.6 + 6 + 50 = 758.72；副秒 = 758.72 × 0.9 − 25
  assert.deepEqual(calcFixedDamage("wudidong", wdd), { targets: 5, primary: 939, secondary: 657, total: 939 + 657 * 4 });
});

test("无底洞·夺命咒：妙谛金莲最后 ×0.7", () => {
  assert.deepEqual(calcFixedDamage("wudidong", { ...wdd, wudidongSchool: "jinlian" }), { targets: 5, primary: 521, secondary: 324, total: 521 + 324 * 4 });
});

const nver = input({ skill: 160, anqiSkill: 150, agility: 500, weapon: 500, lingshiDmg: 40, helmet: 64, lingshiFixed: 120, runeFixed: 10 });

test("女儿村·雨落寒沙：天阵秒 7", () => {
  // (144 + 300 + 108.72 + 250 + 100 + 10) × 1.25 × 0.6 + 凤舞九天 64
  assert.deepEqual(calcFixedDamage("nverYuluo", { ...nver, combo: 64, formation: "tian" }), { targets: 7, primary: 1050, secondary: 748, total: 1050 + 748 * 6 });
});

test("女儿村·暗器：秒 5", () => {
  // (144 + 300 + (100 + 50 + 50) + 150 + 96 + 10) × 0.6 = 540
  assert.deepEqual(calcFixedDamage("nverAnqi", { ...nver, anqiHit: 100, anqiExtra: 50, targets: 5 }), { targets: 5, primary: 842, secondary: 540, total: 842 + 540 * 4 });
});

test("秒 1 时没有副秒", () => {
  const r = calcFixedDamage("putuo", input({ skill: 100, targets: 1 }));
  assert.equal(r.secondary, 0);
  assert.equal(r.total, r.primary);
});

const gain = (gains, label) => gains.find((g) => g.label === label);

test("凤舞九天每 +1 点，每个目标都 +1，不受阵法、分灵、修炼影响", () => {
  const g = gain(marginalGains("nverYuluo", { ...nver, formation: "tian", cultivation: 25, resist: 10 }), "凤舞九天");
  assert.ok(Math.abs(g.secondary - 1) < 1e-9);
  assert.ok(Math.abs(g.total - 7) < 1e-9);
});

test("普陀的其他装备伤害只加点选目标", () => {
  const g = gain(marginalGains("putuo", input({ skill: 180 })), "其他装备伤害（头盔、灵饰、符石）");
  assert.ok(Math.abs(g.secondary) < 1e-9);
  assert.ok(Math.abs(g.total - 0.5) < 1e-9);
});

test("提升收益按总伤增量从高到低排列", () => {
  const gains = marginalGains("difu", difu);
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i - 1].total >= gains[i].total);
  // 地府秒 7：敏捷每点 0.35，7 个目标共 2.45
  assert.ok(Math.abs(gain(gains, "敏捷").total - 2.45) < 1e-9);
});

test("没点经脉时武器伤害不转固伤，点选附加项照常", () => {
  // 地府未点阎罗：基础 625.6 − 704×0.15 = 520
  assert.deepEqual(calcFixedDamage("difu", { ...difu, meridian: false }), { targets: 7, primary: 872, secondary: 520, total: 872 + 520 * 6 });
  // 女儿村未点暗伤：(912.72 − 108.72) × 1.25 × 0.6 + 64 = 667
  assert.deepEqual(calcFixedDamage("nverYuluo", { ...nver, combo: 64, formation: "tian", meridian: false }), { targets: 7, primary: 969, secondary: 667, total: 969 + 667 * 6 });
});

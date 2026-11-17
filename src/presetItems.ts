/**
 * 预置常用物品：图标来自藏宝阁公开 CDN（cbg-xyq.res.netease.com/images/big/{类型id}.gif，120×120），
 * 已转为 PNG 存放在 src/assets/cbg-items/{类型id}.png。
 */
const files = import.meta.glob("./assets/cbg-items/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export interface PresetItem {
  name: string;
  url: string;
}

const LIST: { name: string; typeId: number; group: "宝石" | "材料" | "书" }[] = [
  { name: "红玛瑙", typeId: 4011, group: "宝石" },
  { name: "太阳石", typeId: 4002, group: "宝石" },
  { name: "月亮石", typeId: 4003, group: "宝石" },
  { name: "光芒石", typeId: 4004, group: "宝石" },
  { name: "舍利子", typeId: 4012, group: "宝石" },
  { name: "黑宝石", typeId: 4010, group: "宝石" },
  { name: "神秘石", typeId: 4005, group: "宝石" },
  { name: "星辉石", typeId: 4244, group: "宝石" },
  { name: "翡翠石", typeId: 4249, group: "宝石" },
  { name: "红宝石", typeId: 4006, group: "宝石" },
  { name: "黄宝石", typeId: 4007, group: "宝石" },
  { name: "蓝宝石", typeId: 4008, group: "宝石" },
  { name: "绿宝石", typeId: 4009, group: "宝石" },
  { name: "百炼精铁", typeId: 4001, group: "材料" },
  { name: "钟灵石", typeId: 50344, group: "材料" },
  { name: "点化石", typeId: 4034, group: "材料" },
  { name: "五色灵尘", typeId: 61719, group: "材料" },
  { name: "元灵晶石", typeId: 4243, group: "材料" },
  { name: "战魄", typeId: 4202, group: "材料" },
  { name: "奇异果", typeId: 904, group: "材料" },
  { name: "魔兽要诀", typeId: 611, group: "书" },
  { name: "制造指南书", typeId: 612, group: "书" },
  { name: "灵饰指南书", typeId: 18126, group: "书" },
];

const cbgItems: PresetItem[] = LIST.map((p) => {
  const url = files[`./assets/cbg-items/${p.typeId}.png`];
  if (!url) throw new Error(`缺少预置物品图标：${p.name}（${p.typeId}）`);
  return { ...p, url };
});

// 上游项目以文件名作为物品名称；与已有预置同名时沿用藏宝阁图标。
const otherFiles = import.meta.glob("./assets/xyq-profit-ledger/*.{jpg,png,gif}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
function formatName(name: string): string {
  const numbered = name.match(/^(\d+)(珍珠|炼妖石|铁|装备|武器)$/);
  if (numbered) {
    const kind = numbered[2] === "铁" ? "百炼精铁" : numbered[2];
    return `${kind}（${numbered[1]}级）`;
  }
  const rune = name.match(/^(\d+)级符石$/);
  if (rune) return `符石（${rune[1]}级）`;
  if (name === "图册-125") return "图册（125级）";
  if (name === "制造指南书-150项链") return "制造指南书（150级项链）";
  return name;
}

const knownNames = new Set(cbgItems.map((item) => item.name));
const additionalItems: PresetItem[] = [];
for (const [path, url] of Object.entries(otherFiles)) {
  const original = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const name = formatName(original);
  if (knownNames.has(name)) continue;
  knownNames.add(name);
  additionalItems.push({ name, url });
}

export const PRESET_ITEMS: PresetItem[] = [...cbgItems, ...additionalItems];

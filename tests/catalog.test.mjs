import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// 每条目录记录保持单行 JSON，使资源检查不依赖前端构建工具。
const source = readFileSync(new URL("../src/itemCatalog.ts", import.meta.url), "utf8");
const entries = source.split("\n").filter((line) => line.startsWith("  {")).map((line) => JSON.parse(line.trim().replace(/,$/, "")));
const categories = new Set(["兽诀", "宝石", "常用道具", "装备材料", "灵饰材料", "药品烹饪", "其他"]);
assert.ok(entries.length > 0, "系统物品目录不能为空");
assert.equal(new Set(entries.map((item) => item.id)).size, entries.length, "系统物品 ID 重复");
assert.equal(new Set(entries.map((item) => item.name)).size, entries.length, "系统物品名称重复");
for (const item of entries) {
  assert.match(item.id, /^system:\d{4,}$/);
  assert.ok(item.name && categories.has(item.category), `无效的名称或分类：${item.id}`);
  assert.equal(item.name, item.name.trim(), `名称含首尾空格：${item.id}`);
  assert.doesNotMatch(item.name, /[()\/\\]|^\d|\d+级[^）]*$/, `名称格式不规范：${item.name}`);
  assert.ok(item.source, `缺少来源：${item.name}`);
  for (const key of ["iconPath", "resourceId", "description", "sourceIcon", "verifiedAt"]) {
    assert.ok(item[key] === null || typeof item[key] === "string", `无效字段 ${key}：${item.name}`);
  }
  if (item.iconPath) {
    assert.match(item.iconPath, new RegExp(`^\\./assets/items/item-${item.id.slice(7)}\\.(png|jpg|gif)$`), `图标命名不规范：${item.name}`);
    const path = resolve("src", item.iconPath);
    assert.ok(existsSync(path), `缺少图标：${item.name}`);
    const bytes = readFileSync(path);
    const valid = item.iconPath.endsWith(".png") ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : item.iconPath.endsWith(".jpg") ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
    assert.ok(valid, `图标扩展名与内容不符：${item.name}`);
  }
}
const referenced = new Set(entries.flatMap((item) => item.iconPath ? [item.iconPath.split("/").pop()] : []));
for (const file of readdirSync(resolve("src/assets/items"))) assert.ok(referenced.has(file), `未使用的图标：${file}`);
console.log(`系统目录检查通过：${entries.length} 项`);

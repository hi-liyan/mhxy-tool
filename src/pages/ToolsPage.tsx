import { useState } from "react";
import { FixedDamageTool } from "../components/FixedDamageTool";
import { FixedDamageGuide } from "../components/FixedDamageGuide";

type ToolKey = "damage" | "guide" | "price";

const TOOLS: { key: ToolKey; title: string; desc: string; tag: string; ready: boolean }[] = [
  {
    key: "damage",
    title: "固伤计算器",
    desc: "地府、普陀、无底洞、女儿村对 NPC 的固伤；装备对比、提升收益排序。",
    tag: "计算",
    ready: true,
  },
  {
    key: "guide",
    title: "固伤提升攻略",
    desc: "221 常用的无底洞、女儿村、地府：提升顺序、经脉、装备细节、玩家心得和自查清单。",
    tag: "攻略",
    ready: true,
  },
  {
    key: "price",
    title: "装备价格查询",
    desc: "从藏宝阁查询同类装备的在售价格和走势。",
    tag: "规划中",
    ready: false,
  },
];

export default function ToolsPage() {
  const [tool, setTool] = useState<ToolKey | null>(null);
  const current = TOOLS.find((t) => t.key === tool);

  if (current) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>{current.title}</h1>
          <button className="btn" onClick={() => setTool(null)}>
            ← 返回工具箱
          </button>
        </div>
        {current.key === "damage" && <FixedDamageTool />}
        {current.key === "guide" && <FixedDamageGuide onOpenCalculator={() => setTool("damage")} />}
      </div>
    );
  }

  return (
    <div className="page">
      <h1>工具箱</h1>
      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button key={t.key} className="tool-card" disabled={!t.ready} onClick={() => setTool(t.key)}>
            <span className={t.ready ? "tool-tag" : "tool-tag off"}>{t.tag}</span>
            <b>{t.title}</b>
            <span className="muted small">{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

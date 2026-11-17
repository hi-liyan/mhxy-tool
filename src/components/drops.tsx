import { useState } from "react";
import type { Drop } from "../types";
import { useStore } from "../store";
import { dropValue, fmtCoin, fmtTime, fromWan, uid } from "../utils";
import { ItemIcon, ItemPicker } from "./items";
import { WanInput, useUi } from "./ui";

const QUICK_WAN = [10, 50, 100, 500];

/** 录入一条收入：梦幻币 或 物品 */
export function DropForm({ onAdd, defaultTime }: { onAdd: (d: Drop) => void; defaultTime?: () => number }) {
  const { db } = useStore();
  const { toast } = useUi();
  const [tab, setTab] = useState<"coin" | "item">("coin");
  const [coin, setCoin] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  const time = () => defaultTime?.() ?? Date.now();

  const addCoin = () => {
    const v = fromWan(coin);
    if (!v) return toast("请输入梦幻币数量", "err");
    onAdd({ id: uid(), time: time(), kind: "coin", coins: v, note: note.trim() || undefined });
    setCoin("");
    setNote("");
    toast(`已记录 ${fmtCoin(v)} 梦幻币`);
  };

  const addItem = () => {
    const it = db.items.find((x) => x.id === itemId);
    if (!it) return toast("请选择物品", "err");
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n <= 0) return toast("数量不正确", "err");
    onAdd({
      id: uid(),
      time: time(),
      kind: "item",
      itemId: it.id,
      itemName: it.name,
      qty: n,
      unitValue: it.value,
      note: note.trim() || undefined,
    });
    setQty("1");
    setNote("");
    toast(`已记录 ${it.name} ×${n}`);
  };

  const selected = db.items.find((x) => x.id === itemId);

  return (
    <div className="drop-form">
      <div className="tabs">
        <button className={tab === "coin" ? "active" : ""} onClick={() => setTab("coin")}>
          梦幻币
        </button>
        <button className={tab === "item" ? "active" : ""} onClick={() => setTab("item")}>
          物品
        </button>
      </div>

      {tab === "coin" ? (
        <div className="form">
          <div className="row">
            <WanInput value={coin} onChange={setCoin} placeholder="获得多少万" autoFocus onEnter={addCoin} />
            <button className="btn primary" onClick={addCoin}>
              记录
            </button>
          </div>
          <div className="quick">
            {QUICK_WAN.map((w) => (
              <button key={w} className="chip" onClick={() => setCoin(String((parseFloat(coin) || 0) + w))}>
                +{w}万
              </button>
            ))}
          </div>
          <input placeholder="备注（可选），如：抓鬼 / 秘境" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCoin()} />
        </div>
      ) : (
        <div className="form">
          <ItemPicker selectedId={itemId} onSelect={setItemId} />
          <div className="row">
            <div className="selected-item">
              {selected ? (
                <>
                  <ItemIcon item={selected} size={28} />
                  <span>{selected.name}</span>
                  <span className="muted">单价 {fmtCoin(selected.value)}</span>
                </>
              ) : (
                <span className="muted">未选择物品</span>
              )}
            </div>
            <div className="qty">
              <button className="icon-btn" onClick={() => setQty(String(Math.max(1, (parseInt(qty, 10) || 1) - 1)))}>
                −
              </button>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} />
              <button className="icon-btn" onClick={() => setQty(String((parseInt(qty, 10) || 0) + 1))}>
                ＋
              </button>
            </div>
            <button className="btn primary" onClick={addItem}>
              记录
            </button>
          </div>
          <input placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </div>
  );
}

/** 收入明细列表 */
export function DropList({ drops, onRemove }: { drops: Drop[]; onRemove?: (id: string) => void }) {
  const { db } = useStore();
  if (drops.length === 0) return <div className="empty">还没有收入记录</div>;
  const sorted = [...drops].sort((a, b) => b.time - a.time);
  return (
    <ul className="drop-list">
      {sorted.map((d) => {
        const item = d.kind === "item" ? db.items.find((x) => x.id === d.itemId) : undefined;
        return (
          <li key={d.id}>
            <span className="time">{fmtTime(d.time)}</span>
            {d.kind === "coin" ? (
              <>
                <div className="coin-icon">币</div>
                <span className="title">梦幻币</span>
              </>
            ) : (
              <>
                <ItemIcon item={item} name={d.itemName} size={28} />
                <span className="title">
                  {d.itemName} <b>×{d.qty}</b>
                  {d.qty > 1 && <span className="muted small"> @{fmtCoin(d.unitValue)}</span>}
                </span>
              </>
            )}
            {d.note && <span className="note">{d.note}</span>}
            <span className="amount gain">+{fmtCoin(dropValue(d))}</span>
            {onRemove && (
              <button className="icon-btn del" onClick={() => onRemove(d.id)} title="删除">
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

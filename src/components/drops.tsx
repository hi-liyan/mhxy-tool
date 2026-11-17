import { useState } from "react";
import type { Drop, Item } from "../types";
import { useStore } from "../store";
import { dropValue, fmtCoin, fmtTime, fromWan, uid } from "../utils";
import { ItemIcon, ItemPicker } from "./items";
import { Modal, WanInput, useUi } from "./ui";

const QUICK_WAN = [10, 50, 100, 500];

/** 录入一条收入：梦幻币 或 物品 */
export function DropForm({ onAdd, defaultTime }: { onAdd: (d: Drop) => void; defaultTime?: () => number }) {
  const { items, update } = useStore();
  const { toast } = useUi();
  const [tab, setTab] = useState<"coin" | "item">("coin");
  const [coin, setCoin] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<{ item: Item; qty: number; note?: string } | null>(null);
  const [price, setPrice] = useState("");

  const time = () => defaultTime?.() ?? Date.now();

  const addCoin = () => {
    const v = fromWan(coin);
    if (!v) return toast("请输入梦幻币数量", "err");
    onAdd({ id: uid(), time: time(), kind: "coin", coins: v, note: note.trim() || undefined });
    setCoin("");
    setNote("");
    toast(`已记录 ${fmtCoin(v)} 梦幻币`);
  };

  const recordItem = (it: Item, n: number, unitValue: number, itemNote?: string) => {
    onAdd({
      id: uid(),
      time: time(),
      kind: "item",
      itemId: it.id,
      itemName: it.name,
      qty: n,
      unitValue,
      note: itemNote,
    });
    setQty("1");
    setNote("");
    toast(`已记录 ${it.name} ×${n}`);
  };

  const addItem = () => {
    const it = items.find((x) => x.id === itemId && x.origin === "user");
    if (!it) return toast("请选择物品", "err");
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n <= 0) return toast("数量不正确", "err");
    const itemNote = note.trim() || undefined;
    if (it.value === 0) {
      setPrice("");
      setPending({ item: it, qty: n, note: itemNote });
      return;
    }
    recordItem(it, n, it.value, itemNote);
  };

  const savePriceAndRecord = () => {
    if (!pending) return;
    const value = fromWan(price);
    if (value === null || value <= 0) return toast("请输入大于 0 的物品单价", "err");
    const current = items.find((item) => item.id === pending.item.id && item.origin === "user");
    if (!current) {
      setPending(null);
      return toast("物品不存在，请重新选择", "err");
    }
    update((d) => {
      const item = d.items.find((entry) => entry.id === current.id);
      if (item) item.value = value;
    });
    recordItem(current, pending.qty, value, pending.note);
    setPending(null);
  };

  const selected = items.find((x) => x.id === itemId);

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
      {pending && (
        <Modal title="填写物品价格" onClose={() => setPending(null)} width={400} footer={<>
          <button className="btn" onClick={() => setPending(null)}>取消</button>
          <button className="btn primary" onClick={savePriceAndRecord}>保存并记录</button>
        </>}>
          <p>「{pending.item.name}」还没有设置价格，请填写单价。</p>
          <div className="field">
            <label>物品单价</label>
            <WanInput value={price} onChange={setPrice} placeholder="请输入单价" autoFocus onEnter={savePriceAndRecord} />
          </div>
          <p className="muted small">价格会保存到物品库，供下次记账使用。</p>
        </Modal>
      )}
    </div>
  );
}

/** 收入明细列表 */
export function DropList({ drops, onRemove }: { drops: Drop[]; onRemove?: (id: string) => void }) {
  const { items } = useStore();
  if (drops.length === 0) return <div className="empty">还没有收入记录</div>;
  const sorted = [...drops].sort((a, b) => b.time - a.time);
  return (
    <ul className="drop-list">
      {sorted.map((d) => {
        const item = d.kind === "item" ? items.find((x) => x.id === d.itemId) : undefined;
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

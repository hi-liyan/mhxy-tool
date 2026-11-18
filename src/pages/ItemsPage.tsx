import { useMemo, useState } from "react";
import type { Item } from "../types";
import { useStore } from "../store";
import { ItemCreation, ItemEditor, ItemIcon } from "../components/items";
import { fmtCoin, itemCounts } from "../utils";

type SortKey = "name" | "value" | "count";

export default function ItemsPage() {
  const { db, items } = useStore();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => itemCounts(db.sessions), [db.sessions]);
  const userItems = items.filter((item) => item.origin === "user");
  const list = userItems.filter((item) => !q.trim() || item.name.includes(q.trim()));
  list.sort((a, b) => {
    if (sort === "value") return b.value - a.value || a.name.localeCompare(b.name, "zh");
    if (sort === "count") return (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, "zh");
    return a.name.localeCompare(b.name, "zh");
  });

  return (
    <div className="page items-page">
      <div className="page-head">
        <h1>物品库 <span className="count-badge">{list.length} / {userItems.length}</span></h1>
        <div className="actions">
          <input className="search" placeholder="搜索物品…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg" aria-label="排序">
            <button className={sort === "name" ? "active" : ""} onClick={() => setSort("name")}>名称</button>
            <button className={sort === "count" ? "active" : ""} onClick={() => setSort("count")}>常用</button>
            <button className={sort === "value" ? "active" : ""} onClick={() => setSort("value")}>价值</button>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>＋ 新建物品</button>
        </div>
      </div>
      <div className="items-content">
        {list.length === 0 ? (
          <section className="card empty big">
            <p>{userItems.length === 0 ? "物品库还是空的" : "没有找到符合条件的物品"}</p>
            {userItems.length === 0 && <><p className="muted">从系统模板创建，或自己填写物品信息。</p><button className="btn primary" onClick={() => setCreating(true)}>新建物品</button></>}
          </section>
        ) : (
          <div className="item-grid">
            {list.map((it) => (
              <button key={it.id} className="item-card" onClick={() => setEditing(it)}>
                <ItemIcon item={it} size={40} />
                <div className="name" title={it.name}>{it.name}</div>
                <div className="gold">{fmtCoin(it.value)}</div>
                <div className="muted count">获得 {counts.get(it.id) ?? 0}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} />}
      {creating && <ItemCreation onClose={() => setCreating(false)} />}
    </div>
  );
}

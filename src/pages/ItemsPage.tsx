import { useMemo, useState } from "react";
import type { Item } from "../types";
import { useStore } from "../store";
import { ItemEditor, ItemIcon } from "../components/items";
import { useUi } from "../components/ui";
import { PRESET_ITEMS } from "../presetItems";
import { fmtCoin, resizeImage, uid } from "../utils";

type SortKey = "name" | "value" | "count";

export default function ItemsPage() {
  const { db, update } = useStore();
  const { confirm, toast } = useUi();
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [editing, setEditing] = useState<Item | "new" | null>(null);

  /** 导入预置常用物品：新增不存在的；同名但没图片的补图；已有图片的不动。估值不改。 */
  const importPresets = async () => {
    const byName = new Map(db.items.map((item) => [item.name.trim(), item]));
    const toAdd = PRESET_ITEMS.filter((p) => !byName.has(p.name));
    const toFill = PRESET_ITEMS.filter((p) => byName.has(p.name) && !byName.get(p.name)!.image);
    if (toAdd.length === 0 && toFill.length === 0) return toast("常用物品都已导入，且都有图片了");
    const ok = await confirm({
      title: "导入常用物品",
      message: (
        <>
          将新增 <b>{toAdd.length}</b> 个物品{toFill.length > 0 && <>，并为 <b>{toFill.length}</b> 个已有物品补上图片</>}。
          <br />
          已有图片的物品不会被覆盖；新增物品的估值为 0，导入后请自行填写。
          <br />
          <span className="muted small">内置 {PRESET_ITEMS.length} 个物品，图标来自藏宝阁及公开项目。</span>
        </>
      ),
      okText: "导入",
    });
    if (!ok) return;
    setImporting(true);
    try {
      const images = new Map<string, string>();
      for (const p of [...toAdd, ...toFill]) {
        const blob = await (await fetch(p.url)).blob();
        images.set(p.name, await resizeImage(blob));
      }
      update((d) => {
        for (const p of toFill) {
          const it = d.items.find((x) => x.name.trim() === p.name);
          if (it && !it.image) it.image = images.get(p.name);
        }
        for (const p of toAdd) d.items.push({ id: uid(), name: p.name, value: 0, image: images.get(p.name), createdAt: Date.now() });
      });
      toast(`已导入：新增 ${toAdd.length} 个，补图 ${toFill.length} 个`);
    } catch (e) {
      toast(`导入失败：${String(e)}`, "err");
    } finally {
      setImporting(false);
    }
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of db.sessions) for (const d of s.drops) if (d.kind === "item") m.set(d.itemId, (m.get(d.itemId) ?? 0) + d.qty);
    return m;
  }, [db.sessions]);

  const list = useMemo(() => {
    const kw = q.trim();
    const arr = db.items.filter((x) => !kw || x.name.includes(kw));
    arr.sort((a, b) => {
      if (sort === "value") return b.value - a.value;
      if (sort === "count") return (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, "zh");
      return a.name.localeCompare(b.name, "zh");
    });
    return arr;
  }, [db.items, q, sort, counts]);

  return (
    <div className="page items-page">
      <div className="page-head">
        <h1>
          物品库
          <span className="count-badge">{q.trim() ? `${list.length} / ${db.items.length}` : db.items.length}</span>
        </h1>
        <div className="actions">
          <input className="search" placeholder="搜索物品…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            <button className={sort === "name" ? "active" : ""} onClick={() => setSort("name")}>
              名称
            </button>
            <button className={sort === "count" ? "active" : ""} onClick={() => setSort("count")}>
              常用
            </button>
            <button className={sort === "value" ? "active" : ""} onClick={() => setSort("value")}>
              价值
            </button>
          </div>
          <button className="btn" onClick={importPresets} disabled={importing}>
            {importing ? "导入中…" : "导入常用物品"}
          </button>
          <button className="btn primary" onClick={() => setEditing("new")}>
            ＋ 新建物品
          </button>
        </div>
      </div>

      <div className="items-content">
        {db.items.length === 0 ? (
          <section className="card empty big">
            <p>物品库还是空的</p>
            <p className="muted">可以先添加常见掉落，例如：高级兽决、金柳露、五宝、宝石、藏宝图……</p>
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <button className="btn" onClick={importPresets} disabled={importing}>
                导入常用物品
              </button>
              <button className="btn primary" onClick={() => setEditing("new")}>
                添加第一个物品
              </button>
            </div>
          </section>
        ) : (
          <div className="item-grid">
            {list.map((it) => (
              <button key={it.id} className="item-card" onClick={() => setEditing(it)}>
                <ItemIcon item={it} size={40} />
                <div className="name" title={it.name}>
                  {it.name}
                </div>
                <div className="gold">{fmtCoin(it.value)}</div>
                <div className="muted count">获得 {counts.get(it.id) ?? 0}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {editing && <ItemEditor item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

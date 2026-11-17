import { useMemo, useState } from "react";
import type { Item } from "../types";
import { useStore } from "../store";
import { fmtCoin, fromWan, resizeImage, toWan, uid } from "../utils";
import { Modal, WanInput, useUi } from "./ui";

export function ItemIcon({ item, name, size = 44 }: { item?: Item; name?: string; size?: number }) {
  const label = item?.name ?? name ?? "?";
  if (item?.image) {
    return <img className="item-icon" src={item.image} alt={label} style={{ width: size, height: size }} />;
  }
  // 没有图片时：统一的宣纸底 + 描金边 + 楷体首字
  return (
    <div className="item-icon placeholder" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {label.slice(0, 1)}
    </div>
  );
}

/** 新建 / 编辑物品 */
export function ItemEditor({
  item,
  initialName = "",
  onClose,
  onSaved,
}: {
  item?: Item;
  initialName?: string;
  onClose: () => void;
  onSaved?: (item: Item) => void;
}) {
  const { db, update } = useStore();
  const { confirm, toast } = useUi();
  const [name, setName] = useState(item?.name ?? initialName);
  const [value, setValue] = useState(item ? toWan(item.value) : "");
  const [image, setImage] = useState<string | undefined>(item?.image);

  const pickImage = async (file?: Blob | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      setImage(await resizeImage(file));
    } catch (e) {
      toast(String(e), "err");
    }
  };

  const save = () => {
    const n = name.trim();
    if (!n) return toast("请填写物品名称", "err");
    const v = value.trim() === "" ? 0 : fromWan(value);
    if (v === null) return toast("估值格式不正确", "err");
    if (db.items.some((x) => x.name === n && x.id !== item?.id)) return toast("已存在同名物品", "err");

    const saved: Item = item ? { ...item, name: n, value: v, image } : { id: uid(), name: n, value: v, image, createdAt: Date.now() };
    update((d) => {
      const i = d.items.findIndex((x) => x.id === saved.id);
      if (i >= 0) d.items[i] = saved;
      else d.items.push(saved);
    });
    toast(item ? "已保存" : "已添加物品");
    onSaved?.(saved);
    onClose();
  };

  const remove = async () => {
    if (!item) return;
    const ok = await confirm({
      title: "删除物品",
      message: `确定删除「${item.name}」？历史记录中已记录的掉落会保留名称和当时的估值。`,
      okText: "删除",
      danger: true,
    });
    if (!ok) return;
    update((d) => {
      d.items = d.items.filter((x) => x.id !== item.id);
    });
    onClose();
  };

  return (
    <Modal
      title={item ? "编辑物品" : "新建物品"}
      onClose={onClose}
      footer={
        <>
          {item && (
            <button className="btn danger ghost" style={{ marginRight: "auto" }} onClick={remove}>
              删除
            </button>
          )}
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="item-editor" onPaste={(e) => pickImage(e.clipboardData.files[0])}>
        <label
          className="image-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pickImage(e.dataTransfer.files[0]);
          }}
        >
          {image ? <img src={image} alt="" /> : <span>点击 / 拖入 / 粘贴图片</span>}
          <input type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        </label>
        <div className="form">
          <div className="field">
            <label>名称</label>
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          </div>
          <div className="field">
            <label>大概价值</label>
            <WanInput value={value} onChange={setValue} placeholder="0" onEnter={save} />
          </div>
          {image && (
            <button className="link" onClick={() => setImage(undefined)}>
              移除图片
            </button>
          )}
          <p className="muted small">提示：截图游戏内物品图标后，在此窗口按 ⌘V / Ctrl+V 即可粘贴。</p>
        </div>
      </div>
    </Modal>
  );
}

/** 可搜索的物品选择网格，支持就地新建 */
export function ItemPicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { db } = useStore();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  // 常用的排前面：按历史掉落次数排序
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of db.sessions) for (const d of s.drops) if (d.kind === "item") m.set(d.itemId, (m.get(d.itemId) ?? 0) + 1);
    return m;
  }, [db.sessions]);

  const list = useMemo(() => {
    const kw = q.trim();
    return db.items
      .filter((x) => !kw || x.name.includes(kw))
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name, "zh"));
  }, [db.items, q, usage]);

  const kw = q.trim();
  const exact = db.items.some((x) => x.name === kw);

  return (
    <div className="picker">
      <input className="search" placeholder="搜索物品…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-grid">
        {list.map((it) => (
          <button key={it.id} className={`picker-cell ${selectedId === it.id ? "active" : ""}`} onClick={() => onSelect(it.id)} title={it.name}>
            <ItemIcon item={it} size={36} />
            <span className="name">{it.name}</span>
            <span className="val">{fmtCoin(it.value)}</span>
          </button>
        ))}
        <button className="picker-cell add" onClick={() => setCreating(exact ? "" : kw)}>
          <span className="plus">＋</span>
          <span className="name">{kw && !exact ? `新建「${kw}」` : "新建物品"}</span>
        </button>
      </div>
      {creating !== null && (
        <ItemEditor
          initialName={creating}
          onClose={() => setCreating(null)}
          onSaved={(it) => {
            setQ("");
            onSelect(it.id);
          }}
        />
      )}
    </div>
  );
}

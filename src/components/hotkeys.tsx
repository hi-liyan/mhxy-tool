import { useState, type KeyboardEvent } from "react";
import type { Hotkeys } from "../types";
import { useStore } from "../store";
import { DEFAULT_HOTKEYS, desktop } from "../storage";
import { useUi } from "./ui";

const ITEMS: { key: keyof Hotkeys; title: string; desc: string }[] = [
  { key: "quickAdd", title: "快速记账", desc: "呼出置顶小窗并聚焦金额输入框，记完一笔或点回游戏后自动收起" },
  { key: "toggleMini", title: "显示 / 隐藏小窗", desc: "让小窗常驻显示计时和收益" },
];

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
// 可作为主键的按键（KeyboardEvent.code 与全局快捷键插件的写法一致，字母和数字去掉前缀）
const NAMED_KEYS = new Set([
  "Space", "Home", "End", "PageUp", "PageDown", "Insert",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash",
]);

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code) || /^Numpad\d$/.test(code) || NAMED_KEYS.has(code)) return code;
  return null;
}

/** 由按键事件生成快捷键写法，如 "Ctrl+Alt+J"；必须包含修饰键 */
export function accelFromEvent(e: KeyboardEvent): string | null {
  const key = keyName(e.code);
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

/** 「设置」中的全局快捷键 */
export function HotkeySettings({ errors }: { errors: Partial<Record<keyof Hotkeys, string>> }) {
  const { db, update } = useStore();
  const { toast } = useUi();
  const [recording, setRecording] = useState<keyof Hotkeys | null>(null);
  const hotkeys = db.settings.hotkeys;

  const save = (key: keyof Hotkeys, value: string | null) => {
    const other = ITEMS.find((it) => it.key !== key && hotkeys[it.key] === value && value !== null);
    if (other) return toast(`与「${other.title}」的快捷键重复`, "err");
    update((d) => {
      d.settings.hotkeys[key] = value;
    });
    setRecording(null);
    toast(value ? `已设置为 ${value}` : "已关闭该快捷键");
  };

  const onKeyDown = (key: keyof Hotkeys, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    if (e.key === "Escape") return void e.currentTarget.blur();
    if (e.key === "Backspace" || e.key === "Delete") return save(key, null);
    if (MODIFIER_CODES.test(e.code)) return;
    const accel = accelFromEvent(e);
    if (!accel) return toast("请同时按下 Ctrl、Alt 或 Shift 再加一个字母、数字或功能键", "err");
    save(key, accel);
  };

  if (!desktop.available) return <p className="muted small">全局快捷键需要在桌面应用中使用。</p>;

  return (
    <div className="hotkey-list">
      {ITEMS.map((it) => (
        <div key={it.key} className="hotkey-item">
          <div className="hotkey-label">
            <b>{it.title}</b>
            <span className="muted small">{it.desc}</span>
          </div>
          <input
            className={`hotkey-input ${recording === it.key ? "recording" : ""}`}
            readOnly
            value={recording === it.key ? "请按下组合键…" : (hotkeys[it.key] ?? "未启用")}
            onFocus={() => setRecording(it.key)}
            onBlur={() => setRecording(null)}
            onKeyDown={(e) => onKeyDown(it.key, e)}
          />
          {hotkeys[it.key] !== DEFAULT_HOTKEYS[it.key] && (
            <button className="link small" onClick={() => save(it.key, DEFAULT_HOTKEYS[it.key])}>
              恢复默认
            </button>
          )}
          {errors[it.key] && <div className="loss small hotkey-error">{errors[it.key]}</div>}
        </div>
      ))}
      <p className="muted small">点击输入框后按下新的组合键，按 Backspace 关闭。游戏里大量使用 Alt 组合键（如 Alt+E、Alt+W），设置时注意避开，否则游戏会收不到这些按键。</p>
    </div>
  );
}

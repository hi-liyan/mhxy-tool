import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "../platform";

/**
 * 顶部标题栏区域：替代原生标题栏，留出拖动空间。
 * 拖动 / 双击缩放由根节点的 data-tauri-drag-region="deep" 统一处理（见 App.tsx）。
 * Windows 右侧绘制最小化 / 最大化 / 关闭按钮；macOS 用系统红绿灯。
 */
export function TitleBar() {
  return <div className="titlebar">{platform === "win" && <WindowControls />}</div>;
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const w = getCurrentWindow();
    const sync = () => w.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const p = w.onResized(sync);
    return () => {
      p.then((un) => un());
    };
  }, []);

  const act = (fn: "minimize" | "toggleMaximize" | "close") => () => {
    if (isTauri()) getCurrentWindow()[fn]();
  };

  return (
    <div className="win-controls">
      <button onClick={act("minimize")} aria-label="最小化" title="最小化">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button onClick={act("toggleMaximize")} aria-label={maximized ? "还原" : "最大化"} title={maximized ? "还原" : "最大化"}>
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M.5.5h9v9h-9z" />
          </svg>
        )}
      </button>
      <button className="close" onClick={act("close")} aria-label="关闭" title="关闭">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M.5.5l9 9M9.5.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

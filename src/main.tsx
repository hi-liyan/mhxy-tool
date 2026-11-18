import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import MiniApp from "./mini/MiniApp";
import { StoreProvider } from "./store";
import { UiProvider } from "./components/ui";
import { MINI_LABEL } from "./desktop";
import "./styles.css";
import { customTitlebar, platform } from "./platform";

// 置顶小窗与主窗口共用同一页面，按窗口标签区分；浏览器预览可用 ?view=mini 查看
const isMini = isTauri() ? getCurrentWindow().label === MINI_LABEL : new URLSearchParams(location.search).get("view") === "mini";

document.documentElement.classList.add(`platform-${platform}`);
if (isMini) document.documentElement.classList.add("mini-window");
else if (customTitlebar) document.documentElement.classList.add("has-titlebar");

// 滚动条属于容器本身，Tauri 会把它当成背景去拖动窗口。
// 在捕获阶段识别「按在滚动条上」，阻止事件继续传到 Tauri 的拖动监听（不影响滚动本身）。
window.addEventListener(
  "mousedown",
  (e) => {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLElement)) return;
    const onVScroll = el.scrollHeight > el.clientHeight && e.offsetX >= el.clientWidth;
    const onHScroll = el.scrollWidth > el.clientWidth && e.offsetY >= el.clientHeight;
    if (onVScroll || onHScroll) e.stopPropagation();
  },
  true,
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isMini ? (
      // 小窗不挂 StoreProvider：数据只由主窗口读写
      <UiProvider>
        <MiniApp />
      </UiProvider>
    ) : (
      <StoreProvider>
        <UiProvider>
          <App />
        </UiProvider>
      </StoreProvider>
    )}
  </React.StrictMode>,
);

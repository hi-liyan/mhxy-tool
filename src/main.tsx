import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./store";
import { UiProvider } from "./components/ui";
import "./styles.css";
import { customTitlebar, platform } from "./platform";

document.documentElement.classList.add(`platform-${platform}`);
if (customTitlebar) document.documentElement.classList.add("has-titlebar");

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
    <StoreProvider>
      <UiProvider>
        <App />
      </UiProvider>
    </StoreProvider>
  </React.StrictMode>,
);

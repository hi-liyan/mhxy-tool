import { isTauri } from "@tauri-apps/api/core";

export type Platform = "mac" | "win" | "other";

/**
 * 当前平台。只有桌面应用里才启用自定义标题栏；
 * 浏览器预览可用 ?platform=mac / ?platform=win 模拟。
 */
function detect(): Platform {
  const forced = new URLSearchParams(location.search).get("platform");
  if (forced === "mac" || forced === "win") return forced;
  if (!isTauri()) return "other";
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "win";
  return "other";
}

export const platform = detect();
/** macOS / Windows 去掉了原生标题栏，需要自绘拖动区 */
export const customTitlebar = platform !== "other";

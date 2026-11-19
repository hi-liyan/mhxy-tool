/**
 * 玩家心得的未读数：侧边栏和工具箱入口共用。后台抓取或在心得页标记后由后端事件推送。
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { feeds, type FeedUpdate } from "./storage";

let unread = 0;
const subscribers = new Set<(n: number) => void>();

function setUnread(n: number) {
  unread = n;
  subscribers.forEach((f) => f(n));
}

export function useFeedUnread(): number {
  const [n, setN] = useState(unread);
  useEffect(() => {
    subscribers.add(setN);
    setN(unread);
    return () => void subscribers.delete(setN);
  }, []);
  return n;
}

/** 订阅后端的心得更新事件（抓取开始、进行中、结束，标记已读） */
export function useFeedEvents(handler: (e: FeedUpdate) => void) {
  useEffect(() => {
    if (!feeds.available) return;
    const off = listen<FeedUpdate>(feeds.EVENT, (e) => handler(e.payload));
    return () => void off.then((f) => f());
  }, [handler]);
}

/** 主窗口挂一次：读取初始未读数并跟随后端更新 */
export function useFeedSync() {
  useEffect(() => {
    if (!feeds.available) return;
    feeds
      .unread()
      .then(setUnread)
      .catch(() => {});
    const off = listen<FeedUpdate>(feeds.EVENT, (e) => setUnread(e.payload.unread));
    return () => void off.then((f) => f());
  }, []);
}

import { useCallback, useState } from "react";
import logo from "./assets/mhxy-logo.png";
import { TitleBar } from "./components/TitleBar";
import { customTitlebar } from "./platform";
import { useNow, useStore } from "./store";
import { fmtClock, fmtCoin, sessionStats, sessionDuration, startOfToday, sumStats } from "./utils";
import { profitTone } from "./components/ui";
import SessionPage from "./pages/SessionPage";
import HistoryPage from "./pages/HistoryPage";
import AnalysisPage from "./pages/AnalysisPage";
import ItemsPage from "./pages/ItemsPage";
import ToolsPage from "./pages/ToolsPage";
import SettingsPage from "./pages/SettingsPage";
import { useDesktop } from "./useDesktop";
import { desktop } from "./storage";

const PAGES = [
  { key: "session", label: "开刷" },
  { key: "history", label: "历史记录" },
  { key: "analysis", label: "统计分析" },
  { key: "items", label: "物品库" },
  { key: "tools", label: "工具箱" },
  { key: "settings", label: "设置" },
] as const;
type PageKey = (typeof PAGES)[number]["key"];

export default function App() {
  const [page, setPage] = useState<PageKey>("session");
  const { db, saveError } = useStore();
  const now = useNow(1000);
  const active = db.sessions.find((s) => s.endAt === null);
  // 托盘或小窗请求下线结算：显示主窗口，切到开刷页并打开结算弹窗
  const [offlineRequested, setOfflineRequested] = useState(false);
  const requestOffline = useCallback(() => {
    if (desktop.available) desktop.mainShow().catch(() => {});
    setPage("session");
    setOfflineRequested(true);
  }, []);
  const { hotkeyErrors } = useDesktop({ onOffline: requestOffline });

  const t0 = startOfToday();
  const today = sumStats(db.sessions.filter((s) => s.startAt >= t0).map((s) => sessionStats(s, now)));

  return (
    <div className="app" data-tauri-drag-region="deep">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="梦幻西游" draggable={false} />
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.key} className={page === p.key ? "active" : ""} onClick={() => setPage(p.key)}>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {active ? (
            <button className="live" onClick={() => setPage("session")}>
              <span className="live-dot" />
              正在刷 {fmtClock(sessionDuration(active, now))}
            </button>
          ) : (
            <div className="muted small">当前未上线</div>
          )}
          <div className="today">
            <span className="muted small">今日净收益</span>
            <b className={profitTone(today.profit)}>{fmtCoin(today.profit)}</b>
          </div>
          {saveError && <div className="save-err">保存失败：{saveError}</div>}
        </div>
      </aside>
      <div className="main-col">
        {customTitlebar && <TitleBar />}
        <main className="main">
          {page === "session" && <SessionPage offlineRequested={offlineRequested} onOfflineHandled={() => setOfflineRequested(false)} />}
          {page === "history" && <HistoryPage />}
          {page === "analysis" && <AnalysisPage />}
          {page === "items" && <ItemsPage />}
          {page === "tools" && <ToolsPage />}
          {page === "settings" && <SettingsPage hotkeyErrors={hotkeyErrors} />}
        </main>
      </div>
    </div>
  );
}

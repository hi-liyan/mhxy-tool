import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DB, Hotkeys, Settings } from "./types";
import { uid } from "./utils";

const LS_KEY = "mhxy-ledger-data";
const inTauri = isTauri();

export const DEFAULT_HOTKEYS: Hotkeys = { quickAdd: "Ctrl+Alt+J", toggleMini: "Ctrl+Alt+M" };

export function defaultDB(): DB {
  return {
    version: 1,
    settings: {
      coinPerPoint: 30_000,
      pointsPerHour: 6,
      goldPrice: 300_000,
      pointsPerYuan: 10,
      cbgServer: null,
      goldHistory: [],
      windfallThreshold: null,
      hotkeys: { ...DEFAULT_HOTKEYS },
    },
    accounts: Array.from({ length: 5 }, (_, i) => ({
      id: uid() + i,
      name: `${i + 1}号`,
      defaultSelected: true,
    })),
    items: [],
    builtinValues: {},
    sessions: [],
  };
}

/** 兼容旧数据 / 缺字段 */
function normalize(raw: Partial<DB>): DB {
  const base = defaultDB();
  return {
    version: 1,
    settings: normalizeSettings(raw.settings, base.settings),
    accounts: Array.isArray(raw.accounts) ? raw.accounts : base.accounts,
    items: Array.isArray(raw.items) ? raw.items : [],
    builtinValues: raw.builtinValues && typeof raw.builtinValues === "object" ? raw.builtinValues : {},
    sessions: Array.isArray(raw.sessions)
      ? raw.sessions.map((s) => ({ ...s, drops: s.drops ?? [], note: s.note ?? "", pointsOverride: s.pointsOverride ?? null }))
      : [],
  };
}

function normalizeSettings(raw: Partial<Settings> | undefined, base: Settings): Settings {
  const s = { ...base, ...(raw ?? {}) };
  s.hotkeys = { ...base.hotkeys, ...(raw?.hotkeys ?? {}) };
  // 旧数据只有 coinPerPoint：反推金价
  if (raw && raw.goldPrice === undefined && raw.coinPerPoint !== undefined) {
    s.goldPrice = raw.coinPerPoint * s.pointsPerYuan;
  }
  return s;
}

export async function loadDB(): Promise<DB> {
  const text = inTauri ? await invoke<string | null>("load_data") : localStorage.getItem(LS_KEY);
  if (!text) return defaultDB();
  return normalize(JSON.parse(text));
}

async function write(content: string) {
  if (inTauri) await invoke("save_data", { content });
  else localStorage.setItem(LS_KEY, content);
}

// 合并频繁写入：同一时间只有一个写操作，期间的修改只保留最新一份
let saving = false;
let pending: string | null = null;

export function saveDB(db: DB, onError: (e: unknown) => void) {
  pending = JSON.stringify(db);
  if (saving) return;
  saving = true;
  (async () => {
    try {
      while (pending !== null) {
        const content = pending;
        pending = null;
        await write(content);
      }
    } catch (e) {
      onError(e);
    } finally {
      saving = false;
    }
  })();
}

export async function backupDB(stamp: string): Promise<string> {
  if (!inTauri) throw new Error("浏览器预览模式不支持备份");
  return invoke<string>("backup_data", { stamp });
}

export async function getDataDir(): Promise<string> {
  if (!inTauri) return "（浏览器预览模式，数据存在 localStorage）";
  return invoke<string>("get_data_dir");
}

export async function openDataDir(): Promise<void> {
  if (!inTauri) throw new Error("浏览器预览模式不支持");
  await invoke("open_data_dir");
}

// ---------- 藏宝阁 ----------

export interface CbgArea {
  id: number;
  name: string;
  servers: { id: number; name: string }[];
}

export interface CbgStatus {
  logged_in: boolean;
  server_id: number | null;
  saved_at: number | null;
  message: string;
}

function requireTauri(feature = "藏宝阁功能") {
  if (!inTauri) throw new Error(`${feature}需要在桌面应用中使用`);
}

export interface GoldQuote {
  server_id: number;
  server_name: string;
  listings: { count: number; price_fen: number; coins_per_yuan: number }[];
  best: number;
  median: number;
  total_pages: number;
  fetched_at: number;
}

export const cbg = {
  available: inTauri,
  servers: async () => (requireTauri(), invoke<CbgArea[]>("cbg_servers", { userAgent: navigator.userAgent })),
  status: async () => (requireTauri(), invoke<CbgStatus>("cbg_status")),
  openLogin: async (serverId: number) => (requireTauri(), invoke<void>("cbg_open_login", { serverId })),
  capture: async (serverId: number) =>
    (requireTauri(), invoke<CbgStatus>("cbg_capture", { serverId, userAgent: navigator.userAgent })),
  logout: async () => (requireTauri(), invoke<void>("cbg_logout")),
  goldPrice: async (serverId: number) => (requireTauri(), invoke<GoldQuote>("cbg_gold_price", { serverId })),
};

// ---------- 玩家心得 ----------

export interface FeedTopic {
  id: string;
  name: string;
  keywords: string[];
  enabled: boolean;
}

export interface FeedSettings {
  auto: boolean;
  /** 来源开关，没有记录的视为开启 */
  sources: Record<string, boolean>;
  topics: FeedTopic[];
  /** 标题含这些词的不进收件箱 */
  exclude: string[];
}

export interface FeedItem {
  id: string;
  source: string;
  url: string;
  title: string;
  author: string | null;
  published: number | null;
  fetched: number;
  summary: string;
  points: string[];
  tags: string[];
  mirrors: { source: string; url: string }[];
  topics: string[];
  excluded: boolean;
  relevance: number;
  score: number;
  read: boolean;
  starred: boolean;
  ignored: boolean;
}

export interface FeedSource {
  key: string;
  name: string;
  enabled: boolean;
  status: { ok: boolean; at: number; message: string; added: number } | null;
}

export interface FeedView {
  settings: FeedSettings;
  sources: FeedSource[];
  last_run: number | null;
  running: boolean;
  unread: number;
  items: FeedItem[];
}

export interface FeedReport {
  added: number;
  matched: number;
  failed: string[];
}

export interface FeedUpdate {
  running: boolean;
  unread: number;
}

const FEEDS = "玩家心得";

export const feeds = {
  available: inTauri,
  state: async () => (requireTauri(FEEDS), invoke<FeedView>("feeds_state")),
  unread: async () => (inTauri ? invoke<number>("feeds_unread") : 0),
  fetchNow: async () => (requireTauri(FEEDS), invoke<FeedReport>("feeds_fetch_now")),
  /** 批量修改已读、收藏、忽略，返回新的未读数 */
  mark: async (ids: string[], patch: { read?: boolean; starred?: boolean; ignored?: boolean }) =>
    (requireTauri(FEEDS), invoke<number>("feeds_mark", { ids, ...patch })),
  saveSettings: async (settings: FeedSettings) => (requireTauri(FEEDS), invoke<FeedView>("feeds_save_settings", { settings })),
  /** 用系统浏览器打开原文 */
  open: async (url: string) => (requireTauri(FEEDS), invoke<void>("feeds_open", { url })),
  /** 后台抓取开始、每抓完一个来源、结束，以及标记已读后都会触发 */
  EVENT: "feeds-updated",
};

// ---------- 桌面端：置顶小窗、托盘、战报图片 ----------

export const desktop = {
  available: inTauri,
  /** transient：由快捷键临时呼出，记完一笔自动隐藏 */
  miniShow: async (transient = false) => (requireTauri("置顶小窗"), invoke<void>("mini_show", { transient })),
  miniHide: async () => (requireTauri("置顶小窗"), invoke<void>("mini_hide")),
  miniToggle: async () => (requireTauri("置顶小窗"), invoke<void>("mini_toggle")),
  miniIsTransient: async () => (inTauri ? invoke<boolean>("mini_is_transient") : false),
  mainShow: async () => (requireTauri("主窗口"), invoke<void>("main_show")),
  trayUpdate: async (status: string, tooltip: string, active: boolean) =>
    (requireTauri("托盘"), invoke<void>("tray_update", { status, tooltip, active })),
};

/** 保存战报图片：桌面端存到「图片/梦幻记账/」并返回路径；浏览器预览下载文件并返回 null */
export async function saveReportImage(png: Blob, fileName: string): Promise<string | null> {
  if (!inTauri) {
    const url = URL.createObjectURL(png);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return null;
  }
  const bytes = new Uint8Array(await png.arrayBuffer());
  return invoke<string>("save_report_image", bytes, { headers: { "x-file-name": fileName } });
}

export async function openReportDir(): Promise<void> {
  if (!inTauri) throw new Error("浏览器预览模式不支持");
  await invoke("open_report_dir");
}

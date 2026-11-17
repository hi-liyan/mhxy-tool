import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DB, Settings } from "./types";
import { uid } from "./utils";

const LS_KEY = "mhxy-ledger-data";
const inTauri = isTauri();

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
    },
    accounts: Array.from({ length: 5 }, (_, i) => ({
      id: uid() + i,
      name: `${i + 1}号`,
      defaultSelected: true,
    })),
    items: [],
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
    sessions: Array.isArray(raw.sessions)
      ? raw.sessions.map((s) => ({ ...s, drops: s.drops ?? [], note: s.note ?? "", pointsOverride: s.pointsOverride ?? null }))
      : [],
  };
}

function normalizeSettings(raw: Partial<Settings> | undefined, base: Settings): Settings {
  const s = { ...base, ...(raw ?? {}) };
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

function requireTauri() {
  if (!inTauri) throw new Error("藏宝阁功能需要在桌面应用中使用");
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

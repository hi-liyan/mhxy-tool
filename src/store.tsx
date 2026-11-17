import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DB } from "./types";
import { loadDB, saveDB } from "./storage";

interface StoreValue {
  db: DB;
  /** 在 db 的深拷贝上修改，然后自动保存 */
  update: (fn: (draft: DB) => void) => void;
  saveError: string | null;
}

const StoreCtx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dbRef = useRef<DB | null>(null);

  useEffect(() => {
    loadDB()
      .then((d) => {
        dbRef.current = d;
        setDb(d);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const update = useCallback((fn: (draft: DB) => void) => {
    if (!dbRef.current) return;
    const next = structuredClone(dbRef.current);
    fn(next);
    dbRef.current = next;
    setDb(next);
    setSaveError(null);
    saveDB(next, (e) => setSaveError(String(e)));
  }, []);

  if (loadError) {
    return (
      <div className="boot">
        <h2>数据读取失败</h2>
        <p>{loadError}</p>
        <p className="muted">为避免覆盖原有数据，应用不会继续启动。请检查数据目录中的 data.json。</p>
      </div>
    );
  }
  if (!db) return <div className="boot">加载中…</div>;

  return <StoreCtx.Provider value={{ db, update, saveError }}>{children}</StoreCtx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore 必须在 StoreProvider 内使用");
  return v;
}

/** 每 interval 毫秒刷新一次的当前时间 */
export function useNow(interval = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

import { useState } from "react";
import type { GoldRecord, Settings } from "../types";
import { useStore } from "../store";
import { cbg, type GoldQuote } from "../storage";
import { fmtCoin } from "../utils";
import { useUi } from "./ui";

/** 更新金价并同步 1 点 = 多少梦幻币，记录变动历史 */
export function applyGold(st: Settings, price: number, source: GoldRecord["source"]) {
  if (st.goldHistory[0]?.price !== price) {
    st.goldHistory = [{ time: Date.now(), price, source }, ...st.goldHistory].slice(0, 50);
  }
  st.goldPrice = price;
  st.coinPerPoint = Math.round(price / st.pointsPerYuan);
}

/** 从藏宝阁拉取当前区服金价（取单价最低 15 单的中位数）并应用 */
export function useGoldRefresh() {
  const { db, update } = useStore();
  const { toast } = useUi();
  const [loading, setLoading] = useState(false);
  const server = db.settings.cbgServer;

  const refresh = async (): Promise<GoldQuote | null> => {
    if (!server) {
      toast("请先在「设置 → 藏宝阁」中选择区服并登录", "err");
      return null;
    }
    setLoading(true);
    try {
      const q = await cbg.goldPrice(server.id);
      const price = Math.round(q.median);
      update((d) => applyGold(d.settings, price, "cbg"));
      toast(`${q.server_name} 金价：1 元 = ${fmtCoin(price)}`);
      return q;
    } catch (e) {
      toast(String(e), "err");
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { refresh, loading, available: cbg.available && !!server };
}

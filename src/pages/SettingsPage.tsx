import { useEffect, useState } from "react";
import { useStore } from "../store";
import { WanInput, useUi } from "../components/ui";
import { backupDB, getDataDir, openDataDir } from "../storage";
import { fmtCoin, fmtDateTime, fmtPoints, fromWan, stampNow, toWan, uid } from "../utils";
import { CbgPanel } from "../components/CbgPanel";
import { applyGold, useGoldRefresh } from "../components/gold";
import type { GoldQuote } from "../storage";

export default function SettingsPage() {
  const { db, update } = useStore();
  const { confirm, toast } = useUi();
  const [gold, setGold] = useState(toWan(db.settings.goldPrice));
  const [pointsPerYuan, setPointsPerYuan] = useState(String(db.settings.pointsPerYuan));
  const [pointsPerHour, setPointsPerHour] = useState(String(db.settings.pointsPerHour));
  const [dataDir, setDataDir] = useState("");

  useEffect(() => {
    getDataDir().then(setDataDir).catch((e) => setDataDir(String(e)));
  }, []);

  const goldV = fromWan(gold);
  const ppy = parseFloat(pointsPerYuan);
  const pph = parseFloat(pointsPerHour);
  const valid = goldV !== null && goldV > 0 && Number.isFinite(ppy) && ppy > 0 && Number.isFinite(pph) && pph >= 0;
  const coinPerPoint = valid ? Math.round(goldV / ppy) : 0;

  const saveRates = () => {
    if (!valid) return toast("请检查金价、点卡价格和每小时点数", "err");
    update((d) => {
      d.settings.pointsPerYuan = ppy;
      d.settings.pointsPerHour = pph;
      applyGold(d.settings, goldV, "manual");
    });
    toast("已保存（对之后开刷的场次生效）");
  };

  const gold$ = useGoldRefresh();
  const [quote, setQuote] = useState<GoldQuote | null>(null);
  const fetchGold = async () => {
    const q = await gold$.refresh();
    if (q) {
      setQuote(q);
      setGold(toWan(Math.round(q.median)));
    }
  };

  const n = db.accounts.filter((a) => a.defaultSelected).length || db.accounts.length || 5;

  const removeAccount = async (id: string, name: string) => {
    const ok = await confirm({ title: "删除账号", message: `确定删除「${name}」？历史记录不受影响。`, okText: "删除", danger: true });
    if (ok)
      update((d) => {
        d.accounts = d.accounts.filter((a) => a.id !== id);
      });
  };

  const move = (i: number, dir: -1 | 1) =>
    update((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.accounts.length) return;
      [d.accounts[i], d.accounts[j]] = [d.accounts[j], d.accounts[i]];
    });

  return (
    <div className="page">
      <h1>设置</h1>

      <section className="card">
        <h2>金价与点卡</h2>
        <div className="grid-3">
          <div className="field">
            <label>金价：1 元 = 多少梦幻币</label>
            <WanInput value={gold} onChange={setGold} onEnter={saveRates} />
          </div>
          <div className="field">
            <label>点卡：1 元 = 多少点（官方 10 点）</label>
            <div className="input-unit">
              <input type="number" min={0} step="any" value={pointsPerYuan} onChange={(e) => setPointsPerYuan(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRates()} />
              <span>点</span>
            </div>
          </div>
          <div className="field">
            <label>每号每小时消耗（官方 6 点）</label>
            <div className="input-unit">
              <input type="number" min={0} step="any" value={pointsPerHour} onChange={(e) => setPointsPerHour(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRates()} />
              <span>点</span>
            </div>
          </div>
        </div>
        <div className="start-row">
          <div className="muted">
            {valid ? (
              <>
                1 点 = <b className="gold">{fmtCoin(coinPerPoint)}</b> 梦幻币 · {n} 个号刷 1 小时 = {fmtPoints(n * pph)} 点 ≈{" "}
                <b className="gold">{fmtCoin(n * pph * coinPerPoint)}</b>
              </>
            ) : (
              "请填写有效数值"
            )}
          </div>
          <div className="row">
            {gold$.available && (
              <button className="btn" onClick={fetchGold} disabled={gold$.loading}>
                {gold$.loading ? "获取中…" : "从藏宝阁获取金价"}
              </button>
            )}
            <button className="btn primary" onClick={saveRates}>
              保存
            </button>
          </div>
        </div>
        {quote && (
          <div className="quote">
            <div>
              <b>{quote.server_name}</b> 梦幻币寄售（共 {quote.total_pages} 页），单价最低的 {quote.listings.length} 单：最低 1 元 ={" "}
              <b className="gold">{fmtCoin(quote.best)}</b>，中位数 1 元 = <b className="gold">{fmtCoin(quote.median)}</b>（已采用中位数）
            </div>
            <div className="quote-list">
              {quote.listings.map((l, i) => (
                <span key={i} className="chip static">
                  {fmtCoin(l.count)} / {(l.price_fen / 100).toFixed(2)} 元
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="muted small">修改只影响之后开刷的场次；已有记录可在「历史记录」里手动修正点卡消耗。</p>
        {db.settings.goldHistory.length > 0 && (
          <div className="gold-history">
            <span className="muted small">最近金价：</span>
            {db.settings.goldHistory.slice(0, 6).map((g) => (
              <span key={g.time} className="chip static">
                {fmtDateTime(g.time)} · {fmtCoin(g.price)}/元{g.source === "cbg" ? " · 藏宝阁" : ""}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>藏宝阁</h2>
        <CbgPanel />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>账号</h2>
          <button
            className="btn"
            onClick={() =>
              update((d) => {
                d.accounts.push({ id: uid(), name: `${d.accounts.length + 1}号`, defaultSelected: true });
              })
            }
          >
            ＋ 添加账号
          </button>
        </div>
        <div className="account-list">
          {db.accounts.map((a, i) => (
            <div key={a.id} className="account-item">
              <span className="idx">{i + 1}</span>
              <input
                value={a.name}
                onChange={(e) =>
                  update((d) => {
                    const x = d.accounts.find((y) => y.id === a.id);
                    if (x) x.name = e.target.value;
                  })
                }
              />
              <label className="switch">
                <input
                  type="checkbox"
                  checked={a.defaultSelected}
                  onChange={(e) =>
                    update((d) => {
                      const x = d.accounts.find((y) => y.id === a.id);
                      if (x) x.defaultSelected = e.target.checked;
                    })
                  }
                />
                开刷时默认勾选
              </label>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} title="上移">
                ↑
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === db.accounts.length - 1} title="下移">
                ↓
              </button>
              <button className="icon-btn del" onClick={() => removeAccount(a.id, a.name)} title="删除">
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>数据</h2>
        <p className="muted small">所有数据保存在本地目录（data.json），备份在其中的 backups 文件夹：</p>
        <code className="path" data-tauri-drag-region="false">{dataDir}</code>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => openDataDir().catch((e) => toast(String(e), "err"))}>
            打开数据目录
          </button>
          <button
            className="btn"
            onClick={() =>
              backupDB(stampNow())
                .then((p) => toast(`已备份到 ${p}`))
                .catch((e) => toast(String(e), "err"))
            }
          >
            立即备份
          </button>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { cbg, type CbgArea, type CbgStatus } from "../storage";
import { fmtDateTime } from "../utils";
import { useUi } from "./ui";

/** 藏宝阁：区服选择 + 登录授权 */
export function CbgPanel() {
  const { db, update } = useStore();
  const { toast, confirm } = useUi();
  const server = db.settings.cbgServer;
  const [areas, setAreas] = useState<CbgArea[] | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [status, setStatus] = useState<CbgStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const capturing = useRef(false);

  useEffect(() => {
    if (!cbg.available) return;
    cbg
      .servers()
      .then((list) => {
        setAreas(list);
        if (server) setAreaId(list.find((a) => a.servers.some((s) => s.id === server.id))?.id ?? null);
      })
      .catch((e) => toast(String(e), "err"));
    cbg.status().then(setStatus).catch(() => {});
  }, []);

  const capture = async (silent: boolean) => {
    if (!server || capturing.current) return;
    capturing.current = true;
    try {
      const s = await cbg.capture(server.id);
      setStatus(s);
      if (s.logged_in) toast("藏宝阁登录成功");
      else if (!silent) toast(s.message, "err");
    } catch (e) {
      if (!silent) toast(String(e), "err");
    } finally {
      capturing.current = false;
    }
  };

  // 登录窗口跳离登录页时自动尝试保存会话
  useEffect(() => {
    if (!cbg.available || !server) return;
    const p = listen<string>("cbg-navigated", () => capture(true));
    return () => {
      p.then((un) => un());
    };
  }, [server?.id]);

  if (!cbg.available) {
    return <p className="muted">藏宝阁功能需要在桌面应用中使用（当前是浏览器预览模式）。</p>;
  }

  const area = areas?.find((a) => a.id === areaId);
  // 合服后多个服务器名会共用同一个 id，所以按 id + 名称定位
  const serverIdx = server && area ? area.servers.findIndex((s) => s.id === server.id && s.name === server.name) : -1;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const ok = await confirm({ title: "退出藏宝阁", message: "将清除本地保存的藏宝阁登录信息。", okText: "退出" });
    if (ok) run(async () => {
      await cbg.logout();
      setStatus(await cbg.status());
    });
  };

  return (
    <div className="form">
      <div className="grid-2">
        <div className="field">
          <label>大区</label>
          <select value={areaId ?? ""} onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)} disabled={!areas}>
            <option value="">{areas ? "请选择大区" : "加载中…"}</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>服务器</label>
          <select
            value={serverIdx >= 0 ? serverIdx : ""}
            disabled={!area}
            onChange={(e) => {
              const s = area?.servers[Number(e.target.value)];
              if (!s || !area) return;
              update((d) => {
                d.settings.cbgServer = { id: s.id, name: s.name, areaName: area.name };
              });
            }}
          >
            <option value="">请选择服务器</option>
            {area?.servers.map((s, i) => (
              <option key={`${s.id}-${s.name}`} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cbg-status">
        <span className={`dot ${status?.logged_in ? "on" : ""}`} />
        <span>
          {server ? `${server.areaName} · ${server.name}` : "未选择区服"}
          {" — "}
          {status ? status.message : "检查中…"}
          {status?.logged_in && status.saved_at && <span className="muted small">（{fmtDateTime(status.saved_at)} 授权）</span>}
        </span>
        {status?.logged_in && status.server_id !== server?.id && server && (
          <span className="loss small">登录的区服与当前选择不一致，建议重新登录</span>
        )}
      </div>

      <div className="row">
        <button className="btn primary" disabled={!server || busy} onClick={() => run(() => cbg.openLogin(server!.id))}>
          登录藏宝阁
        </button>
        <button className="btn" disabled={!server || busy} onClick={() => capture(false)}>
          我已登录，保存
        </button>
        <button className="btn" disabled={busy} onClick={() => run(async () => setStatus(await cbg.status()))}>
          检查状态
        </button>
        {status?.logged_in && (
          <button className="btn danger ghost" disabled={busy} onClick={logout}>
            退出登录
          </button>
        )}
      </div>
      <p className="muted small">
        点「登录藏宝阁」会打开官方登录页，在里面扫码或输入密码登录即可，登录成功后窗口会自动关闭。应用只保存登录后的 Cookie（数据目录下的
        cbg_session.json），不会接触你的密码；只在你手动刷新金价时才请求藏宝阁。
      </p>
    </div>
  );
}

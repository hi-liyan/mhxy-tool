import { useEffect, useMemo, useState } from "react";
import type { Session } from "../types";
import { useStore } from "../store";
import { autoThreshold } from "../analysis";
import { buildReport, renderReport } from "../report";
import { desktop, openReportDir, saveReportImage } from "../storage";
import { stampNow } from "../utils";
import { Modal, useUi } from "./ui";

/** 战报分享图预览：复制到剪贴板或保存为图片 */
export function ReportModal({
  title,
  rangeText,
  sessions,
  single = false,
  onClose,
}: {
  title: string;
  rangeText: string;
  sessions: Session[];
  single?: boolean;
  onClose: () => void;
}) {
  const { db, items } = useStore();
  const { toast } = useUi();
  const [showAccounts, setShowAccounts] = useState(false);
  const [showItems, setShowItems] = useState(true);
  const [png, setPng] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const threshold = useMemo(
    () => db.settings.windfallThreshold ?? autoThreshold(db.sessions.filter((s) => s.endAt !== null)),
    [db.settings.windfallThreshold, db.sessions],
  );

  useEffect(() => {
    let alive = true;
    setError(null);
    const data = buildReport({ title, rangeText, sessions, single }, items, threshold, { showAccounts, showItems });
    renderReport(data)
      .then((b) => alive && setPng(b))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [title, rangeText, sessions, single, items, threshold, showAccounts, showItems]);

  const url = useMemo(() => (png ? URL.createObjectURL(png) : null), [png]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const copy = async () => {
    if (!png) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast("已复制，可以直接粘贴到聊天窗口");
    } catch {
      toast("复制失败，请改用「保存图片」", "err");
    }
  };

  const save = async () => {
    if (!png || busy) return;
    setBusy(true);
    try {
      const path = await saveReportImage(png, `report-${stampNow()}.png`);
      toast(path ? `已保存到 ${path}` : "已下载图片");
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="生成战报"
      onClose={onClose}
      width={560}
      footer={
        <>
          {desktop.available && (
            <button className="btn ghost" onClick={() => openReportDir().catch((e) => toast(String(e), "err"))}>
              打开图片文件夹
            </button>
          )}
          <button className="btn" onClick={save} disabled={!png || busy}>
            保存图片
          </button>
          <button className="btn primary" onClick={copy} disabled={!png}>
            复制图片
          </button>
        </>
      }
    >
      <div className="report-options">
        <label>
          <input type="checkbox" checked={showItems} onChange={(e) => setShowItems(e.target.checked)} /> 显示出货明细
        </label>
        {single && (
          <label>
            <input type="checkbox" checked={showAccounts} onChange={(e) => setShowAccounts(e.target.checked)} /> 显示账号名
          </label>
        )}
      </div>
      <div className="report-preview" data-tauri-drag-region="false">
        {error ? <div className="loss">{error}</div> : url ? <img src={url} alt={title} /> : <div className="muted">正在生成…</div>}
      </div>
    </Modal>
  );
}

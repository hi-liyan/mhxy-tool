import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------- Modal ----------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-mask" data-tauri-drag-region="false" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirm + Toast ----------

interface ConfirmOpts {
  title?: string;
  message: ReactNode;
  okText?: string;
  danger?: boolean;
}

interface UiValue {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  toast: (msg: string, type?: "ok" | "err") => void;
}

const UiCtx = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: "ok" | "err" }[]>([]);
  const seq = useRef(0);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })),
    [],
  );

  const toast = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <UiCtx.Provider value={{ confirm, toast }}>
      {children}
      {dialog && (
        <Modal
          title={dialog.title ?? "确认"}
          onClose={() => close(false)}
          width={400}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>
                取消
              </button>
              <button className={dialog.danger ? "btn danger" : "btn primary"} onClick={() => close(true)} autoFocus>
                {dialog.okText ?? "确定"}
              </button>
            </>
          }
        >
          <div className="confirm-msg">{dialog.message}</div>
        </Modal>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </UiCtx.Provider>
  );
}

export function useUi(): UiValue {
  const v = useContext(UiCtx);
  if (!v) throw new Error("useUi 必须在 UiProvider 内使用");
  return v;
}

// ---------- 小组件 ----------

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | "gold" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub != null && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function profitTone(n: number): "gain" | "loss" {
  return n >= 0 ? "gain" : "loss";
}

/** 以"万"为单位的金额输入框 */
export function WanInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div className="input-unit">
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      <span>万</span>
    </div>
  );
}

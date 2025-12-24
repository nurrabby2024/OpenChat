import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type Toast = { id: string; title: string; detail?: string; kind?: "ok" | "warn" | "err" };

const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const toast: Toast = { id, ...t };
    setToasts((prev) => [toast, ...prev].slice(0, 4));
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 2800);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(520px,calc(100vw-24px))] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "rounded-2xl border border-line bg-[rgba(5,8,10,0.85)] backdrop-blur px-4 py-3 shadow-glow",
              "transition-all duration-300",
              t.kind === "err" ? "border-[rgba(255,84,104,0.35)]" : t.kind === "warn" ? "border-[rgba(255,191,71,0.35)]" : "border-[rgba(125,255,207,0.22)]",
            ].join(" ")}
            role="status"
            aria-live="polite"
          >
            <div className="text-sm font-mono text-text">{t.title}</div>
            {t.detail ? <div className="mt-0.5 text-xs font-mono text-muted">{t.detail}</div> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

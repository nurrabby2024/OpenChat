import React, { useEffect, useRef } from "react";

export function ConnectModal(props: {
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
  canConnect: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) return;
    window.setTimeout(() => btnRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm" />
      <div className="relative w-[min(520px,100%)] rounded-2xl border border-line bg-[rgba(5,8,10,0.92)] shadow-glow">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div className="text-base font-mono text-text">Connect wallet</div>
          <button onClick={props.onClose} className="text-xs font-mono text-muted hover:text-text">Esc</button>
        </div>

        <div className="px-5 py-5">
          <div className="text-sm font-mono text-muted">
            One click connect. You'll approve transactions to publish messages onchain.
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-[rgba(255,255,255,0.02)] p-4">
            <div className="text-xs font-mono text-muted">Network</div>
            <div className="mt-1 text-sm font-mono text-text">Base Mainnet (0x2105)</div>
            <div className="mt-2 text-xs font-mono text-muted">If you're on another chain, we'll ask your wallet to switch.</div>
          </div>

          <button
            ref={btnRef}
            onClick={props.onConnect}
            disabled={!props.canConnect}
            className={[
              "mt-5 w-full rounded-2xl border px-4 py-3 text-sm font-mono transition",
              props.canConnect
                ? "border-[rgba(125,255,207,0.25)] bg-[rgba(125,255,207,0.06)] text-text hover:shadow-glow"
                : "border-line bg-[rgba(255,255,255,0.02)] text-muted opacity-60"
            ].join(" ")}
          >
            Connect wallet
          </button>

          {!props.canConnect ? (
            <div className="mt-3 text-xs font-mono text-warn">
              No injected wallet provider detected. Open inside a wallet-enabled Farcaster Mini App container.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "./toast";
import { clamp } from "../lib/format";

export function Composer(props: {
  disabled: boolean;
  connected: boolean;
  onConnect: () => void;
  onSend: (text: string) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
  myAddress: string;
  chainId: string;
  reducedMotion: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [helper, setHelper] = useState<string>("Approve tx to publish onchain");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const maxChars = 280;
  const charCount = text.length;
  const over = charCount > maxChars;

  useEffect(() => {
    if (!cooldown) return;
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 0.02)), 50);
    return () => window.clearInterval(t);
  }, [cooldown]);

  const preflight = () => {
    if (!props.connected) {
      setHelper("Connect wallet to speak");
      return false;
    }
    if (props.chainId && props.chainId !== "0x2105") {
      setHelper("Switch to Base to publish");
      return true; // we will attempt switch on send
    }
    if (!text.trim()) {
      setHelper("Message cannot be empty");
      return false;
    }
    if (over) {
      setHelper("Too long — shorten message");
      return false;
    }
    return true;
  };

  const doSend = async () => {
    if (!preflight()) {
      if (!props.connected) props.onConnect();
      return;
    }
    if (cooldown > 0.05) {
      toast.push({ title: "Slow down—network needs time", detail: "Try again in a moment.", kind: "warn" });
      return;
    }
    const msg = text.trim();
    setSending(true);
    setHelper("Waiting for approval…");
    try {
      const r = await props.onSend(msg);
      if (r.ok) {
        setText("");
        setCooldown(1);
        setHelper("Approve tx to publish onchain");
      } else if (r.cancelled) {
        setHelper("Approve tx to publish onchain");
      } else {
        setHelper(r.error ? `Failed — ${r.error}` : "Failed — retry");
      }
    } finally {
      setSending(false);
      window.setTimeout(() => setHelper("Approve tx to publish onchain"), 2200);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const disabled = props.disabled || sending || !props.connected;

  return (
    <div className="px-4 pb-5">
      <div className="rounded-2xl border border-line bg-panel backdrop-blur px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="flex items-end gap-3">
          <div className="text-accent font-mono text-lg leading-none pb-2 select-none">&gt;</div>
          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!props.connected || sending}
              rows={1}
              className={[
                "w-full resize-none bg-transparent outline-none font-mono text-sm text-text placeholder:text-muted",
                "leading-6 max-h-32",
                !props.connected ? "opacity-60" : "",
              ].join(" ")}
              placeholder={props.connected ? "type a message…" : "Connect wallet to speak"}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs font-mono text-muted">
                {helper}
              </div>
              <button
                onClick={props.connected ? doSend : props.onConnect}
                disabled={props.disabled || sending}
                className={[
                  "h-10 w-10 rounded-xl border grid place-items-center transition",
                  props.connected ? "border-[rgba(125,255,207,0.30)] bg-[rgba(125,255,207,0.08)] text-text hover:shadow-glow"
                                 : "border-line bg-[rgba(255,255,255,0.02)] text-muted hover:shadow-glow",
                  (props.disabled || sending) ? "opacity-60 pointer-events-none" : ""
                ].join(" ")}
                aria-label={props.connected ? "Send message" : "Connect wallet"}
                title={props.connected ? "Send" : "Connect wallet"}
              >
                {sending ? <span className="h-3 w-3 rounded-full border border-line border-t-accent animate-spin" /> : <SendIcon />}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between text-xs font-mono text-muted">
              <div className="flex items-center gap-3">
                <span className={over ? "text-err" : ""}>{charCount}/{maxChars}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                  <div className="h-full bg-[rgba(125,255,207,0.35)]" style={{ width: `${Math.round((1 - clamp(cooldown,0,1)) * 100)}%` }} />
                </div>
                <span className="opacity-70">cooldown</span>
              </div>
            </div>

            {!props.connected ? (
              <div className="mt-3">
                <button
                  onClick={props.onConnect}
                  className="w-full rounded-2xl border border-[rgba(125,255,207,0.25)] bg-[rgba(125,255,207,0.06)] px-4 py-3 text-sm font-mono text-text hover:shadow-glow transition"
                >
                  Connect wallet
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="opacity-90">
      <path d="M3 11.5 21 3l-8.5 18-2.5-7-7-2.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 14 21 3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

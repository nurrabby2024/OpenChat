import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "../lib/types";
import { hhmm, shortAddr } from "../lib/format";

export function Chat(props: {
  loading: boolean;
  messages: ChatMessage[];
  myAddress: string;
  reducedMotion: boolean;
  rpcExplorerBase: string; // e.g. https://basescan.org/tx/
}) {
  const { messages } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewChip, setShowNewChip] = useState(false);
  const lastCountRef = useRef(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
      setIsAtBottom(nearBottom);
      if (nearBottom) setShowNewChip(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const prev = lastCountRef.current;
    lastCountRef.current = messages.length;
    if (messages.length > prev && !isAtBottom) setShowNewChip(true);
    if (messages.length > prev && isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: props.reducedMotion ? "auto" : "smooth" });
    }
  }, [messages.length, isAtBottom, props.reducedMotion]);

  const onJumpBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: props.reducedMotion ? "auto" : "smooth" });
    setShowNewChip(false);
  };

  return (
    <div className="flex-1 px-4 pb-3 pt-3 overflow-hidden">
      <div className="h-full rounded-2xl border border-line bg-[rgba(0,0,0,0.15)] overflow-hidden">
        <div ref={scrollerRef} className="h-full overflow-y-auto overscroll-contain">
          <div className="p-4 space-y-1">
            {props.loading ? <Skeleton /> : null}

            {messages.map((m) => (
              <MessageRow
                key={m.id}
                msg={m}
                mine={props.myAddress && m.from.toLowerCase() === props.myAddress.toLowerCase()}
                explorerBase={props.rpcExplorerBase}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {showNewChip ? (
          <button
            onClick={onJumpBottom}
            className="absolute left-1/2 -translate-x-1/2 bottom-28 rounded-full border border-line bg-[rgba(5,8,10,0.85)] backdrop-blur px-4 py-2 text-xs font-mono text-text shadow-glow hover:shadow-glow transition"
          >
            New messages
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MessageRow({ msg, mine, explorerBase }: { msg: ChatMessage; mine: boolean; explorerBase: string }) {
  const [hover, setHover] = useState(false);

  const statusBadge =
    msg.status === "pending"
      ? <span className="inline-flex items-center gap-2 text-xs text-muted"><Spinner /> awaiting confirmation</span>
      : msg.status === "confirmed"
      ? <span className="inline-flex items-center gap-2 text-xs text-muted"><Check /> confirmed</span>
      : <span className="inline-flex items-center gap-2 text-xs text-err">failed</span>;

  const lineClass =
    msg.status === "pending"
      ? "opacity-70"
      : msg.status === "failed"
      ? "text-err"
      : "text-text";

  const addrLabel = mine ? "@me" : "@" + shortAddr(msg.from);

  const onCopy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); } catch {}
  };

  return (
    <div
      className={[
        "rounded-xl px-2 py-1.5 border border-transparent",
        "hover:border-line hover:bg-[rgba(255,255,255,0.02)] transition",
        msg.status === "failed" ? "border-[rgba(255,84,104,0.20)] bg-[rgba(255,84,104,0.04)]" : "",
      ].join(" ")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={"font-mono text-sm leading-6 " + lineClass}>
            <span className="text-muted">[{hhmm(msg.createdAtMs)}]</span>{" "}
            <button
              onClick={() => onCopy(msg.from)}
              className="text-accent hover:underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[rgba(125,255,207,0.45)] rounded"
              title="Copy address"
            >
              {addrLabel}
            </button>{" "}
            <span className="text-muted">:</span>{" "}
            <MsgText text={msg.text} />
          </div>
          <div className="mt-0.5 font-mono text-xs text-muted">
            {msg.status === "pending" && msg.error ? <span className="mr-2">{msg.error}</span> : null}
            {statusBadge}
          </div>
        </div>

        <div className={"flex items-center gap-2 " + (hover ? "opacity-100" : "opacity-0") + " transition-opacity"}>
          <IconBtn label="Copy text" onClick={() => onCopy(msg.text)} />
          {msg.txHash ? <IconBtn label="Copy tx" onClick={() => onCopy(msg.txHash!)} /> : null}
          {msg.txHash ? (
            <a
              className="h-8 w-8 rounded-lg border border-line bg-[rgba(255,255,255,0.02)] grid place-items-center hover:shadow-glow transition"
              href={explorerBase + msg.txHash}
              target="_blank"
              rel="noreferrer"
              aria-label="Open explorer"
              title="Open explorer"
            >
              <Ext />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MsgText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > 220;
  const shown = !tooLong || expanded ? text : text.slice(0, 220) + "…";

  return (
    <span>
      {shown}
      {tooLong ? (
        <button
          className="ml-2 text-xs font-mono text-accent hover:underline underline-offset-4"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Fold" : "Expand"}
        </button>
      ) : null}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 pb-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-5 rounded-lg bg-[rgba(255,255,255,0.03)] animate-pulse" />
      ))}
      <div className="h-5 rounded-lg bg-[rgba(255,255,255,0.02)] animate-pulse w-[70%]" />
    </div>
  );
}

function IconBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="h-8 w-8 rounded-lg border border-line bg-[rgba(255,255,255,0.02)] grid place-items-center hover:shadow-glow transition"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Copy />
    </button>
  );
}

function Spinner() {
  return <span className="inline-block h-3 w-3 rounded-full border border-line border-t-accent animate-spin" />;
}
function Check() {
  return <span className="inline-block h-3 w-3 rounded-full border border-[rgba(67,245,156,0.35)] bg-[rgba(67,245,156,0.10)]" />;
}
function Copy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="opacity-80">
      <path d="M8 8h11v11H8V8Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function Ext() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="opacity-80">
      <path d="M14 3h7v7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 14 21 3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

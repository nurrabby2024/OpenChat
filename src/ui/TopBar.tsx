import React, { useEffect, useMemo, useRef, useState } from "react";

export function TopBar(props: {
  handle: string;
  connectedLabel: string;
  status: "green"|"yellow"|"red";
  statusNote?: string;
  onConnect: () => void;
  filters: { onlyMine: boolean; showPending: boolean; search: string };
  setFilters: (f: { onlyMine: boolean; showPending: boolean; search: string }) => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
}) {
  const { filters, setFilters } = props;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = (e.key.toLowerCase() === "k") && (e.metaKey || e.ctrlKey);
      if (isK) {
        e.preventDefault();
        setSearchOpen(true);
        setPaletteOpen(false);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dotClass = props.status === "green"
    ? "bg-ok shadow-[0_0_0_6px_rgba(67,245,156,0.10)]"
    : props.status === "yellow"
    ? "bg-warn shadow-[0_0_0_6px_rgba(255,191,71,0.10)]"
    : "bg-err shadow-[0_0_0_6px_rgba(255,84,104,0.10)]";

  const badge = (label: string) => (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs font-mono text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-accent opacity-70" />
      {label}
    </span>
  );

  return (
    <div className="px-4 pt-4">
      <div className="rounded-2xl border border-line bg-panel backdrop-blur px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="text-sm font-mono text-text truncate">
              OpenChat/@{props.handle}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            {badge("#mesh")}
            {badge("Base")}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => setPaletteOpen((v) => !v)}
                className="rounded-xl border border-line bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs font-mono text-muted hover:shadow-glow transition"
                aria-haspopup="dialog"
                aria-expanded={paletteOpen}
              >
                Filters
              </button>
              <button
                onClick={() => setSearchOpen(true)}
                className="rounded-xl border border-line bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs font-mono text-muted hover:shadow-glow transition"
              >
                Search <span className="opacity-60">⌘K</span>
              </button>
            </div>

            <button
              onClick={props.onConnect}
              className="rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs font-mono text-text hover:shadow-glow transition"
            >
              {props.connectedLabel}
            </button>

            <div className="flex items-center gap-2 rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <span className={"h-2 w-2 rounded-full " + dotClass} aria-label={"RPC status " + props.status} />
              <span className="hidden sm:inline text-xs font-mono text-muted">{props.statusNote || "healthy"}</span>
            </div>
          </div>
        </div>

        {/* Filter palette */}
        {paletteOpen ? (
          <div className="mt-3 rounded-2xl border border-line bg-[rgba(5,8,10,0.55)] p-3">
            <div className="text-xs font-mono text-muted mb-2">terminal palette</div>
            <div className="flex flex-wrap gap-2">
              <Toggle
                label={filters.onlyMine ? "Only mine: on" : "Only mine: off"}
                on={filters.onlyMine}
                onToggle={() => setFilters({ ...filters, onlyMine: !filters.onlyMine })}
              />
              <Toggle
                label={filters.showPending ? "Show pending: on" : "Show pending: off"}
                on={filters.showPending}
                onToggle={() => setFilters({ ...filters, showPending: !filters.showPending })}
              />
              <Toggle
                label={props.reducedMotion ? "Reduced motion: on" : "Reduced motion: off"}
                on={props.reducedMotion}
                onToggle={() => props.setReducedMotion(!props.reducedMotion)}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Search overlay */}
      {searchOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center pt-24 px-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}
        >
          <div className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm" />
          <div className="relative w-[min(720px,100%)] rounded-2xl border border-line bg-[rgba(5,8,10,0.92)] shadow-glow">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-mono text-text">Search</div>
              <button className="text-xs font-mono text-muted hover:text-text" onClick={() => setSearchOpen(false)}>Esc</button>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 rounded-2xl border border-line bg-[rgba(255,255,255,0.02)] px-3 py-2">
                <span className="text-sm font-mono text-muted">/</span>
                <input
                  ref={searchRef}
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="w-full bg-transparent outline-none text-sm font-mono text-text placeholder:text-muted"
                  placeholder="type to highlight…"
                />
              </div>
              <div className="mt-3 text-xs font-mono text-muted">
                Tip: Cmd/Ctrl+K • matches highlight instantly
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={[
        "rounded-xl border px-3 py-2 text-xs font-mono transition",
        on ? "border-[rgba(125,255,207,0.35)] bg-[rgba(125,255,207,0.08)] text-text shadow-glow"
           : "border-line bg-[rgba(255,255,255,0.02)] text-muted hover:shadow-glow",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

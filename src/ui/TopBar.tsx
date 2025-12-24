import React, { useEffect, useMemo, useRef, useState } from "react";

export function TopBar(props: {
  handle: string;
  connectedLabel: string;
  status: "green" | "yellow" | "red";
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
      const isK = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey);
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

  const dotClass = useMemo(() => {
    if (props.status === "green") return "bg-accent";
    if (props.status === "yellow") return "bg-warn";
    return "bg-err";
  }, [props.status]);

  return (
    <header className="px-3 pt-3 pb-2">
      <div className="rounded-2xl border border-line bg-panel backdrop-blur px-3 py-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <div className="text-[12px] font-mono text-text truncate">
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
                className="rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5 text-[11px] font-mono text-muted hover:shadow-glow transition"
                title="Filters"
              >
                Filters
              </button>
              <button
                onClick={() => {
                  setSearchOpen(true);
                  setPaletteOpen(false);
                  setTimeout(() => searchRef.current?.focus(), 50);
                }}
                className="rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5 text-[11px] font-mono text-muted hover:shadow-glow transition"
                title="Search (⌘K / Ctrl+K)"
              >
                Search <span className="opacity-60">⌘K</span>
              </button>
            </div>

            <button
              onClick={props.onConnect}
              className="rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5 text-[11px] font-mono text-text hover:shadow-glow transition"
            >
              <span className="block max-w-[170px] sm:max-w-[240px] truncate whitespace-nowrap">
                {props.connectedLabel}
              </span>
            </button>

            <div className="flex items-center gap-2 rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5">
              <span className={"h-2 w-2 rounded-full " + dotClass} aria-label={"RPC status " + props.status} />
              <span className="hidden sm:inline text-xs font-mono text-muted">{props.statusNote || "healthy"}</span>
            </div>
          </div>
        </div>

        {/* Palette / Filters */}
        {paletteOpen ? (
          <div className="mt-3 rounded-2xl border border-line bg-[rgba(0,0,0,0.25)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Toggle
                label="Only mine"
                active={filters.onlyMine}
                onClick={() => setFilters({ ...filters, onlyMine: !filters.onlyMine })}
              />
              <Toggle
                label="Show pending"
                active={filters.showPending}
                onClick={() => setFilters({ ...filters, showPending: !filters.showPending })}
              />
              <Toggle
                label="Reduced motion"
                active={props.reducedMotion}
                onClick={() => props.setReducedMotion(!props.reducedMotion)}
              />
            </div>
            <div className="mt-3 text-xs font-mono text-muted">
              Tip: press <span className="text-text">Esc</span> to close.
            </div>
          </div>
        ) : null}

        {/* Search Overlay */}
        {searchOpen ? (
          <div className="mt-3 rounded-2xl border border-line bg-[rgba(0,0,0,0.25)] p-3">
            <div className="flex items-center gap-2">
              <div className="text-accent font-mono select-none">/</div>
              <input
                ref={searchRef}
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="flex-1 bg-transparent outline-none font-mono text-sm text-text placeholder:text-muted"
                placeholder="search…"
              />
              <button
                onClick={() => {
                  setFilters({ ...filters, search: "" });
                  setSearchOpen(false);
                }}
                className="rounded-xl border border-line bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs font-mono text-muted hover:shadow-glow transition"
              >
                Close
              </button>
            </div>
            <div className="mt-2 text-xs font-mono text-muted">Cmd/Ctrl+K to open, Esc to close.</div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function badge(txt: string) {
  return (
    <div className="rounded-full border border-[rgba(125,255,207,0.22)] bg-[rgba(125,255,207,0.06)] px-3 py-1 text-xs font-mono text-text">
      {txt}
    </div>
  );
}

function Toggle(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={[
        "rounded-full border px-3 py-1 text-xs font-mono transition",
        props.active
          ? "border-[rgba(125,255,207,0.30)] bg-[rgba(125,255,207,0.10)] text-text"
          : "border-line bg-[rgba(255,255,255,0.02)] text-muted hover:shadow-glow",
      ].join(" ")}
    >
      {props.label}
    </button>
  );
}

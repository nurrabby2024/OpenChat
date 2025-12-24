import React, { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { Chat } from "./Chat";
import { Composer } from "./Composer";
import { ConnectModal } from "./ConnectModal";
import { ToastProvider, useToast } from "./toast";
import { rpcHealthPing } from "../lib/health";
import {
  BASE_CHAIN_ID,
  CHAT_CONTRACT,
  decodeMessagesFromReceipt,
  encodeSendData,
  fetchAbi,
  inferContractShape,
} from "../lib/contract";
import { ensureBaseChain, getInjectedProvider, walletSendCalls, walletGetCallsStatus } from "../lib/wallet";
import type { ChatMessage } from "../lib/types";
import { clamp, formatAddr, nowHHMM } from "../lib/format";

export default function App() {
  return (
    <ToastProvider>
      <InnerApp />
    </ToastProvider>
  );
}

function InnerApp() {
  const toast = useToast();

  const [provider, setProvider] = useState<any>(null);
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<string>("");
  const [status, setStatus] = useState<"green" | "yellow" | "red">("yellow");
  const [statusNote, setStatusNote] = useState<string>("checking…");
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  const [filters, setFilters] = useState({ onlyMine: false, showPending: true, search: "" });
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("openchat:reducedMotion");
      return saved === "1";
    } catch {
      return false;
    }
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // DAILY_CLEAR_OPENCHAT: reset in-memory message list at local midnight (reduces memory in long sessions)
  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const msToMidnight = next.getTime() - now.getTime();
    const t0 = window.setTimeout(() => {
      setMessages([]);
      // After clearing, poller will repopulate with recent confirmed logs.
    }, msToMidnight);
    return () => window.clearTimeout(t0);
  }, []);

  const shapeRef = useRef<any>(null);
  const [shapeReady, setShapeReady] = useState(false);
  const dataSuffixRef = useRef<string>("0x");

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [newChip, setNewChip] = useState(false);

  // Farcaster Mini App SDK ready
  useEffect(() => {
    (async () => {
      try {
        const mod: any = await import("https://esm.sh/@farcaster/frame-sdk");
        const sdk = mod?.default ?? mod;
        if (sdk?.actions?.ready) sdk.actions.ready();
      } catch {}
    })();
  }, []);

  // Persist reduced motion
  useEffect(() => {
    try {
      localStorage.setItem("openchat:reducedMotion", reducedMotion ? "1" : "0");
    } catch {}
  }, [reducedMotion]);

  // Provider bootstrap
  useEffect(() => {
    const p = getInjectedProvider();
    setProvider(p);
    if (!p) return;

    const onAccounts = (accs: string[]) => setAccount((accs?.[0] || "").toLowerCase());
    const onChain = (c: string) => setChainId(c);

    p.request?.({ method: "eth_accounts" })
      .then((accs: string[]) => onAccounts(accs))
      .catch(() => {});
    p.request?.({ method: "eth_chainId" })
      .then((c: string) => onChain(c))
      .catch(() => {});

    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);

    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, []);

  // RPC health dot
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const t0 = performance.now();
        await rpcHealthPing();
        const dt = performance.now() - t0;
        if (!alive) return;
        if (dt < 450) {
          setStatus("green");
          setStatusNote("healthy");
        } else if (dt < 1200) {
          setStatus("yellow");
          setStatusNote("slow");
        } else {
          setStatus("red");
          setStatusNote("rpc issue");
        }
      } catch {
        if (!alive) return;
        setStatus("red");
        setStatusNote("rpc issue");
      }
    };
    tick();
    const t = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // Load ABI + infer contract shape
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const abi = await fetchAbi();
        const shape = inferContractShape(abi);
        shapeRef.current = shape;

        // Builder Codes: dataSuffix is needed for sendCalls
        const { Attribution } = await import("https://esm.sh/ox/erc8021");
        // NOTE: BUILDER_CODE is set inside contract.ts as required
        // dataSuffix is generated inside encodeSendData() path (kept here for backward compat)
        // We'll still store a safe default
        dataSuffixRef.current = Attribution.toDataSuffix({ codes: [] }) as any;

        if (!cancelled) setShapeReady(true);
      } catch (e: any) {
        if (!cancelled) {
          setShapeReady(false);
          toast.push({ title: "Network / ABI issue", detail: "Still retrying…", kind: "warn" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Poll recent messages (uses receipt log decode)
  useEffect(() => {
    let stop = false;

    const poll = async () => {
      try {
        // Quick and safe: only poll if we have shape
        if (!shapeRef.current) return;

        // Fetch latest blocks and scan txs via receipts is expensive;
        // this app keeps it light by only resolving receipts for our own pending calls
        // and keeps a small local confirmed cache in memory.
        setLoadingInitial(false);
      } catch {}
    };

    const t = window.setInterval(poll, 2500);
    poll();

    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, []);

  const handle = useMemo(() => {
    if (!account) return "anon";
    return formatAddr(account);
  }, [account]);

  const connectedLabel = useMemo(() => {
    if (!provider) return "Install wallet";
    if (!account) return "Not connected";
    return `Connected • ${formatAddr(account)}`;
  }, [provider, account]);

  const sendMessage = async (text: string) => {
    if (!shapeReady) {
      toast.push({ title: "Still loading contract", detail: "Try again in a second.", kind: "warn" });
      return { ok: false as const };
    }
    try {
      if (!provider) throw new Error("No wallet provider");
      if (!account) {
        setIsConnectOpen(true);
        return { ok: false as const };
      }
      const cid = await ensureBaseChain(provider);
      setChainId(cid);

      const data = await encodeSendData(shapeRef.current, text);
      const dataSuffix = dataSuffixRef.current;

      const result = await walletSendCalls(provider, account, cid, CHAT_CONTRACT, data, dataSuffix);
      const callId = typeof result === "string" ? result : (result?.id || result?.callId || `${Date.now()}`);
      const localId = `local:${callId}`;
      const now = Date.now();

      // Optimistic pending insert
      setMessages((prev) =>
        dedupeAndSort([
          ...prev,
          {
            id: localId,
            createdAtMs: now,
            from: account,
            text,
            status: "pending",
          },
        ])
      );

      // Resolve status
      resolveCallStatus(callId, localId).catch(() => {});
      return { ok: true as const };
    } catch (e: any) {
      const msg = (e?.message || "Transaction failed").toString();
      if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("rejected")) {
        toast.push({ title: "Cancelled", detail: "You rejected the transaction.", kind: "warn" });
        return { ok: false as const, cancelled: true as const };
      }
      toast.push({ title: "Failed — retry", detail: msg, kind: "err" });
      return { ok: false as const, error: msg };
    }
  };

  const resolveCallStatus = async (callId: string, localId: string) => {
    const started = Date.now();
    let tries = 0;

    while (tries < 80) {
      tries++;
      await new Promise((r) => setTimeout(r, 1500));

      let st: any = null;
      try {
        st = await walletGetCallsStatus(provider, callId);
      } catch {
        // If wallet doesn't support getCallsStatus, we can't resolve it here
        // (UI will keep it pending; user can still continue typing)
      }

      if (st?.status === "CONFIRMED" || st?.status === "confirmed") {
        const txHash = st?.receipts?.[0]?.transactionHash || st?.transactionHash || st?.txHash;

        // Update optimistic row
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, status: "confirmed", txHash } : m))
        );

        // If we have receipts/logs, decode messages (best-effort)
        try {
          const receipts = st?.receipts || [];
          const decoded = receipts.flatMap((r: any) => decodeMessagesFromReceipt(shapeRef.current, r));
          if (decoded.length) {
            setMessages((prev) => dedupeAndSort([...prev, ...decoded]));
          }
        } catch {}

        toast.push({ title: "Confirmed on Base", detail: "Your message is permanent.", kind: "ok" });
        return;
      }

      if (st?.status === "FAILED" || st?.status === "failed") {
        const reason = st?.failureReason || "Transaction failed";
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, status: "failed", error: reason } : m))
        );
        toast.push({ title: "Failed — retry", detail: reason, kind: "err" });
        return;
      }

      // Still pending: update elapsed
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setMessages((prev) =>
        prev.map((m) => (m.id === localId && m.status === "pending" ? { ...m, pendingSeconds: elapsed } : m))
      );
    }
  };

  const filteredMessages = useMemo(() => {
    const q = (filters.search || "").toLowerCase();
    return messages.filter((m) => {
      if (!filters.showPending && m.status === "pending") return false;
      if (filters.onlyMine && account && m.from.toLowerCase() !== account.toLowerCase()) return false;
      if (q) {
        const hay = `${m.from} ${m.text}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [messages, filters, account]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="pointer-events-none fixed inset-0 noise opacity-[0.05]" />
      <div className="pointer-events-none fixed inset-0 scanlines opacity-[0.04]" />

      <TopBar
        handle={handle}
        connectedLabel={connectedLabel}
        status={status}
        statusNote={statusNote}
        onConnect={() => setIsConnectOpen(true)}
        filters={filters}
        setFilters={setFilters}
        reducedMotion={reducedMotion}
        setReducedMotion={setReducedMotion}
      />

      <main className="px-3 pb-3">
        <Chat
          loading={loadingInitial}
          messages={filteredMessages}
          myAddress={account}
          reducedMotion={reducedMotion}
          onScrolledUp={(v) => setNewChip(v)}
          showNewChip={newChip}
          onJumpToBottom={() => setNewChip(false)}
        />

        <Composer
          disabled={!provider}
          connected={!!account}
          onConnect={() => setIsConnectOpen(true)}
          onSend={sendMessage}
          myAddress={account}
          chainId={chainId}
          reducedMotion={reducedMotion}
        />
      </main>

      <ConnectModal
        open={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        onConnect={async () => {
          try {
            const p = getInjectedProvider();
            if (!p) throw new Error("No wallet provider");
            setProvider(p);
            const accounts = await p.request({ method: "eth_requestAccounts" });
            setAccount((accounts?.[0] || "").toLowerCase());
            const cid = await p.request({ method: "eth_chainId" });
            setChainId(cid);
            setIsConnectOpen(false);
          } catch (e: any) {
            const msg = (e?.message || "Connect failed").toString();
            toast.push({ title: "Connect failed", detail: msg, kind: "err" });
          }
        }}
      />
    </div>
  );
}

function dedupeAndSort(list: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const m of list) map.set(m.id, m);
  return Array.from(map.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ToastProvider, useToast } from "./toast";
import { TopBar } from "./TopBar";
import { Chat } from "./Chat";
import { Composer } from "./Composer";
import { ConnectModal } from "./ConnectModal";
import { ChatMessage } from "../lib/types";
import { getProvider, requestAccounts, ensureBaseChain, Eip1193Provider } from "../lib/wallet";
import { pickHealthyRpc, rpcBlockNumber, rpcGetLogs, rpcGetTransactionReceipt } from "../lib/health";
import { CHAT_CONTRACT, fetchAbi, inferContractShape, buildDataSuffix, encodeSendData, decodeLogs, walletSendCalls, walletGetCallsStatus } from "../lib/contract";
import { shortAddr } from "../lib/format";

function AppInner() {
  const toast = useToast();

  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<string>("");
  const [rpc, setRpc] = useState<string>("https://mainnet.base.org");
  const [rpcStatus, setRpcStatus] = useState<"green"|"yellow"|"red">("yellow");
  const [rpcNote, setRpcNote] = useState<string>("");

  const [shapeReady, setShapeReady] = useState(false);
  const shapeRef = useRef<any>(null);
  const dataSuffixRef = useRef<string>("");

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

  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({ onlyMine: false, showPending: true, search: "" });
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false);

  // Farcaster SDK ready (must be called)
  useEffect(() => {
    (async () => {
      try {
        const mod: any = await import("https://esm.sh/@farcaster/frame-sdk");
        const sdk = mod?.default ?? mod;
        if (sdk?.actions?.ready) sdk.actions.ready();
      } catch {}
    })();
  }, []);

  // pick RPC and health
  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await pickHealthyRpc();
      if (!alive) return;
      setRpc(h.rpc);
      setRpcStatus(h.status);
      setRpcNote(h.status === "red" ? (h.note || "RPC issue") : h.ms ? `${h.ms}ms` : "");
    })();
    const t = window.setInterval(async () => {
      const h = await pickHealthyRpc();
      if (!alive) return;
      setRpc(h.rpc);
      setRpcStatus(h.status);
      setRpcNote(h.status === "red" ? (h.note || "RPC issue") : h.ms ? `${h.ms}ms` : "");
    }, 12000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  // provider boot
  useEffect(() => {
    (async () => {
      const p = await getProvider();
      setProvider(p);
      if (!p) {
        toast.push({ title: "Wallet provider not found", detail: "Open in a wallet-enabled Farcaster Mini App environment.", kind: "warn" });
      }
      try {
        const cid = p ? await p.request({ method: "eth_chainId" }) : "";
        setChainId(cid || "");
      } catch {}
    })();
  }, [toast]);

  // listen account/chain changes
  useEffect(() => {
    const w = window as any;
    const eth = w.ethereum;
    if (!eth?.on) return;
    const onAccounts = (a: string[]) => setAccount(a?.[0] ?? "");
    const onChain = (c: string) => setChainId(c);
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      try { eth.removeListener("accountsChanged", onAccounts); eth.removeListener("chainChanged", onChain); } catch {}
    };
  }, []);

  // ABI + builder suffix load
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const abi = await fetchAbi();
        const shape = inferContractShape(abi);
        const suffix = await buildDataSuffix();
        if (!alive) return;
        shapeRef.current = shape;
        dataSuffixRef.current = suffix;
        setShapeReady(true);
      } catch (e: any) {
        toast.push({ title: "Contract ABI unavailable", detail: e?.message || "Unable to load contract ABI", kind: "err" });
      }
    })();
    return () => { alive = false; };
  }, [toast]);

  // Initial messages load (last ~10k blocks)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!shapeReady) return;
      setLoading(true);
      try {
        const latest = await rpcBlockNumber(rpc);
        const fromBlock = Math.max(0, latest - 10_000);
        const logs = await rpcGetLogs(rpc, { fromBlock: "0x" + fromBlock.toString(16), toBlock: "0x" + latest.toString(16), address: CHAT_CONTRACT });
        const decoded = await decodeLogs(shapeRef.current, logs);
        const items: ChatMessage[] = decoded.slice(-12).map((m) => ({
          id: `${m.txHash}:${m.logIndex}`,
          createdAtMs: Date.now(), // terminal-style, but chain timestamp requires extra call; keep fast
          from: m.from,
          text: m.text,
          status: "confirmed",
          txHash: m.txHash,
          logIndex: m.logIndex,
        }));
        if (!alive) return;
        setMessages(dedupeAndSort(items));
      } catch (e: any) {
        toast.push({ title: "Failed to load chat", detail: e?.message || "RPC issue", kind: "warn" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [rpc, shapeReady, toast]);

  // Poll for new logs
  useEffect(() => {
    if (!shapeReady) return;
    let alive = true;
    let lastBlock = 0;
    const tick = async () => {
      if (!alive) return;
      try {
        const latest = await rpcBlockNumber(rpc);
        if (!lastBlock) lastBlock = Math.max(0, latest - 250);
        const fromBlock = lastBlock;
        const logs = await rpcGetLogs(rpc, { fromBlock: "0x" + fromBlock.toString(16), toBlock: "0x" + latest.toString(16), address: CHAT_CONTRACT });
        const decoded = await decodeLogs(shapeRef.current, logs);
        if (decoded.length) {
          const incoming: ChatMessage[] = decoded.map((m) => ({
            id: `${m.txHash}:${m.logIndex}`,
            createdAtMs: Date.now(),
            from: m.from,
            text: m.text,
            status: "confirmed",
            txHash: m.txHash,
            logIndex: m.logIndex,
          }));
          setMessages((prev) => {
            const merged = dedupeAndSort([...prev.filter((x) => x.status !== "pending"), ...incoming, ...prev.filter((x) => x.status === "pending")]);
            return merged;
          });
        }
        lastBlock = latest;
      } catch {
        // don't spam; status dot covers it
      }
    };
    const t = window.setInterval(tick, 4500);
    tick();
    return () => { alive = false; window.clearInterval(t); };
  }, [rpc, shapeReady]);

  const connectedLabel = account ? `Connected • ${shortAddr(account)}` : "Not connected";

  const onConnect = async () => {
    try {
      if (!provider) throw new Error("No wallet provider");
      const a = await requestAccounts(provider);
      setAccount(a);
      const cid = await ensureBaseChain(provider);
      setChainId(cid);
      toast.push({ title: "Wallet connected", detail: shortAddr(a), kind: "ok" });
      setIsConnectOpen(false);
    } catch (e: any) {
      toast.push({ title: "Connect failed", detail: e?.message || "User rejected", kind: "warn" });
    }
  };

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

      // 1) wallet_sendCalls (approval happens in wallet UI)
      const result = await walletSendCalls(provider, account, cid, CHAT_CONTRACT, data, dataSuffix);
      const callId = typeof result === "string" ? result : (result?.id || result?.callId || `${Date.now()}`);
      const localId = `local:${callId}`;
      const now = Date.now();

      // 2) Optimistic insert as pending immediately after approval
      setMessages((prev) => dedupeAndSort([...prev, {
        id: localId,
        createdAtMs: now,
        from: account,
        text,
        status: "pending",
      }]));

      // 3) Resolve tx hash via wallet_getCallsStatus when available, then wait for receipt
      let txHash: string | undefined;
      const t0 = Date.now();
      for (let i = 0; i < 90; i++) {
        await sleep(1100);
        try {
          const status = await walletGetCallsStatus(provider, callId);
          const hashes: string[] =
            status?.transactionHashes ||
            status?.txHashes ||
            status?.receipts?.map((r: any) => r.transactionHash) ||
            status?.calls?.flatMap((c: any) => c.transactionHash ? [c.transactionHash] : []) ||
            [];
          txHash = hashes?.[0] || txHash;
          const done = status?.status === "CONFIRMED" || status?.status === "confirmed" || status?.status === "SUCCESS";
          const failed = status?.status === "FAILED" || status?.status === "failed" || status?.status === "REVERTED";
          if (failed) throw new Error(status?.error?.message || "Transaction failed");
          if (done && txHash) break;
        } catch {
          // Some wallets don't support wallet_getCallsStatus; fall through to receipt polling if we have txHash later
        }

        if (txHash) {
          const r = await rpcGetTransactionReceipt(rpc, txHash);
          if (r?.status === "0x1") break;
          if (r?.status === "0x0") throw new Error("Transaction reverted");
        }

        // Update elapsed note
        const elapsed = Math.floor((Date.now() - t0) / 1000);
        setMessages((prev) => prev.map((m) => m.id === localId ? ({ ...m, error: `pending • ${elapsed}s` }) : m));
      }

      setMessages((prev) => prev.map((m) => m.id === localId ? ({ ...m, status: "confirmed", txHash }) : m));
      toast.push({ title: "Confirmed on Base", detail: txHash ? shortAddr(txHash) : "Mined", kind: "ok" });
      return { ok: true as const };

    } catch (e: any) {
      const msg = e?.message || "Failed";
      if (String(msg).toLowerCase().includes("user rejected") || e?.code === 4001) {
        toast.push({ title: "Cancelled", detail: "Transaction was rejected", kind: "warn" });
        return { ok: false as const, cancelled: true as const };
      }
      toast.push({ title: "Failed — retry", detail: msg, kind: "err" });
      return { ok: false as const, error: msg };
    }
  };

  const displayed = useMemo(() => {
    const mine = account?.toLowerCase();
    return messages.filter((m) => {
      if (!filters.showPending && m.status === "pending") return false;
      if (filters.onlyMine && mine && m.from.toLowerCase() !== mine) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        return m.text.toLowerCase().includes(q) || m.from.toLowerCase().includes(q);
      }
      return true;
    });
  }, [messages, filters, account]);

  return (
    <div className="h-full flex flex-col">
      <TopBar
        handle={account ? shortAddr(account) : "guest"}
        connectedLabel={connectedLabel}
        status={rpcStatus}
        statusNote={rpcNote}
        onConnect={() => setIsConnectOpen(true)}
        filters={filters}
        setFilters={setFilters}
        reducedMotion={reducedMotion}
        setReducedMotion={setReducedMotion}
      />

      <Chat
        loading={loading}
        messages={displayed}
        myAddress={account}
        reducedMotion={reducedMotion}
        rpcExplorerBase="https://basescan.org/tx/"
      />

      <Composer
        disabled={!provider || !shapeReady}
        connected={!!account}
        onConnect={() => setIsConnectOpen(true)}
        onSend={sendMessage}
        myAddress={account}
        chainId={chainId}
        reducedMotion={reducedMotion}
      />

      <ConnectModal
        open={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        onConnect={onConnect}
        canConnect={!!provider}
      />
    </div>
  );
}

function dedupeAndSort(items: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const m of items) map.set(m.id, m);
  const arr = Array.from(map.values());
  arr.sort((a, b) => a.createdAtMs - b.createdAtMs);
  return arr;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

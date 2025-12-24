import React, { useEffect, useMemo, useRef, useState } from "react";
import { ToastProvider, useToast } from "./toast";
import { TopBar } from "./TopBar";
import { Chat } from "./Chat";
import { Composer } from "./Composer";
import { ConnectModal } from "./ConnectModal";
import { ChatMessage } from "../lib/types";
import { getProvider, requestAccounts, ensureBaseChain, Eip1193Provider } from "../lib/wallet";
import { pickHealthyRpc, rpcGetTransactionReceipt, rpcGetBalance } from "../lib/health";
import { CHAT_CONTRACT, fetchContractShape, buildDataSuffix, encodeSendData, walletSendCallsBestEffort, walletGetCallsStatus, appendDataSuffix } from "../lib/contract";
import { shortAddr } from "../lib/format";

function AppInner() {
  const toast = useToast();

  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<string>("");
  const [rpc, setRpc] = useState<string>("https://mainnet.base.org");
  const [rpcStatus, setRpcStatus] = useState<"green" | "yellow" | "red">("yellow");
  const [rpcNote, setRpcNote] = useState<string>("");

  const [shapeReady, setShapeReady] = useState(false);
  const [contractError, setContractError] = useState<string>("");
  const shapeRef = useRef<any>(null);
  const dataSuffixRef = useRef<string>("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({ onlyMine: false, showPending: true, search: "" });
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false);

  // DAILY_CLEAR_OPENCHAT: reset in-memory message list at local midnight (reduces memory in long sessions)
  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const msToMidnight = next.getTime() - now.getTime();
    const t0 = window.setTimeout(() => {
      setMessages([]);
    }, msToMidnight);
    return () => window.clearTimeout(t0);
  }, []);

  // Farcaster SDK ready (must be called)
  useEffect(() => {
    (async () => {
      try {
        const mod: any = await import("https://esm.sh/@farcaster/miniapp-sdk");
        const sdk = mod?.default ?? mod;
        if (sdk?.actions?.ready) sdk.actions.ready();
        return;
      } catch {}
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
    if (!provider?.on) return;
    const onAccounts = (a: string[]) => setAccount(a?.[0] ?? "");
    const onChain = (c: string) => setChainId(c);
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      try { provider.removeListener?.("accountsChanged", onAccounts); } catch {}
      try { provider.removeListener?.("chainChanged", onChain); } catch {}
    };
  }, [provider]);

  // ✅ Contract shape + builder suffix load (ONLY when account exists)
  useEffect(() => {
    let alive = true;

    const run = async (attempt = 0) => {
      try {
        if (!account) {
          // reset when user disconnects
          if (!alive) return;
          setShapeReady(false);
          setContractError("");
          shapeRef.current = null;
          return;
        }

        setContractError("");
        setShapeReady(false);

        const shape = await fetchContractShape(account);
        const suffix = await buildDataSuffix();

        if (!alive) return;
        shapeRef.current = shape;
        dataSuffixRef.current = suffix;
        setShapeReady(true);
      } catch (e: any) {
        if (!alive) return;
        setShapeReady(false);
        setContractError(e?.message || "CONTRACT_UNAVAILABLE");
        if (attempt < 3) {
          setTimeout(() => run(attempt + 1), 900 + attempt * 600);
          return;
        }
      }
    };

    run(0);
    return () => { alive = false; };
  }, [account]);

  // Initial messages load (via /api/messages)
  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/messages?limit=15`, { headers: { accept: "application/json" }, cache: "no-store" });
        const j: any = await r.json().catch(() => null);
        const items = Array.isArray(j?.items) ? j.items : [];

        const confirmed: ChatMessage[] = items.map((m: any) => ({
          id: m.txHash,
          createdAtMs: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          from: m.from,
          text: m.text,
          status: "confirmed",
          txHash: m.txHash,
        }));

        if (!alive) return;

        setMessages((prev) => {
          const locals = prev.filter((x) => x.status !== "confirmed");
          return dedupeAndSort([...confirmed, ...locals]);
        });
      } catch (e: any) {
        toast.push({ title: "Failed to load chat", detail: e?.message || "Explorer issue", kind: "warn" });
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [toast]);

  const connectedLabel = account ? `Connected • ${shortAddr(account)}` : "Not connected";

  const onConnect = async () => {
    try {
      if (!provider) throw new Error("No wallet provider");
      const a = await requestAccounts(provider);
      setAccount(a);
      const cid = await ensureBaseChain(provider);
      setChainId(cid);

      // Preflight: verify the connected address actually has Base ETH on-chain.
      // Many wallets show a generic "no funds" error when they can't estimate/build a transaction.
      // This check helps catch the most common real cause: the connected address has 0 ETH on Base.
      try {
        const balHex = await rpcGetBalance(rpc, account);
        const balWei = BigInt(balHex);
        const minWei = 20_000_000_000_000n; // 0.00002 ETH (very conservative)
        if (balWei < minWei) {
          toast.push({
            title: "No Base ETH on this address",
            detail: `Your connected address has ~${Number(balWei) / 1e18} ETH on Base. Fund this exact address on Base mainnet, then retry.`,
            kind: "warn",
          });
          return { ok: false as const };
        }
      } catch {
        // If RPC is flaky, don't block sending.
      }
      toast.push({ title: "Wallet connected", detail: shortAddr(a), kind: "ok" });
      setIsConnectOpen(false);
    } catch (e: any) {
      toast.push({ title: "Connect failed", detail: e?.message || "User rejected", kind: "warn" });
    }
  };

  const sendMessage = async (text: string) => {
    try {
      if (!provider) throw new Error("No wallet provider");

      // ✅ First: require wallet
      if (!account) {
        setIsConnectOpen(true);
        return { ok: false as const };
      }

      // ✅ Then: require contract shape
      if (!shapeReady) {
        toast.push({
          title: contractError ? "Contract unavailable" : "Still loading contract",
          detail: contractError ? contractError : "Try again in a second.",
          kind: "warn",
        });
        return { ok: false as const };
      }

      const cid = await ensureBaseChain(provider);
      setChainId(cid);

      // Preflight: confirm the connected address has Base mainnet ETH.
      // If the balance is 0, most wallets show a generic "no funds" error.
      try {
        const balHex = await rpcGetBalance(rpc, account);
        const balWei = BigInt(balHex);
        const minWei = 20_000_000_000_000n; // 0.00002 ETH
        if (balWei < minWei) {
          toast.push({
            title: "No Base ETH in this address",
            detail: "Your connected address appears to have ~0 ETH on Base mainnet. Make sure your funds are on this same address (0x...) on Base, not another chain/account.",
            kind: "warn",
          });
          return { ok: false as const };
        }
      } catch {
        // If RPC is temporarily unreachable, don't block sending.
      }

      const data = await encodeSendData(shapeRef.current, text);
      const dataSuffix = dataSuffixRef.current;

      // Preferred path: ERC-5792 (wallet_sendCalls). Some wallets surface confusing "no gas" errors
      // when they fail to build/estimate the call bundle. If that happens, fall back to a plain
      // eth_sendTransaction with the attribution suffix appended to calldata.
      let usedFallbackTx = false;
      let callId = "";
      let txHash: string | undefined;

      try {
        const result = await walletSendCallsBestEffort(provider, account, cid, CHAT_CONTRACT, data, dataSuffix);
        callId = typeof result === "string" ? result : (result?.id || result?.callId || `${Date.now()}`);
      } catch (e: any) {
        const msg = String(e?.message || "");
        const code = e?.code;
        const isMethodMissing =
          code === -32601 ||
          /method not found/i.test(msg) ||
          /wallet_sendCalls/i.test(msg);

        const looksLikeBuildOrFunds =
          code === -32000 ||
          /insufficient funds/i.test(msg) ||
          /error generating transaction/i.test(msg) ||
          /funds/i.test(msg) ||
          /gas/i.test(msg);

        if (!(isMethodMissing || looksLikeBuildOrFunds)) throw e;

        // Fallback: plain transaction (works on more wallets) while keeping Builder Code attribution.
        const dataWithSuffix = appendDataSuffix(data, dataSuffix);
        txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, to: CHAT_CONTRACT, value: "0x0", data: dataWithSuffix }],
        });
        usedFallbackTx = true;
        callId = txHash || `${Date.now()}`;
      }

      const localId = `local:${callId}`;
      const now = Date.now();

      setMessages((prev) => dedupeAndSort([...prev, {
        id: localId,
        createdAtMs: now,
        from: account,
        text,
        status: "pending",
      }]));

      const t0 = Date.now();

      for (let i = 0; i < 90; i++) {
        await sleep(1100);

        // If we used wallet_sendCalls, attempt to fetch the eventual tx hash via wallet_getCallsStatus.
        if (!usedFallbackTx) {
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
            // Some wallets don't support wallet_getCallsStatus
          }
        }

        // Always try receipt polling once we have a tx hash (or if we used the fallback).
        if (txHash) {
          const r = await rpcGetTransactionReceipt(rpc, txHash);
          if (r?.status === "0x1") break;
          if (r?.status === "0x0") throw new Error("Transaction reverted");
        }

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
      toast.push({
        title: "Failed — retry",
        detail:
          (String(msg).includes("wallet_sendCalls") ||
            String(msg).toLowerCase().includes("method not found") ||
            String(msg).includes("-32601"))
            ? "Your current wallet doesn't support wallet_sendCalls. Open this in the Base App / a Farcaster Mini App wallet environment to publish onchain."
            : msg,
        kind: "err",
      });
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
        rpcExplorerBase="/api/tx?hash="
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

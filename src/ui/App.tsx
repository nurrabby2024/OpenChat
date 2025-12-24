import { useEffect, useMemo, useState } from "react";
import { encodeAbiParameters } from "viem";
import { buildCalldata, sendCallsWithFallback, sendTransactionFallback } from "../lib/contract";
import { hasBaseEth } from "../lib/health";

type Shape = { selector: `0x${string}` };

async function fetchShape(): Promise<Shape> {
  const r = await fetch("/api/shape");
  if (!r.ok) throw new Error("shape fetch failed");
  return r.json();
}

async function fetchTx(): Promise<{ to: `0x${string}`; dataSuffix?: `0x${string}`; value?: `0x${string}` }> {
  const r = await fetch("/api/tx");
  if (!r.ok) throw new Error("tx fetch failed");
  return r.json();
}

export default function App() {
  const [ethereum, setEthereum] = useState<any>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const eth = (window as any)?.ethereum;
    setEthereum(eth || null);
  }, []);

  useEffect(() => {
    let t: any;
    if (toast) {
      t = setTimeout(() => setToast(null), 3500);
    }
    return () => clearTimeout(t);
  }, [toast]);

  async function connect() {
    try {
      if (!ethereum) {
        setToast("No wallet found");
        return;
      }
      const accs = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const a = (accs?.[0] || null) as any;
      setAccount(a);
    } catch (e: any) {
      setToast(e?.message || "Connect failed");
    }
  }

  async function send() {
    if (!ethereum) return setToast("No wallet found");
    if (!account) return setToast("Connect wallet first");
    if (!msg.trim()) return setToast("Write a message");

    setLoading(true);
    try {
      // Preflight check - avoids the "I have $5 but still says no gas" confusion
      const okBal = await hasBaseEth(account);
      if (!okBal) {
        setToast("No Base ETH in this connected address");
        setLoading(false);
        return;
      }

      const shape = await fetchShape();
      const txMeta = await fetchTx();

      // abi-encode single string arg
      const encodedArgs = encodeAbiParameters([{ type: "string" }], [msg]) as `0x${string}`;
      const data = buildCalldata(shape.selector, encodedArgs);

      // Primary path: wallet_sendCalls with 2-mode fallback
      const res1 = await sendCallsWithFallback(ethereum, {
        from: account,
        to: txMeta.to,
        data,
        value: txMeta.value,
        dataSuffix: txMeta.dataSuffix,
      });

      if (res1.ok) {
        setToast(`Sent (${res1.mode})`);
        setMsg("");
        setLoading(false);
        return;
      }

      // Final fallback: eth_sendTransaction
      const res2 = await sendTransactionFallback(ethereum, {
        from: account,
        to: txMeta.to,
        data,
        value: txMeta.value,
        dataSuffix: txMeta.dataSuffix,
      });

      if (res2.ok) {
        setToast(`Sent (${res2.mode})`);
        setMsg("");
        setLoading(false);
        return;
      }

      // If everything failed, show wallet error message
      const errMsg =
        res2.error?.message ||
        res1.error?.message ||
        "Error generating transaction";
      setToast(errMsg);
    } catch (e: any) {
      setToast(e?.message || "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div>OpenChat</div>
        <button onClick={connect} disabled={!!account}>
          {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect"}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Write message…"
          style={{ width: "100%", padding: 12, borderRadius: 10 }}
        />
        <button
          onClick={send}
          disabled={loading}
          style={{ marginTop: 10, width: "100%", padding: 12, borderRadius: 10 }}
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 18,
            background: "#111",
            color: "#fff",
            padding: 12,
            borderRadius: 10,
            opacity: 0.95,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

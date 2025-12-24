import { getPublicClient } from "./rpc.js";
import { abi } from "./abi.js";

/**
 * This tries to infer the "chat/post message" function selector.
 *
 * Root issue we are hardening against:
 * - Picking "most common selector" from recent tx can drift to a non-message function
 * - Wrong selector => eth_estimateGas fails => wallet shows "not enough funds"
 *
 * Strategy:
 * - Prefer tx where decoded_input shows exactly one dynamic argument (string/bytes-like)
 * - Fall back to previous frequency heuristic if decoding not available
 */
export default async function handler(req, res) {
  try {
    const client = getPublicClient();

    // Contract address is provided by env in this project
    const address = process.env.CONTRACT_ADDRESS;
    if (!address) {
      return res.status(500).json({ error: "Missing CONTRACT_ADDRESS" });
    }

    // We use Blockscout API already in this project elsewhere; try to use decoded input if available.
    // NOTE: If Blockscout is down or returns unexpected data, we fall back gracefully.
    let selector = null;

    try {
      const base = process.env.BLOCKSCOUT_API;
      if (base) {
        const url = `${base}/api/v2/addresses/${address}/transactions?filter=to&limit=50`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();

          const items = Array.isArray(j?.items) ? j.items : [];
          // Filter to tx that have decoded_input with exactly one argument and it is dynamic-ish (string/bytes)
          const candidates = [];
          for (const it of items) {
            const input = it?.decoded_input;
            const method = input?.method;
            const params = Array.isArray(input?.parameters) ? input.parameters : [];

            // Only consider decoded tx
            if (!method || params.length !== 1) continue;

            const p0 = params[0];
            const type = (p0?.type || "").toLowerCase();
            // Accept common "message" arg types:
            // string, bytes, bytes32? (but bytes32 is static; still can work) - keep conservative.
            const okType =
              type.includes("string") ||
              type === "bytes" ||
              type.startsWith("bytes");

            if (!okType) continue;

            // original tx input hex
            const rawInput = (it?.raw_input || it?.input || "").toString();
            if (rawInput && rawInput.startsWith("0x") && rawInput.length >= 10) {
              candidates.push(rawInput.slice(0, 10));
            }
          }

          if (candidates.length) {
            // pick the most common among filtered candidates
            const freq = new Map();
            for (const s of candidates) freq.set(s, (freq.get(s) || 0) + 1);
            selector = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
          }
        }
      }
    } catch (_e) {
      // swallow blockscout errors and keep going
    }

    // Fallback: old heuristic — look at recent tx receipts and pick most common selector
    if (!selector) {
      // Read a few recent logs/transactions by scanning recent blocks and looking for calls to the contract.
      // This is intentionally lightweight.
      const latest = await client.getBlockNumber();
      const start = latest > 200n ? latest - 200n : 0n;

      const freq = new Map();
      for (let b = latest; b >= start; b--) {
        const block = await client.getBlock({
          blockNumber: b,
          includeTransactions: true,
        });

        const txs = block?.transactions || [];
        for (const tx of txs) {
          // only tx sent to contract
          if (!tx?.to) continue;
          if (tx.to.toLowerCase() !== address.toLowerCase()) continue;
          const input = (tx.input || "").toString();
          if (input && input.startsWith("0x") && input.length >= 10) {
            const s = input.slice(0, 10);
            freq.set(s, (freq.get(s) || 0) + 1);
          }
        }
      }

      if (freq.size) {
        selector = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }

    // Last fallback: take first function selector from ABI
    if (!selector) {
      // This is safer than returning null
      const funcs = abi.filter((x) => x.type === "function");
      if (funcs.length) {
        // we can’t easily compute selector without keccak here, so return method signature instead
        // but frontend expects selector hex, so better return an error
        return res.status(500).json({ error: "Could not infer selector" });
      }
      return res.status(500).json({ error: "ABI has no functions" });
    }

    return res.status(200).json({ selector });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "shape error" });
  }
}

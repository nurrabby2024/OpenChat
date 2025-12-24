const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BASE_RPC = "https://mainnet.base.org";

async function rpc(method, params = []) {
  const r = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("RPC_BAD_RESPONSE");
  if (j.error) throw new Error(j.error.message || "RPC_ERROR");
  return j.result;
}

function isHexData(x) {
  return typeof x === "string" && x.startsWith("0x") && x.length >= 10;
}

function detectDynamicArgTypeFromInput(input) {
  // Heuristic: for single dynamic arg, bytes/string look identical in calldata structure.
  // We'll default to "string".
  return "string";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(200).json({ status: "0", message: "FROM_REQUIRED", result: "" });
      return;
    }
    const body = req.body || {};
    const from = String(body?.from || "").toLowerCase();
    if (!from || !from.startsWith("0x") || from.length !== 42) {
      res.status(200).json({ status: "0", message: "FROM_REQUIRED", result: "" });
      return;
    }

    // Find recent txs to this contract by scanning logs, then pick one that succeeded.
    const latestHex = await rpc("eth_blockNumber", []);
    const latest = parseInt(latestHex, 16);

    let logs = [];
    let fromBlock = Math.max(0, latest - 30000);
    for (let tries = 0; tries < 8; tries++) {
      try {
        logs = await rpc("eth_getLogs", [
          { address: ADDRESS, fromBlock: "0x" + fromBlock.toString(16), toBlock: "0x" + latest.toString(16) },
        ]);
        if (Array.isArray(logs) && logs.length) break;
      } catch {}
      fromBlock = Math.max(0, fromBlock - 30000);
    }

    const txHashes = [];
    const seen = new Set();
    for (const l of logs || []) {
      const h = (l?.transactionHash || "").toLowerCase();
      if (h && !seen.has(h)) {
        seen.add(h);
        txHashes.push(h);
      }
      if (txHashes.length >= 60) break;
    }

    // Pick first successful tx that calls the contract directly
    for (const h of txHashes) {
      try {
        const tx = await rpc("eth_getTransactionByHash", [h]);
        if (!tx?.to || String(tx.to).toLowerCase() !== ADDRESS.toLowerCase()) continue;
        if (!isHexData(tx.input)) continue;

        const receipt = await rpc("eth_getTransactionReceipt", [h]);
        if (receipt?.status !== "0x1") continue;

        const selector = String(tx.input).slice(0, 10).toLowerCase();
        const argType = detectDynamicArgTypeFromInput(String(tx.input));

        res.setHeader("cache-control", "no-store");
        res.status(200).json({
          status: "1",
          message: "OK",
          result: {
            selector,
            argType,
            sampleTx: h,
          },
        });
        return;
      } catch {
        // keep searching
      }
    }

    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "NO_SUCCESSFUL_TX_FOUND", result: "" });
  } catch {
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: "" });
  }
}

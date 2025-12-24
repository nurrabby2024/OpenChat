// /api/shape
// Returns the most common 4-byte selector used in recent txs sent to the chat contract.
// Does NOT require verified ABI.

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

function extractSelectorsFromBytecode(codeHex) {
  const code = (codeHex || "").startsWith("0x") ? codeHex.slice(2) : (codeHex || "");
  const out = new Set();
  for (let i = 0; i + 10 <= code.length; i += 2) {
    if (code.slice(i, i + 2) === "63") {
      const sel = code.slice(i + 2, i + 10);
      if (/^[0-9a-fA-F]{8}$/.test(sel)) out.add("0x" + sel.toLowerCase());
    }
  }
  return Array.from(out);
}

async function selectorsFromRecentTxs() {
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);

  let fromBlock = Math.max(0, latest - 20000);
  let logs = [];

  for (let tries = 0; tries < 6; tries++) {
    try {
      logs = await rpc("eth_getLogs", [
        {
          address: ADDRESS,
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + latest.toString(16),
        },
      ]);
      if (Array.isArray(logs) && logs.length) break;
    } catch {}
    fromBlock = Math.max(0, fromBlock - 20000);
  }

  const txHashes = [];
  const seen = new Set();
  for (const l of logs || []) {
    const h = (l?.transactionHash || "").toLowerCase();
    if (h && !seen.has(h)) {
      seen.add(h);
      txHashes.push(h);
    }
    if (txHashes.length >= 40) break;
  }

  const counts = new Map();
  for (const h of txHashes) {
    try {
      const tx = await rpc("eth_getTransactionByHash", [h]);
      if (!tx?.to) continue;
      if (String(tx.to).toLowerCase() !== ADDRESS.toLowerCase()) continue;
      const input = String(tx.input || "");
      if (!input.startsWith("0x") || input.length < 10) continue;
      const sel = input.slice(0, 10).toLowerCase();
      counts.set(sel, (counts.get(sel) || 0) + 1);
    } catch {}
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([sel]) => sel);
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

    // 1) Prefer real selectors from recent txs
    let sels = await selectorsFromRecentTxs();
    let selector = sels?.[0];

    // 2) Fallback: extract from bytecode
    if (!selector) {
      const code = await rpc("eth_getCode", [ADDRESS, "latest"]);
      const b = extractSelectorsFromBytecode(code);
      selector = b?.[0];
    }

    if (!selector) {
      res.status(200).json({ status: "0", message: "NO_SELECTOR_FOUND", result: "" });
      return;
    }

    // Arg type: for dynamic arg encoding (string/bytes) encoding is same style.
    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      status: "1",
      message: "OK",
      result: {
        selector,
        argType: "string",
      },
    });
  } catch (e) {
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: "" });
  }
}

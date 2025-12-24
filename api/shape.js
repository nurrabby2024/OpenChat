// /api/shape
// Returns the best-guess 4-byte selector for the "post message" function on the chat contract.
//
// Important:
// Several mobile wallets show a generic "Error generating transaction / make sure you have enough funds"
// when gas estimation fails for *any* reason (including calling the wrong selector).
//
// Previous versions of this endpoint picked the most common selector among *all* recent transactions,
// which can drift if other functions are used heavily. That makes some wallets fail gas-estimation and
// display the misleading "no gas" error.
//
// New logic: prefer selectors from recent transactions that decode to a *single* dynamic argument
// (string/bytes) via Blockscout's decoded_input. This keeps the selector stable for the chat message call.

const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BASE_RPC = "https://mainnet.base.org";
const BLOCKSCOUT = "https://base.blockscout.com";

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

function pickDynamicArgType(decodedInput) {
  const params = decodedInput?.parameters;
  if (!Array.isArray(params) || params.length !== 1) return null;
  const t = params?.[0]?.type;
  if (t === "string") return "string";
  if (t === "bytes") return "bytes";
  return null;
}

async function selectorsFromRecentDecodedTxs() {
  // Pull the latest tx list from Blockscout (same endpoint used by /api/messages)
  // and only consider txs that decode to a single dynamic parameter.
  const url = `${BLOCKSCOUT}/api/v2/addresses/${ADDRESS}/transactions?filter=to`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => null);
  const items = Array.isArray(j?.items) ? j.items : [];

  const counts = new Map();
  const typeBySelector = new Map();

  // limit to a reasonable number to keep latency low
  for (const t of items.slice(0, 60)) {
    const argType = pickDynamicArgType(t?.decoded_input);
    if (!argType) continue;

    // Prefer raw input if Blockscout provides it, otherwise fetch via RPC
    const raw = t?.raw_input || t?.input || "";
    let input = (typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) ? raw : "";
    if (!input) {
      try {
        const tx = await rpc("eth_getTransactionByHash", [t?.hash]);
        input = String(tx?.input || "");
      } catch {}
    }
    if (!input.startsWith("0x") || input.length < 10) continue;

    const sel = input.slice(0, 10).toLowerCase();
    counts.set(sel, (counts.get(sel) || 0) + 1);
    // Track the last-seen argType for this selector (string/bytes)
    typeBySelector.set(sel, argType);
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked?.[0]?.[0] || "";
  return { selector: top, argType: typeBySelector.get(top) || "string" };
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

    // 1) Prefer selectors from decoded txs that match our encoder shape (1 dynamic arg)
    let selector = "";
    let argType = "string";
    try {
      const x = await selectorsFromRecentDecodedTxs();
      selector = x?.selector || "";
      argType = x?.argType || "string";
    } catch {}

    // 2) Fallback: most common selector across recent txs (legacy behavior)
    if (!selector) {
      let sels = await selectorsFromRecentTxs();
      selector = sels?.[0];
    }

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

    // Arg type: for dynamic arg encoding (string/bytes) encoding is the same style.
    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      status: "1",
      message: "OK",
      result: {
        selector,
        argType,
      },
    });
  } catch (e) {
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: "" });
  }
}

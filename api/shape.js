// /api/shape
// Uses Blockscout API to find recent successful tx TO the contract and extract method_id/method_call.
// No ABI needed.

const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BS_BASE = "https://base.blockscout.com/api/v2";

function okAddr(a) {
  return typeof a === "string" && a.toLowerCase().startsWith("0x") && a.length === 42;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(200).json({ status: "0", message: "FROM_REQUIRED", result: "" });
      return;
    }

    const body = req.body || {};
    const from = String(body?.from || "");
    if (!okAddr(from)) {
      res.status(200).json({ status: "0", message: "FROM_REQUIRED", result: "" });
      return;
    }

    // Fetch transactions for ADDRESS (filter=to means txs sent TO this address)
    // Docs: /api/v2/addresses/{address_hash}/transactions?filter=to :contentReference[oaicite:2]{index=2}
    const url = `${BS_BASE}/addresses/${ADDRESS}/transactions?filter=to`;
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    const j = await r.json().catch(() => null);

    const items = Array.isArray(j?.items) ? j.items : [];
    // Pick first "ok" tx with method_id + method_call
    const good = items.find((tx) => {
      const status = String(tx?.status || "").toLowerCase(); // "ok | error" :contentReference[oaicite:3]{index=3}
      const mid = String(tx?.method_id || "");               // e.g. "23b872dd" :contentReference[oaicite:4]{index=4}
      const mcall = String(tx?.method_call || tx?.method || "");
      const raw = String(tx?.raw_input || "");
      return status === "ok" && mid.length === 8 && mcall && raw.startsWith("0x") && raw.length >= 10;
    });

    if (!good) {
      res.setHeader("cache-control", "no-store");
      res.status(200).json({ status: "0", message: "NO_OK_TX_FOUND", result: "" });
      return;
    }

    const methodId = "0x" + String(good.method_id).toLowerCase(); // 4-byte selector
    const methodCall = String(good.method_call || "");
    const sampleTx = String(good.hash || "");

    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      status: "1",
      message: "OK",
      result: {
        methodId,
        methodCall,
        sampleTx,
      },
    });
  } catch (e) {
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: "" });
  }
}

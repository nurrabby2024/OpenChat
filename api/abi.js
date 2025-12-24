// Vercel Serverless ABI proxy (same-domain ABI fetch)
// Returns Etherscan-style: { status, message, result } where result is a JSON-stringified ABI

const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";

export default async function handler(req, res) {
  try {
    // Allow GET/POST (Base previews sometimes preflight)
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ status: "0", message: "METHOD_NOT_ALLOWED", result: "" });
      return;
    }

    const origin = ["https", "://", "base.blockscout.com"].join("");

    // Preferred: Blockscout V2 smart contract endpoint (no API key)
    // It returns { abi: "[ ... ]" } when verified.
    let abiStr = "";
    try {
      const v2 = `${origin}/api/v2/smart-contracts/${ADDRESS}`;
      const r = await fetch(v2, { headers: { accept: "application/json" } });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && typeof j.abi === "string" && j.abi.trim().startsWith("[")) {
          abiStr = j.abi;
        }
      }
    } catch {}

    // Fallback: legacy module=contract endpoint
    if (!abiStr) {
      const legacy = `${origin}/api?module=contract&action=getabi&address=${ADDRESS}`;
      const r = await fetch(legacy, { headers: { accept: "application/json" } });
      const j = await r.json().catch(() => null);
      if (j && typeof j.result === "string" && j.result.trim().startsWith("[")) {
        abiStr = j.result;
      }
    }

    if (!abiStr) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "0", message: "ABI_UNAVAILABLE", result: "" });
      return;
    }

    // Cache a day (ABI rarely changes)
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).json({ status: "1", message: "OK", result: abiStr });
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: "" });
  }
}

// /api/messages
// Fetches recent transactions sent TO the chat contract from Blockscout API v2,
// and extracts the message from decoded_input.parameters (no ABI required).

const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BLOCKSCOUT = "https://base.blockscout.com";

function hexToUtf8(hex) {
  try {
    if (typeof hex !== "string") return "";
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (!h) return "";
    const bytes = new Uint8Array(h.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function extractMessage(decodedInput) {
  const params = decodedInput?.parameters;
  if (!Array.isArray(params)) return "";

  // Prefer string param
  const s = params.find((p) => p?.type === "string" && typeof p?.value === "string");
  if (s) return s.value;

  // bytes param (often hex)
  const b = params.find((p) => p?.type === "bytes" && typeof p?.value === "string");
  if (b) {
    const v = b.value;
    if (v.startsWith("0x")) {
      const t = hexToUtf8(v);
      return t || v;
    }
    return v;
  }

  // fallback: any first param stringable
  const any = params[0]?.value;
  return typeof any === "string" ? any : "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
      return;
    }

    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit || "15", 10)));
    const pageParams = req.query.pageParams ? decodeURIComponent(String(req.query.pageParams)) : "";

    const baseUrl = `${BLOCKSCOUT}/api/v2/addresses/${ADDRESS}/transactions?filter=to`;
    const url = pageParams ? `${baseUrl}&${pageParams}` : baseUrl;

    const r = await fetch(url, { headers: { accept: "application/json" } });
    const j = await r.json().catch(() => null);

    const items = Array.isArray(j?.items) ? j.items.slice(0, limit) : [];

    const out = items.map((t) => {
      const from = t?.from?.hash || "";
      const txHash = t?.hash || "";
      const timestamp = t?.timestamp || "";
      const text = extractMessage(t?.decoded_input || {});
      return { from, txHash, timestamp, text };
    }).filter((x) => x.text);

    const next = j?.next_page_params ? encodeURIComponent(new URLSearchParams(j.next_page_params).toString()) : "";

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, items: out, nextPageParams: next });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, error: "ERROR" });
  }
}

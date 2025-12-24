// /api/shape
// Infers the chat contract's write function (name + input type) without needing verified ABI.
// Uses Blockscout API v2 interpreter data from recent transactions sent TO the contract.
//
// Returns: { status: "1", message: "OK", result: { abi: "[...]", sendFnName: "...", argType: "string|bytes" } }

const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BLOCKSCOUT = "https://base.blockscout.com";

function parseMethodCall(methodCall) {
  // Example: "postMessage(string message)" or "bitchat(string)"
  const m = (methodCall || "").match(/^([A-Za-z0-9_]+)\((.*)\)$/);
  if (!m) return null;
  const name = m[1];
  const inside = (m[2] || "").trim();
  const parts = inside ? inside.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const types = parts.map((p) => p.split(" ")[0].trim());
  return { name, types };
}

function pickMessageArg(types) {
  // Prefer string, then bytes. Return index and type.
  const iStr = types.findIndex((t) => t === "string");
  if (iStr !== -1) return { index: iStr, type: "string" };
  const iBytes = types.findIndex((t) => t === "bytes");
  if (iBytes !== -1) return { index: iBytes, type: "bytes" };
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ status: "0", message: "METHOD_NOT_ALLOWED", result: null });
      return;
    }

    const url = `${BLOCKSCOUT}/api/v2/addresses/${ADDRESS}/transactions?filter=to`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const j = await r.json().catch(() => null);

    const items = j?.items;
    if (!Array.isArray(items) || items.length === 0) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "0", message: "NO_TRANSACTIONS_FOUND", result: null });
      return;
    }

    // Find first tx with decoded_input.method_call
    const tx = items.find((t) => typeof t?.decoded_input?.method_call === "string" && t.decoded_input.method_call.includes("("));
    if (!tx) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "0", message: "NO_DECODED_METHOD_FOUND", result: null });
      return;
    }

    const methodCall = tx.decoded_input.method_call;
    const parsed = parseMethodCall(methodCall);
    if (!parsed) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "0", message: "METHOD_PARSE_FAILED", result: null });
      return;
    }

    const msgArg = pickMessageArg(parsed.types);
    if (!msgArg) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "0", message: "NO_STRING_OR_BYTES_INPUT", result: null });
      return;
    }

    // We only support 1-arg write function for Mini App send UX.
    // If multiple args exist, we still allow it ONLY if the message arg is the ONLY arg.
    if (parsed.types.length !== 1) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        status: "0",
        message: "UNSUPPORTED_SIGNATURE",
        result: { methodCall }
      });
      return;
    }

    const sendFnName = parsed.name;
    const argType = msgArg.type;

    const abi = [{
      type: "function",
      name: sendFnName,
      stateMutability: "nonpayable",
      inputs: [{ name: "message", type: argType }],
      outputs: []
    }];

    res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutes
    res.status(200).json({
      status: "1",
      message: "OK",
      result: { abi: JSON.stringify(abi), sendFnName, argType, methodCall }
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: null });
  }
}

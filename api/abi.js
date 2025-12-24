// Vercel Serverless ABI proxy (same-domain ABI fetch)
//
// This endpoint tries VERY hard to return a usable ABI so the Mini App can:
// - encode the "send message" call
// - decode message logs for the terminal chat
//
// Strategy:
// 1) Try Blockscout verified ABI
// 2) If not available, infer a minimal ABI by:
//    - extracting 4-byte selectors from bytecode
//    - mapping selectors and event topics via Sourcify's signature DB
//    - building ABI entries for the best "message send" function and "message" event
//
// Response shape matches Etherscan-style: { status, message, result }
// where result is a stringified JSON ABI (so the client can JSON.parse it).

const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BLOCKSCOUT_ORIGIN = "https://base.blockscout.com";
const BASE_RPC = "https://mainnet.base.org";
const SIGDB_LOOKUP = "https://api.4byte.sourcify.dev/signature-database/v1/lookup";

function toHex(n) {
  return "0x" + Number(n).toString(16);
}

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

function extractSelectors(codeHex) {
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

function parseTextSig(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
  if (!m) return null;
  const name = m[1];
  const inside = (m[2] || "").trim();
  const rawTypes = inside ? inside.split(",").map((s) => s.trim()).filter(Boolean) : [];
  // Keep only the type portion, dropping param names if present
  const types = rawTypes.map((t) => t.split(" ")[0].trim());
  return { name, types, text };
}

function isDynamicType(t) {
  return t === "string" || t === "bytes";
}

function typeWeight(t) {
  if (t === "address") return 100;
  if (t.startsWith("uint") || t.startsWith("int")) return 80;
  if (t === "bool") return 60;
  if (t.startsWith("bytes") && t !== "bytes") return 70; // bytes32 etc
  if (t === "string" || t === "bytes") return 10;
  return 20;
}

function scoreName(name) {
  const n = (name || "").toLowerCase();
  const hits = ["message", "chat", "post", "write", "send", "say", "speak", "publish", "bitchat", "shout", "cast"];
  let s = 0;
  for (const h of hits) if (n.includes(h)) s += 5;
  return s;
}

async function lookupSignatures({ functions = [], events = [] }) {
  const qs = [];
  if (functions.length) qs.push("function=" + encodeURIComponent(functions.join(",")));
  if (events.length) qs.push("event=" + encodeURIComponent(events.join(",")));
  qs.push("filter=true");
  const url = SIGDB_LOOKUP + "?" + qs.join("&");

  const r = await fetch(url, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new Error("SIGDB_LOOKUP_FAILED");
  return j.result || {};
}

async function getVerifiedAbiFromBlockscout() {
  // Preferred: Blockscout V2 smart contract endpoint (no API key)
  // Returns: { abi: "[...]" } when verified
  try {
    const v2 = `${BLOCKSCOUT_ORIGIN}/api/v2/smart-contracts/${ADDRESS}`;
    const r = await fetch(v2, { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j && typeof j.abi === "string" && j.abi.trim().startsWith("[")) {
        return j.abi;
      }
    }
  } catch {}

  // Fallback: legacy module=contract endpoint
  try {
    const legacy = `${BLOCKSCOUT_ORIGIN}/api?module=contract&action=getabi&address=${ADDRESS}`;
    const r = await fetch(legacy, { headers: { accept: "application/json" } });
    const j = await r.json().catch(() => null);
    if (j && typeof j.result === "string" && j.result.trim().startsWith("[")) {
      return j.result;
    }
  } catch {}

  return "";
}

function makeFnAbi(fnSig) {
  return {
    type: "function",
    name: fnSig.name,
    stateMutability: "nonpayable",
    inputs: fnSig.types.map((t, i) => ({ name: i === 0 ? "message" : `arg${i}`, type: t })),
    outputs: [],
  };
}

function makeEventInputs(types, indexedCount) {
  // Start with sensible names
  const names = types.map((_, i) => `arg${i}`);
  const firstAddress = types.findIndex((t) => t === "address");
  if (firstAddress !== -1) names[firstAddress] = "from";
  const firstString = types.findIndex((t) => t === "string");
  if (firstString !== -1) names[firstString] = "message";
  const firstBytes = types.findIndex((t) => t === "bytes");
  if (firstBytes !== -1 && names[firstBytes] === `arg${firstBytes}`) names[firstBytes] = "message";

  // Infer which params are indexed based on topics length.
  // topics.length = 1 (signature hash) + indexed params
  const indexed = new Array(types.length).fill(false);
  let remaining = Math.max(0, Number(indexedCount) || 0);

  // Prefer indexing static types (especially addresses) first
  const order = types
    .map((t, i) => ({ i, t, w: typeWeight(t) }))
    .sort((a, b) => b.w - a.w);

  for (const it of order) {
    if (remaining <= 0) break;
    if (isDynamicType(it.t)) continue;
    indexed[it.i] = true;
    remaining -= 1;
  }

  // If we still need more, index remaining params (including dynamic) left-to-right
  for (let i = 0; i < types.length && remaining > 0; i++) {
    if (indexed[i]) continue;
    indexed[i] = true;
    remaining -= 1;
  }

  return types.map((t, i) => ({ name: names[i], type: t, indexed: indexed[i] }));
}

function makeEventAbi(evSig, sampleTopicsLen) {
  const indexedCount = Math.max(0, (Number(sampleTopicsLen) || 1) - 1);
  return {
    type: "event",
    name: evSig.name,
    anonymous: false,
    inputs: makeEventInputs(evSig.types, indexedCount),
  };
}

async function inferMinimalAbi() {
  // 1) Bytecode -> function selectors
  const code = await rpc("eth_getCode", [ADDRESS, "latest"]);
  const selectors = extractSelectors(code);

  // 2) Recent logs -> event topics[0]
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);

  let logs = [];
  let to = latest;
  // Scan backwards in small windows until we find logs
  for (let tries = 0; tries < 8; tries++) {
    const from = Math.max(0, to - 5000);
    try {
      const batch = await rpc("eth_getLogs", [
        { address: ADDRESS, fromBlock: toHex(from), toBlock: toHex(to) },
      ]);
      if (Array.isArray(batch) && batch.length) {
        logs = batch;
        break;
      }
    } catch {
      // ignore and keep scanning
    }
    to = from - 1;
    if (to <= 0) break;
  }

  const topic0Counts = new Map();
  const topic0SampleTopicsLen = new Map();
  if (Array.isArray(logs)) {
    for (const l of logs) {
      const t0 = (l?.topics?.[0] || "").toString().toLowerCase();
      if (!t0 || !t0.startsWith("0x") || t0.length !== 66) continue;
      topic0Counts.set(t0, (topic0Counts.get(t0) || 0) + 1);
      if (!topic0SampleTopicsLen.has(t0)) {
        topic0SampleTopicsLen.set(t0, Array.isArray(l?.topics) ? l.topics.length : 1);
      }
    }
  }

  const topTopics = Array.from(topic0Counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t0]) => t0);

  // 3) Lookup signatures
  // Functions: chunk to keep URLs small
  const fnCandidates = [];
  const selList = selectors.slice(0, 120); // cap
  for (let i = 0; i < selList.length; i += 24) {
    const chunk = selList.slice(i, i + 24);
    try {
      const looked = await lookupSignatures({ functions: chunk, events: [] });
      const map = looked?.function || {};
      for (const [sel, arr] of Object.entries(map)) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const sig = parseTextSig(item?.name);
          if (!sig) continue;
          fnCandidates.push({ selector: sel, sig });
        }
      }
    } catch {
      // keep going
    }
  }

  // Events: lookup top event topics
  let evCandidates = [];
  if (topTopics.length) {
    try {
      const looked = await lookupSignatures({ functions: [], events: topTopics });
      const map = looked?.event || {};
      for (const [topic, arr] of Object.entries(map)) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const sig = parseTextSig(item?.name);
          if (!sig) continue;
          evCandidates.push({ topic0: topic, sig });
        }
      }
    } catch {
      evCandidates = [];
    }
  }

  // 4) Choose best send function: exactly 1 arg that is string or bytes
  const sendFns = fnCandidates
    .map((c) => ({ ...c, score: scoreName(c.sig.name) }))
    .filter((c) => c.sig.types.length === 1 && (c.sig.types[0] === "string" || c.sig.types[0] === "bytes"))
    .sort((a, b) => b.score - a.score);

  if (!sendFns.length) {
    throw new Error("NO_SEND_FUNCTION_FOUND");
  }

  const chosenFn = sendFns[0].sig;

  // 5) Choose best event: must contain string or bytes; also must be plausible for topic count
  const scoredEvents = evCandidates
    .map((c) => {
      const sampleLen = topic0SampleTopicsLen.get((c.topic0 || "").toLowerCase()) || 1;
      const indexedCount = Math.max(0, sampleLen - 1);
      const okParams = c.sig.types.length >= indexedCount && c.sig.types.length >= 1;
      const hasText = c.sig.types.some((t) => t === "string" || t === "bytes");
      return {
        ...c,
        sampleTopicsLen: sampleLen,
        okParams,
        hasText,
        score: scoreName(c.sig.name) + (hasText ? 10 : 0),
      };
    })
    .filter((c) => c.okParams && c.hasText)
    .sort((a, b) => b.score - a.score);

  if (!scoredEvents.length) {
    throw new Error("NO_MESSAGE_EVENT_FOUND");
  }

  const chosenEvent = scoredEvents[0];

  const abi = [makeFnAbi(chosenFn), makeEventAbi(chosenEvent.sig, chosenEvent.sampleTopicsLen)];
  return abi;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ status: "0", message: "METHOD_NOT_ALLOWED", result: "" });
      return;
    }

    // 1) Verified ABI fast path
    const verified = await getVerifiedAbiFromBlockscout();
    if (verified) {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.status(200).json({ status: "1", message: "OK", result: verified });
      return;
    }

    // 2) Inference fallback
    const inferred = await inferMinimalAbi();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "1", message: "OK", result: JSON.stringify(inferred) });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "0", message: "ABI_UNAVAILABLE", result: "" });
  }
}

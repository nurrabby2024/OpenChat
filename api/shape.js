const ADDRESS = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
const BASE_RPC = "https://mainnet.base.org";
const LOOKUP =
  "https://api.4byte.sourcify.dev/signature-database/v1/lookup";

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

function hexPad32(h) {
  return h.replace(/^0x/, "").padStart(64, "0");
}
function isDyn(t) {
  return t === "string" || t === "bytes";
}
function encUint(n) {
  const bn = BigInt(n);
  return hexPad32("0x" + bn.toString(16));
}
function encBool(b) {
  return hexPad32(b ? "0x1" : "0x0");
}
function encAddr(a) {
  const x = (a || "").toLowerCase();
  return hexPad32("0x" + x.replace(/^0x/, ""));
}
function encBytesN(size) {
  // bytes32 etc -> zero
  return "0".repeat(64);
}
function utf8ToHex(s) {
  const bytes = new TextEncoder().encode(s);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function encDynBytes(hexData) {
  const len = hexData.length / 2;
  const lenWord = encUint(len);
  const padded = hexData.padEnd(Math.ceil(hexData.length / 64) * 64, "0");
  return lenWord + padded;
}

// ABI-encoding (basic): supports address, uint/int, bool, bytesN, bytes, string
function encodeArgs(types, from, message) {
  const values = [];
  let usedMsg = false;

  for (const t of types) {
    if ((t === "string" || t === "bytes") && !usedMsg) {
      values.push({ type: t, value: message });
      usedMsg = true;
    } else if (t === "address") {
      values.push({ type: t, value: from });
    } else if (t.startsWith("uint") || t.startsWith("int")) {
      values.push({ type: t, value: 0 });
    } else if (t === "bool") {
      values.push({ type: t, value: false });
    } else if (t.startsWith("bytes") && t !== "bytes") {
      values.push({ type: t, value: null }); // bytes32 -> zero
    } else if (t === "string") {
      values.push({ type: t, value: "" });
    } else if (t === "bytes") {
      values.push({ type: t, value: "" });
    } else {
      // unsupported type (arrays/tuples) -> fail
      return null;
    }
  }

  // head/tail
  const head = [];
  const tail = [];
  let headSize = values.length * 32; // bytes

  for (const v of values) {
    if (!isDyn(v.type)) {
      if (v.type === "address") head.push(encAddr(v.value));
      else if (v.type.startsWith("uint") || v.type.startsWith("int"))
        head.push(encUint(v.value));
      else if (v.type === "bool") head.push(encBool(v.value));
      else if (v.type.startsWith("bytes") && v.type !== "bytes")
        head.push(encBytesN(v.type));
      else return null;
    } else {
      // offset
      head.push(encUint(headSize));
      let dataHex = "";
      if (v.type === "string") dataHex = utf8ToHex(v.value);
      if (v.type === "bytes") dataHex = utf8ToHex(v.value);
      const dyn = encDynBytes(dataHex);
      tail.push(dyn);
      headSize += dyn.length / 2;
    }
  }

  return head.join("") + tail.join("");
}

function parseSig(text) {
  const m = String(text || "").match(/^([A-Za-z0-9_]+)\((.*)\)$/);
  if (!m) return null;
  const name = m[1];
  const inside = (m[2] || "").trim();
  const parts = inside ? inside.split(",").map((s) => s.trim()) : [];
  const types = parts.map((p) => p.split(" ")[0].trim()).filter(Boolean);
  return { name, types, text: `${name}(${types.join(",")})` };
}

function scoreName(n) {
  n = (n || "").toLowerCase();
  const hits = ["message", "chat", "post", "send", "say", "speak", "publish", "cast"];
  let s = 0;
  for (const h of hits) if (n.includes(h)) s += 5;
  return s;
}

async function lookupSelector(sel) {
  const url = `${LOOKUP}?function=${encodeURIComponent(sel)}&filter=true`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => null);
  const arr = j?.result?.function?.[sel] || [];
  return arr.map((x) => x?.name).filter(Boolean);
}

async function ethCall(from, data) {
  return rpc("eth_call", [{ from, to: ADDRESS, data }, "latest"]);
}

async function getSelectorsFromRecentTxs() {
  // Try to find tx hashes via logs (no ABI needed)
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  let fromBlock = Math.max(0, latest - 20000);
  let logs = [];

  for (let i = 0; i < 6; i++) {
    try {
      logs = await rpc("eth_getLogs", [
        { address: ADDRESS, fromBlock: "0x" + fromBlock.toString(16), toBlock: "0x" + latest.toString(16) },
      ]);
      if (Array.isArray(logs) && logs.length) break;
    } catch {}
    fromBlock = Math.max(0, fromBlock - 20000);
  }

  const txs = [];
  const seen = new Set();
  for (const l of logs || []) {
    const h = (l?.transactionHash || "").toLowerCase();
    if (h && !seen.has(h)) {
      seen.add(h);
      txs.push(h);
    }
    if (txs.length >= 30) break;
  }

  const selCount = new Map();
  for (const h of txs) {
    try {
      const tx = await rpc("eth_getTransactionByHash", [h]);
      if (!tx?.to) continue;
      if (String(tx.to).toLowerCase() !== ADDRESS.toLowerCase()) continue;
      const input = String(tx.input || "");
      if (input.length < 10) continue;
      const sel = input.slice(0, 10).toLowerCase();
      selCount.set(sel, (selCount.get(sel) || 0) + 1);
    } catch {}
  }

  return Array.from(selCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([sel]) => sel);
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

export default async function handler(req, res) {
  try {
    const body =
      req.method === "POST"
        ? await new Promise((resolve) => {
            let d = "";
            req.on("data", (c) => (d += c));
            req.on("end", () => {
              try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); }
            });
          })
        : {};

    const from = String(body?.from || "").toLowerCase();
    const message = String(body?.message || "hi").slice(0, 120);

    if (!from || !from.startsWith("0x") || from.length !== 42) {
      res.status(200).json({ status: "0", message: "FROM_REQUIRED", result: "" });
      return;
    }

    // 1) selectors from recent txs, else from bytecode
    let selectors = await getSelectorsFromRecentTxs();
    if (!selectors.length) {
      const code = await rpc("eth_getCode", [ADDRESS, "latest"]);
      selectors = extractSelectorsFromBytecode(code).slice(0, 80);
    }
    if (!selectors.length) {
      res.status(200).json({ status: "0", message: "NO_SELECTORS", result: "" });
      return;
    }

    // 2) Try candidates: lookup signature + eth_call probe
    for (const sel of selectors.slice(0, 12)) {
      const sigTexts = await lookupSelector(sel);
      const candidates = sigTexts
        .map(parseSig)
        .filter(Boolean)
        .map((s) => ({ ...s, score: scoreName(s.name) }));

      // prefer chat-like names + has string/bytes somewhere
      candidates.sort((a, b) => b.score - a.score);

      for (const cand of candidates.slice(0, 18)) {
        // must include at least one string/bytes
        if (!cand.types.some((t) => t === "string" || t === "bytes")) continue;

        const argsEnc = encodeArgs(cand.types, from, message);
        if (!argsEnc) continue;

        const data = sel + argsEnc;
        try {
          await ethCall(from, data); // if no revert => likely correct
          res.setHeader("cache-control", "no-store");
          res.status(200).json({
            status: "1",
            message: "OK",
            result: { selector: sel, signature: cand.text, types: cand.types },
          });
          return;
        } catch {
          // try next
        }
      }
    }

    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "NO_WORKING_SIGNATURE", result: "" });
  } catch {
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ status: "0", message: "ERROR", result: "" });
  }
}

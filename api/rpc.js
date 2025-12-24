// Vercel Serverless JSON-RPC proxy to Base RPC (keeps app calls same-domain)
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    const body = req.body ?? {};
    const rpc = ["https", "://", "mainnet.base.org"].join("");
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(txt);
  } catch {
    res.status(500).json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "RPC proxy error" } });
  }
}

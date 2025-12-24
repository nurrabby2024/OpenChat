// Vercel Serverless Function: proxies explorer ABI (avoids CORS in Mini App webviews)
export default async function handler(req, res) {
  try {
    const address = "0xD4f66cBFA345C18Afc928a48f470566729bEEcA5";
    const origin = ["https", "://", "base.blockscout.com"].join("");
    const url = `${origin}/api?module=contract&action=getabi&address=${address}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const j = await r.json();
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(j);
  } catch {
    res.status(500).json({ status: "0", message: "ERROR", result: "" });
  }
}

// Redirect to Basescan tx page while keeping links on app domain
export default async function handler(req, res) {
  const hash = (req.query?.hash || "").toString();
  if (!hash || !hash.startsWith("0x")) {
    res.status(400).send("Missing tx hash");
    return;
  }
  const origin = ["https", "://", "basescan.org"].join("");
  res.status(302).setHeader("Location", `${origin}/tx/${hash}`).end();
}

// api/rawg.js — Vercel Serverless Function
// Proxies RAWG API so the key stays server-side (set as Vercel env var)
//
// Setup:
//   1. Go to Vercel dashboard → your project → Settings → Environment Variables
//   2. Add: RAWG_API_KEY = your_key_from_rawg.io/apidocs
//   3. Redeploy — done. Users never see the key.
//
// Usage: GET /api/rawg?q=mario&platforms=7&page_size=8

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60");

  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RAWG_API_KEY not set in Vercel environment variables" });
  }

  const { q = "", platforms = "7", page_size = "8" } = req.query;
  if (!q || q.length < 2) return res.status(200).json({ results: [] });

  try {
    const url = `https://api.rawg.io/api/games?key=${apiKey}&search=${encodeURIComponent(q)}&platforms=${platforms}&page_size=${page_size}&search_precise=false`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    if (!r.ok) throw new Error(`RAWG ${r.status}`);
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

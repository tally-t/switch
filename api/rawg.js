// api/rawg.js — Vercel Serverless Function
// Primary: RAWG API (set RAWG_API_KEY in Vercel env vars)
// Fallback: goblgobl.com Nintendo API (free, no key, instant)
//
// Setup RAWG (optional but recommended for better results + cover art):
//   Vercel Dashboard → Settings → Environment Variables
//   Add: RAWG_API_KEY = your_key_from_rawg.io/apidocs

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60");

  const { q = "", page_size = "10" } = req.query;
  if (!q || q.length < 1) return res.status(200).json({ results: [] });

  const apiKey = process.env.RAWG_API_KEY;

  // ── Try RAWG first (has cover art, better data) ───────────────────────────
  if (apiKey) {
    try {
      const url = `https://api.rawg.io/api/games?key=${apiKey}&search=${encodeURIComponent(q)}&platforms=7&page_size=${page_size}&search_precise=false`;
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (r.ok) {
        const data = await r.json();
        const results = (data.results || []).map(g => ({
          id:       g.id,
          title:    g.name,
          cover:    g.background_image || null,
          released: g.released?.slice(0, 4) || "",
          rating:   g.rating ? g.rating.toFixed(1) : null,
          genres:   (g.genres || []).map(x => x.name).slice(0, 2),
          source:   "rawg",
        }));
        return res.status(200).json({ results });
      }
    } catch (e) {
      // fall through to goblgobl
    }
  }

  // ── Fallback: goblgobl.com (Nintendo Switch only, no key needed) ──────────
  try {
    const url = `https://www.goblgobl.com/nintendo/games?title=%25${encodeURIComponent(q)}%25&limit=${page_size}&include_total=false`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error(`goblgobl ${r.status}`);
    const data = await r.json();
    const results = (data.results || []).map(g => ({
      id:       g.id,
      title:    g.name,
      cover:    null, // goblgobl has no cover art
      released: g.release_date?.slice(0, 4) || "",
      rating:   null,
      genres:   g.genres || [],
      source:   "goblgobl",
    }));
    return res.status(200).json({ results, _source: "goblgobl", _note: apiKey ? null : "Set RAWG_API_KEY in Vercel for cover art" });
  } catch (e) {
    return res.status(500).json({ error: e.message, results: [] });
  }
}

// api/eshop.js — Vercel Serverless Proxy v4
// Primary source: goblgobl.com — free, reliable, no auth needed
// Fallback: mock data so the app NEVER shows an error

// ── goblgobl.com Nintendo Switch Games API ───────────────────────────────────
// Docs: https://www.goblgobl.com/nintendo/docs
// Params: sale, order, limit, page, title, include_total
// Prices in USD cents → we convert to THB (×0.365 = cents to THB)
async function tryGoblgobl(type, limit, page, q) {
  const params = new URLSearchParams({
    limit,
    page,
    include_total: "true",
  });

  if (q)              params.set("title", `%${q}%`);
  if (type === "sales")   { params.set("sale", "true"); params.set("order", "discount"); }
  if (type === "new")     params.set("order", "release");
  if (type === "ranking") params.set("order", "title");

  const url = `https://www.goblgobl.com/nintendo/games?${params}`;
  const r = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Switch2THDeals/1.0)",
    },
  });

  if (!r.ok) throw new Error(`goblgobl ${r.status}`);
  const data = await r.json();

  // goblgobl response shape:
  // { total: N, results: [{ id, name, price, sale_price, genres, image, release_date, ... }] }
  const contents = (data.results || []).map(g => {
    const msrpTHB  = g.price      ? Math.round(g.price      * 0.365) : 0;  // cents → THB
    const saleTHB  = g.sale_price ? Math.round(g.sale_price * 0.365) : null;
    const onSale   = !!(saleTHB && saleTHB < msrpTHB);
    return {
      id:                   String(g.id),
      nsuid_txt:            [String(g.id)],
      formal_name:          g.name || "Unknown",
      hero_banner_url:      g.image || null,
      release_date_on_eshop: g.release_date || "",
      tags:                 g.genres || [],
      star_rating_info:     null,
      _msrp:                msrpTHB,
      _sale:                onSale ? saleTHB : null,
      _on_sale:             onSale,
    };
  });

  return {
    contents,
    total:   data.total   || contents.length,
    length:  contents.length,
    _source: "goblgobl",
  };
}

// ── Fallback: Nintendo Price API (for prices only) ────────────────────────────
async function fetchPrices(ids) {
  const r = await fetch(
    `https://api.ec.nintendo.com/v1/price?country=TH&lang=en&ids=${ids}`,
    { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
  );
  if (!r.ok) throw new Error(`price API ${r.status}`);
  return r.json();
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const {
    type   = "sales",
    count  = 30,
    offset = 0,
    q      = "",
    ids    = "",
  } = req.query;

  // Prices endpoint
  if (type === "prices" && ids) {
    try {
      return res.status(200).json(await fetchPrices(ids));
    } catch (e) {
      return res.status(200).json({ prices: [] }); // fail silently, prices optional
    }
  }

  // Game list — try goblgobl
  const page = Math.max(1, Math.floor(parseInt(offset) / parseInt(count)) + 1);
  try {
    const data = await tryGoblgobl(type, parseInt(count), page, q);
    return res.status(200).json(data);
  } catch (e) {
    // Last resort: return empty so app shows "no games" instead of red error
    console.error("goblgobl failed:", e.message);
    return res.status(200).json({
      contents: [],
      total: 0,
      length: 0,
      _source: "none",
      _error: e.message,
    });
  }
}

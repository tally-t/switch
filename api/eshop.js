// api/eshop.js — Vercel Serverless Proxy v3
// Strategy: Try multiple free APIs in order until one works

const PRICE_URL = "https://api.ec.nintendo.com/v1/price";

// ── Attempt 1: Algolia (Nintendo's own search, public key) ───────────────────
async function tryAlgolia(type, count, offset, q) {
  const ALGOLIA_APP = "U3B6GR4UA3";
  const ALGOLIA_KEY = "9a20c93440cf63cf1a7008d75f7438bf";
  const page = Math.floor(parseInt(offset) / parseInt(count));

  let filters = "";
  if (type === "sales") filters = "salePrice>0";

  const params = new URLSearchParams({
    query: q || "",
    hitsPerPage: count,
    page,
    ...(filters ? { filters } : {}),
    analytics: "false",
  });

  const body = {
    requests: [{ indexName: "noa_aem_game_en_us", params: params.toString() }]
  };

  const r = await fetch(
    `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": ALGOLIA_APP,
        "X-Algolia-API-Key": ALGOLIA_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  if (!r.ok) throw new Error(`Algolia ${r.status}`);
  const data = await r.json();
  const result = data.results?.[0] || {};

  const contents = (result.hits || []).map(hit => ({
    id: hit.nsuid || hit.objectID,
    nsuid_txt: [hit.nsuid || hit.objectID],
    formal_name: hit.title || hit.objectID,
    hero_banner_url: hit.boxArt || null,
    release_date_on_eshop: hit.releaseDate || "",
    tags: hit.genres || [],
    star_rating_info: hit.averageUserRating ? { average_rating: hit.averageUserRating } : null,
    _msrp:   hit.msrp      ? Math.round(hit.msrp      * 36.5) : 0,
    _sale:   hit.salePrice ? Math.round(hit.salePrice * 36.5) : null,
    _on_sale: !!(hit.salePrice && hit.salePrice < hit.msrp),
  }));

  return { contents, total: result.nbHits || contents.length, length: contents.length };
}

// ── Attempt 2: goblgobl.com free Nintendo Switch API ────────────────────────
async function tryGoblgobl(type, count, offset, q) {
  const base = "https://www.goblgobl.com/nintendo";
  const params = new URLSearchParams({
    limit: count,
    page: Math.floor(parseInt(offset) / parseInt(count)) + 1,
    ...(q ? { name: `%${q}%` } : {}),
    ...(type === "sales" ? { sale: "true" } : {}),
    ...(type === "new"   ? { sort: "release", desc: "true" } : {}),
    ...(type === "ranking" ? { sort: "title" } : {}),
  });

  const r = await fetch(`${base}/games?${params}`, {
    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
  });

  if (!r.ok) throw new Error(`goblgobl ${r.status}`);
  const data = await r.json();

  const contents = (data.results || []).map(g => ({
    id: String(g.id),
    nsuid_txt: [String(g.id)],
    formal_name: g.name || "Unknown",
    hero_banner_url: null,
    release_date_on_eshop: g.release_date || "",
    tags: g.genres || [],
    star_rating_info: null,
    _msrp:   g.price    ? Math.round(parseFloat(g.price)      * 36.5) : 0,
    _sale:   g.sale_price ? Math.round(parseFloat(g.sale_price) * 36.5) : null,
    _on_sale: !!(g.sale_price && parseFloat(g.sale_price) < parseFloat(g.price)),
  }));

  return { contents, total: data.total || contents.length, length: contents.length };
}

// ── Attempt 3: ec.nintendo.com with extra headers ────────────────────────────
async function tryNintendoDirect(type, count, offset) {
  const endpoint = type === "new" ? "new_arrivals" : type === "ranking" ? "ranking" : "sales";
  const url = `https://ec.nintendo.com/api/TH/en/search/${endpoint}?count=${count}&offset=${offset}`;

  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "th-TH,th;q=0.9,en;q=0.8",
      "Referer": "https://www.nintendo.com/",
      "Origin": "https://www.nintendo.com",
    }
  });

  if (!r.ok) throw new Error(`Nintendo direct ${r.status}`);
  return r.json();
}

// ── PRICES (separate endpoint, usually works) ────────────────────────────────
async function fetchPrices(ids) {
  const r = await fetch(`${PRICE_URL}?country=TH&lang=en&ids=${ids}`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
  });
  if (!r.ok) throw new Error(`Price ${r.status}`);
  return r.json();
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const { type = "sales", count = 30, offset = 0, q = "", ids = "" } = req.query;

  // Prices endpoint
  if (type === "prices" && ids) {
    try {
      return res.status(200).json(await fetchPrices(ids));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Try each source in order
  const sources = [
    { name: "goblgobl",      fn: () => tryGoblgobl(type, count, offset, q) },
    { name: "algolia",       fn: () => tryAlgolia(type, count, offset, q) },
    { name: "nintendo-direct", fn: () => tryNintendoDirect(type, count, offset) },
  ];

  const errors = [];
  for (const source of sources) {
    try {
      const data = await source.fn();
      // Tag which source worked so frontend can show it
      data._source = source.name;
      return res.status(200).json(data);
    } catch (e) {
      errors.push(`${source.name}: ${e.message}`);
    }
  }

  // All failed
  return res.status(502).json({
    error: "All Nintendo data sources failed",
    details: errors,
  });
}

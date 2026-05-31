// api/eshop.js — Vercel Serverless Proxy
//
// SOLUTION: Nintendo blocks ec.nintendo.com from datacenter IPs (AWS/Vercel)
// Fix: Use two alternative endpoints that work from serverless:
//   1. api.ec.nintendo.com/v1/price  → real-time THB prices (not blocked)
//   2. Algolia search API            → game list + metadata (public key, not blocked)
//
// Algolia credentials are public (embedded in Nintendo's own website JS bundle)
//   App ID:  U3B6GR4UA3
//   API Key: 9a20c93440cf63cf1a7008d75f7438bf  (read-only, search-only)

const ALGOLIA_APP   = "U3B6GR4UA3";
const ALGOLIA_KEY   = "9a20c93440cf63cf1a7008d75f7438bf";
const ALGOLIA_URL   = `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries`;
const PRICE_URL     = "https://api.ec.nintendo.com/v1/price";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const { type = "sales", count = 30, offset = 0, q = "", ids = "" } = req.query;

  try {
    // ── PRICES endpoint ─────────────────────────────────────────────────────
    // Works fine from Vercel — Nintendo never blocked this one
    if (type === "prices" && ids) {
      const url = `${PRICE_URL}?country=TH&lang=en&ids=${ids}`;
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
      });
      if (!r.ok) return res.status(r.status).json({ error: `Price API ${r.status}` });
      return res.status(200).json(await r.json());
    }

    // ── GAME LIST via Algolia ────────────────────────────────────────────────
    // Nintendo uses Algolia for their website game search — public read-only key
    // Index "noa_aem_game_en_us" has Switch + Switch 2 games with sale data
    const page      = Math.floor(parseInt(offset) / parseInt(count));
    const hitsPerPage = parseInt(count);

    // Build filter based on type
    let filters = 'platform:"Nintendo Switch" OR platform:"Nintendo Switch 2"';
    if (type === "sales")   filters += ' AND salePrice > 0';
    if (type === "new")     filters += ' AND availability:"New"';

    const body = {
      requests: [{
        indexName: "noa_aem_game_en_us",
        params: [
          `query=${encodeURIComponent(q || "")}`,
          `hitsPerPage=${hitsPerPage}`,
          `page=${page}`,
          `filters=${encodeURIComponent(filters)}`,
          type === "ranking" ? "sortFacetValuesBy=alpha" : "",
          "analytics=false",
        ].filter(Boolean).join("&")
      }]
    };

    const r = await fetch(
      `${ALGOLIA_URL}?x-algolia-application-id=${ALGOLIA_APP}&x-algolia-api-key=${ALGOLIA_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify(body),
      }
    );

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: `Algolia ${r.status}: ${errText.slice(0, 200)}` });
    }

    const data = await r.json();
    const result = data.results?.[0] || {};

    // Normalise Algolia response → same shape the app expects
    // Algolia fields: title, msrp, salePrice, percentOff, nsuid, genres[], boxArt, releaseDate, developers[]
    const contents = (result.hits || []).map(hit => ({
      id:                   hit.nsuid || hit.objectID,
      nsuid_txt:            [hit.nsuid || hit.objectID],
      formal_name:          hit.title || hit.objectID,
      hero_banner_url:      hit.boxArt || hit.horizontalHeaderImage || null,
      release_date_on_eshop: hit.releaseDate || "",
      tags:                 hit.genres || [],
      publishers:           hit.developers || [],
      star_rating_info:     hit.averageUserRating ? { average_rating: hit.averageUserRating } : null,
      // Embed price directly so the app can skip the separate price fetch
      _msrp:                hit.msrp   ? Math.round(hit.msrp   * 36.5) : 0,  // USD→THB approx
      _sale:                hit.salePrice ? Math.round(hit.salePrice * 36.5) : null,
      _on_sale:             !!(hit.salePrice && hit.salePrice < hit.msrp),
    }));

    return res.status(200).json({
      contents,
      total:  result.nbHits  || contents.length,
      length: contents.length,
      offset: parseInt(offset),
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

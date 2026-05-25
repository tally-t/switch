// api/eshop.js — Vercel Serverless Function (free tier)
// Proxies Nintendo eShop TH API to bypass CORS
//
// Endpoints this proxy supports:
//   GET /api/eshop?type=sales&count=30&offset=0   → games on sale
//   GET /api/eshop?type=new&count=30&offset=0     → new arrivals
//   GET /api/eshop?type=ranking&count=30&offset=0 → top ranking
//   GET /api/eshop?type=search&q=zelda&count=30   → search by name
//   GET /api/eshop?type=prices&ids=70010000079045,70010000073084 → prices by nsuid

export default async function handler(req, res) {
  // Allow all origins (your deployed app can call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300"); // cache 5 mins on Vercel edge

  const { type = "sales", count = 30, offset = 0, q = "", ids = "" } = req.query;

  try {
    let url;

    if (type === "prices" && ids) {
      // Separate Nintendo price API — returns regular + discount prices by nsuid
      // ids = comma-separated nsuids e.g. "70010000079045,70010000073084"
      url = `https://api.ec.nintendo.com/v1/price?country=TH&lang=en&ids=${ids}`;
    } else if (type === "search" && q) {
      url = `https://ec.nintendo.com/api/TH/en/search/title?count=${count}&offset=${offset}&q=${encodeURIComponent(q)}`;
    } else {
      // sales | new | ranking
      const endpoint = type === "new" ? "new_arrivals" : type === "ranking" ? "ranking" : "sales";
      url = `https://ec.nintendo.com/api/TH/en/search/${endpoint}?count=${count}&offset=${offset}`;
    }

    const response = await fetch(url, {
      headers: {
        // Mimic a browser request so Nintendo doesn't block it
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Nintendo API returned ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

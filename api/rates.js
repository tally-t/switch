// api/rates.js — Vercel Serverless Function
// Fetches latest exchange rates from exchangerate-api.com (free, no key needed)
// Base: THB — returns how many THB per 1 unit of each currency
//
// Free endpoint: https://open.er-api.com/v6/latest/THB
// 1,500 requests/month free — cached 1 hour on Vercel edge so barely uses quota

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200"); // cache 1hr

  try {
    // Fetch rates with THB as base — gives us "1 THB = X foreign"
    // We actually want "1 foreign = X THB", so we use USD as base and compute
    const r = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { "Accept": "application/json" }
    });
    if (!r.ok) throw new Error(`rates ${r.status}`);
    const data = await r.json();

    // data.rates = { THB: 33.5, JPY: 149.2, EUR: 0.92, ... } (per 1 USD)
    // To get "1 JPY in THB" = rates.THB / rates.JPY
    const usdToThb = data.rates?.THB || 36;
    const rates = {};
    for (const [currency, usdRate] of Object.entries(data.rates || {})) {
      rates[currency] = usdToThb / usdRate; // how many THB per 1 unit of this currency
    }
    rates["THB"] = 1; // 1 THB = 1 THB

    return res.status(200).json({
      base: "THB",
      updated: data.time_last_update_utc,
      rates,
    });
  } catch (e) {
    // Fallback hardcoded rates if API fails
    return res.status(200).json({
      base: "THB",
      updated: "fallback",
      rates: {
        THB: 1, USD: 36.5, JPY: 0.245, EUR: 39.5, GBP: 46.2,
        HKD: 4.68, SGD: 27.1, AUD: 23.8, KRW: 0.027, MXN: 1.82,
        CNY: 5.05, TWD: 1.14, CAD: 26.8,
      },
    });
  }
}

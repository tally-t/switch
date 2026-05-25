import { useState, useEffect, useRef } from "react";

// ─── API LAYER ────────────────────────────────────────────────────────────────
// All calls go through /api/eshop (Vercel proxy → ec.nintendo.com)
// Response shape from Nintendo:
//   { contents: [{ formal_name, hero_banner_url, id, release_date_on_eshop, ... }], total, length, offset }
// Price endpoint:
//   { prices: [{ title_id, sales_status, regular_price: { raw_value }, discount_price: { raw_value } }] }

const GENRE_EMOJI = {
  "Action":       "⚔️",
  "Adventure":    "🗺️",
  "RPG":          "🧙",
  "Platformer":   "🎮",
  "Racing":       "🏎️",
  "Fighting":     "🥊",
  "Shooter":      "🎯",
  "Puzzle":       "🧩",
  "Sports":       "⚽",
  "Simulation":   "🏗️",
  "Music":        "🎵",
  "Strategy":     "♟️",
};
const GENRES = ["All", "Action", "Adventure", "RPG", "Platformer", "Racing", "Fighting", "Shooter", "Puzzle", "Sports", "Music", "Strategy"];
const PAGE_SIZE = 30;
const fmt = (n) => `฿${Number(n).toLocaleString("th-TH")}`;

// Fetch game list from Nintendo eShop TH
async function fetchGames(type = "sales", offset = 0) {
  const res = await fetch(`/api/eshop?type=${type}&count=${PAGE_SIZE}&offset=${offset}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
  // Returns: { contents: [...], total, length, offset }
}

// Fetch prices for a batch of nsuids
async function fetchPrices(nsuids) {
  if (!nsuids.length) return [];
  const ids = nsuids.join(",");
  const res = await fetch(`/api/eshop?type=prices&ids=${ids}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.prices || [];
  // Returns: [{ title_id, sales_status, regular_price: { raw_value }, discount_price: { raw_value } }]
}

// Search games
async function searchGames(q, offset = 0) {
  const res = await fetch(`/api/eshop?type=search&q=${encodeURIComponent(q)}&count=${PAGE_SIZE}&offset=${offset}`);
  if (!res.ok) throw new Error(`Search error ${res.status}`);
  return res.json();
}

// Map Nintendo API game object → our app's shape
function mapGame(item, priceMap = {}) {
  const nsuid = item.nsuid_txt?.[0] || item.id?.toString() || "";
  const price  = priceMap[nsuid] || {};
  const msrp   = price.regular_price  ? parseInt(price.regular_price.raw_value)  : null;
  const sale   = price.discount_price ? parseInt(price.discount_price.raw_value) : null;
  const onSale = price.sales_status === "onsale" && sale != null;

  // Derive a genre from tags/categories if present
  const tags   = item.tags || [];
  const genre  = tags.find(t => GENRES.includes(t)) || "Action";

  return {
    id:       nsuid || item.id,
    nsuid,
    title:    item.formal_name || "Unknown",
    genre,
    emoji:    GENRE_EMOJI[genre] || "🎮",
    banner:   item.hero_banner_url || null,
    released: item.release_date_on_eshop || "",
    msrp:     msrp || 0,
    sale_price: onSale ? sale : null,
    on_sale:  onSale,
    rating:   item.star_rating_info?.average_rating || null,
  };
}

// ─── AI ADVICE ────────────────────────────────────────────────────────────────
async function getAIAdvice(game, budget) {
  const price = game.sale_price || game.msrp;
  const prompt = `Budget gaming advisor for Thai Nintendo Switch 2 eShop players.
Game: "${game.title}" (${game.genre})
eShop TH price: ฿${price}${game.on_sale ? ` SALE! (ลดจาก ฿${game.msrp} ประหยัด ฿${game.msrp - game.sale_price})` : " (ราคาปกติ)"}
Monthly budget: ฿${budget}

2 sentences max. Thai gamer slang + English. Start with "🟢 ซื้อเลย!" or "🟡 รอก่อน!"`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.find(b => b.type === "text")?.text || "ดูสถานการณ์ก่อนนะ!";
}

// ─── LINE SEND ────────────────────────────────────────────────────────────────
async function sendLineMessage(token, games) {
  const saleGames = games.filter(g => g.on_sale);
  const text = saleGames.length
    ? `🎮 Switch2 eShop TH — ดีลวันนี้!\n\n${saleGames.slice(0, 10).map(g =>
        `${g.emoji} ${g.title}\n฿${g.msrp} → ฿${g.sale_price} (ประหยัด ฿${g.msrp - g.sale_price})`
      ).join("\n\n")}\n\nเปิดแอปดูดีลทั้งหมด!`
    : "🎮 Switch2 TH: ยังไม่มีดีลตอนนี้ จะแจ้งทันทีที่มีราคาลด!";

  await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ messages: [{ type: "text", text }] }),
  });
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [games, setGames]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [offset, setOffset]         = useState(0);
  const [loading, setLoading]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mode, setMode]             = useState("sales"); // sales | new | ranking
  const [searchQ, setSearchQ]       = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [genre, setGenre]           = useState("All");
  const [budget, setBudget]         = useState(3000);
  const [tempBudget, setTempBudget] = useState("3000");
  const [wishlist, setWishlist]     = useState(() => {
    try { return JSON.parse(localStorage.getItem("sw2_wish") || "[]"); } catch { return []; }
  });
  const [lineAlerts, setLineAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sw2_alerts") || "[]"); } catch { return []; }
  });
  const [lineToken, setLineToken]   = useState(() => localStorage.getItem("sw2_token") || "");
  const [tab, setTab]               = useState("deals");
  const [aiAdvice, setAiAdvice]     = useState({});
  const [aiLoading, setAiLoading]   = useState(null);
  const [expanded, setExpanded]     = useState(null);
  const [lineSending, setLineSending] = useState(false);
  const [showLineModal, setShowLineModal] = useState(false);
  const [toast, setToast]           = useState(null);
  const [error, setError]           = useState(null);

  // Persist wishlist + alerts
  useEffect(() => { localStorage.setItem("sw2_wish", JSON.stringify(wishlist)); }, [wishlist]);
  useEffect(() => { localStorage.setItem("sw2_alerts", JSON.stringify(lineAlerts)); }, [lineAlerts]);
  useEffect(() => { localStorage.setItem("sw2_token", lineToken); }, [lineToken]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 600);
    return () => clearTimeout(t);
  }, [searchQ]);

  // Load on mount and when mode/search changes
  useEffect(() => { load(0, true); }, [mode, debouncedQ]);

  const showToast = (msg, color = "#eab308") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  async function load(off = 0, reset = false) {
    if (off === 0) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      // 1. Fetch game list
      const listData = debouncedQ
        ? await searchGames(debouncedQ, off)
        : await fetchGames(mode, off);

      const items = listData.contents || [];
      const totalCount = listData.total || items.length;

      // 2. Fetch prices for all games in batch
      const nsuids = items.map(g => g.nsuid_txt?.[0] || g.id?.toString()).filter(Boolean);
      const prices = await fetchPrices(nsuids);
      const priceMap = {};
      for (const p of prices) {
        priceMap[p.title_id?.toString()] = p;
      }

      // 3. Map to our shape
      const mapped = items.map(item => mapGame(item, priceMap));

      setTotal(totalCount);
      setOffset(off);
      if (reset) setGames(mapped);
      else setGames(prev => [...prev, ...mapped]);
    } catch (e) {
      setError(e.message);
      showToast("❌ โหลดเกมไม่ได้: " + e.message, "#f87171");
    }
    setLoading(false);
    setLoadingMore(false);
  }

  const loadMore = () => load(offset + PAGE_SIZE, false);

  const toggleWishlist = (id) => {
    const has = wishlist.includes(id);
    setWishlist(p => has ? p.filter(x => x !== id) : [...p, id]);
    showToast(has ? "ลบออกจาก Wishlist แล้ว" : "✅ เพิ่ม Wishlist แล้ว!");
  };

  const toggleAlert = (id) => {
    const has = lineAlerts.includes(id);
    setLineAlerts(p => has ? p.filter(x => x !== id) : [...p, id]);
    showToast(has ? "🔕 ปิดแจ้งเตือน" : "🔔 เปิดแจ้งเตือนแล้ว!", "#4ade80");
  };

  const askAI = async (game) => {
    setAiLoading(game.id);
    try {
      const advice = await getAIAdvice(game, budget);
      setAiAdvice(p => ({ ...p, [game.id]: advice }));
    } catch {
      setAiAdvice(p => ({ ...p, [game.id]: game.on_sale ? "🟢 ซื้อเลย! Sale ดีมาก!" : "🟡 รอก่อน!" }));
    }
    setAiLoading(null);
  };

  const sendLine = async () => {
    if (!lineToken) { setShowLineModal(true); return; }
    setLineSending(true);
    try {
      await sendLineMessage(lineToken, games.filter(g => lineAlerts.includes(g.id)));
      showToast("✅ ส่ง LINE สำเร็จ!", "#4ade80");
    } catch {
      showToast("❌ ส่ง LINE ไม่ได้ ตรวจสอบ Token ด้วย", "#f87171");
    }
    setLineSending(false);
  };

  const wishGames = games.filter(g => wishlist.includes(g.id));
  const wishTotal = wishGames.reduce((s, g) => s + (g.sale_price || g.msrp || 0), 0);
  const wishSave  = wishGames.reduce((s, g) => s + (g.on_sale ? (g.msrp - g.sale_price) : 0), 0);
  const filtered  = games.filter(g => genre === "All" || g.genre === genre);
  const hasMore   = games.length < total && !debouncedQ;

  return (
    <div style={{ minHeight: "100vh", background: "#080810", fontFamily: "'Noto Sans Thai','IBM Plex Sans',sans-serif", color: "#f0f0f8", maxWidth: 430, margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700;800&family=Black+Han+Sans&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{display:none;}
        .c{transition:transform .14s;}.c:active{transform:scale(.96);}
        .b{transition:all .14s;cursor:pointer;font-family:inherit;border:none;}.b:active{transform:scale(.91);}
        .s{animation:su .28s ease both;}@keyframes su{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
        .f{animation:fi .3s ease;}@keyframes fi{from{opacity:0}to{opacity:1}}
        .p{animation:pu 1.8s infinite;}@keyframes pu{0%,100%{opacity:1}50%{opacity:.3}}
        .sale{animation:sg 2s infinite;}@keyframes sg{0%,100%{box-shadow:0 0 0 0 rgba(234,179,8,.3)}60%{box-shadow:0 0 0 6px rgba(234,179,8,0)}}
        .spin{animation:sp 1s linear infinite;display:inline-block;}@keyframes sp{to{transform:rotate(360deg)}}
        .sk{background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%);background-size:200% 100%;animation:sk 1.4s infinite;}@keyframes sk{0%{background-position:-200% 0}100%{background-position:200% 0}}
        input{outline:none;}
        .mbg{animation:fi .18s ease;}
        a{text-decoration:none;}
      `}</style>

      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(155deg,#180b26 0%,#080810 65%)", padding: "50px 20px 18px", borderBottom: "1px solid rgba(255,255,255,.06)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle,rgba(220,38,38,.2) 0%,transparent 70%)" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#dc2626", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>🇹🇭 Nintendo eShop TH</div>
            <div style={{ fontFamily: "'Black Han Sans',sans-serif", fontSize: 26, lineHeight: 1.1 }}>
              ดีลสด<br /><span style={{ color: "#eab308" }}>eShop ไทย</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end" }}>
            <button className="b" onClick={() => load(0, true)} disabled={loading} style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(74,222,128,.4)", borderRadius: 10, padding: "7px 11px", fontSize: 10, fontWeight: 700, color: "#4ade80", display: "flex", alignItems: "center", gap: 5 }}>
              {loading ? <span className="spin">⚙️</span> : "🔄"} {loading ? "กำลังโหลด..." : total > 0 ? `${total} เกม` : "โหลด"}
            </button>
            <button className="b" onClick={() => setShowLineModal(true)} style={{ background: lineToken ? "rgba(6,199,85,.12)" : "rgba(255,255,255,.05)", border: `1px solid ${lineToken ? "rgba(6,199,85,.3)" : "rgba(255,255,255,.1)"}`, borderRadius: 10, padding: "7px 11px", fontSize: 10, fontWeight: 700, color: lineToken ? "#4ade80" : "#777", display: "flex", alignItems: "center", gap: 5 }}>
              {lineToken ? "🔔" : "🔕"} LINE {lineToken ? `(${lineAlerts.length})` : "Alert"}
            </button>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {[["sales", "🔥 Sale"], ["new", "✨ ใหม่"], ["ranking", "👑 Ranking"]].map(([k, l]) => (
            <button key={k} className="b" onClick={() => setMode(k)} style={{ flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: mode === k ? "rgba(220,38,38,.25)" : "rgba(255,255,255,.05)", color: mode === k ? "#ff6b6b" : "#666", border: mode === k ? "1px solid rgba(220,38,38,.4)" : "1px solid rgba(255,255,255,.07)" }}>{l}</button>
          ))}
        </div>

        {/* Budget */}
        <div style={{ marginTop: 12, background: "rgba(255,255,255,.04)", borderRadius: 14, padding: "12px 14px", border: "1px solid rgba(255,255,255,.07)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#aaa" }}>งบเดือนนี้</span>
            <input value={tempBudget} onChange={e => setTempBudget(e.target.value)} onBlur={() => { const v = parseInt(tempBudget); if (!isNaN(v)) setBudget(v); }}
              style={{ background: "transparent", border: "none", color: "#eab308", fontWeight: 700, fontSize: 14, width: 80, textAlign: "right", fontFamily: "inherit" }} />
          </div>
          <input type="range" min={500} max={10000} step={100} value={budget}
            onChange={e => { setBudget(+e.target.value); setTempBudget(String(e.target.value)); }}
            style={{ width: "100%", accentColor: "#eab308", height: 4 }} />
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginTop: 12 }}>
          {[
            { label: "เกมทั้งหมด", value: total || "...", color: "#a78bfa", icon: "🎮" },
            { label: "Sale",       value: games.filter(g => g.on_sale).length, color: "#f97316", icon: "🔥" },
            { label: "Wishlist",   value: wishlist.length, color: "#60a5fa", icon: "❤️" },
            { label: "LINE",       value: lineAlerts.length, color: "#06c755", icon: "🔔" },
          ].map((s, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,.04)", borderRadius: 11, padding: "9px 6px", textAlign: "center", border: "1px solid rgba(255,255,255,.06)" }}>
              <div style={{ fontSize: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── TABS ───────────────────────────────────────────── */}
      <div style={{ display: "flex", padding: "12px 20px 0", gap: 6 }}>
        {[["deals", "🎮 ดีล"], ["wishlist", "❤️ Wishlist"], ["alerts", "🔔 LINE"]].map(([k, l]) => (
          <button key={k} className="b" onClick={() => setTab(k)} style={{ flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: tab === k ? "#dc2626" : "rgba(255,255,255,.05)", color: tab === k ? "#fff" : "#666", boxShadow: tab === k ? "0 4px 12px rgba(220,38,38,.35)" : "none" }}>{l}</button>
        ))}
      </div>

      {/* ── CONTENT ─────────────────────────────────────────── */}
      <div style={{ padding: "14px 20px 100px" }}>

        {/* ═══ DEALS ═══════════════════════════════════════════ */}
        {tab === "deals" && <div className="f">

          {/* Search */}
          <div style={{ background: "rgba(255,255,255,.05)", borderRadius: 12, padding: "10px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.07)" }}>
            <span>🔍</span>
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="ค้นหาเกม..." style={{ background: "none", border: "none", color: "#f0f0f8", fontSize: 14, flex: 1, fontFamily: "inherit" }} />
            {searchQ && <button className="b" onClick={() => setSearchQ("")} style={{ background: "none", color: "#666", fontSize: 16, padding: 0 }}>✕</button>}
          </div>

          {/* Genre filter */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 4 }}>
            {GENRES.map(g => (
              <button key={g} className="b" onClick={() => setGenre(g)} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: genre === g ? "rgba(255,255,255,.15)" : "rgba(255,255,255,.06)", color: genre === g ? "#fff" : "#777" }}>{g}</button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 14, padding: 16, marginBottom: 12, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171" }}>Nintendo API Error</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4, marginBottom: 12 }}>{error}</div>
              <div style={{ fontSize: 11, color: "#666", lineHeight: 1.7 }}>
                ถ้าเห็นหน้านี้บน Vercel แสดงว่า proxy ทำงานอยู่แต่ Nintendo อาจ block<br />
                ลอง refresh หรือรอสักครู่แล้วกด 🔄 อีกครั้ง
              </div>
              <button className="b" onClick={() => load(0, true)} style={{ marginTop: 12, background: "#dc2626", borderRadius: 10, padding: "8px 18px", fontSize: 12, fontWeight: 700, color: "#fff" }}>ลองใหม่</button>
            </div>
          )}

          {/* Skeletons */}
          {loading && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="sk" style={{ borderRadius: 16, marginBottom: 10, height: 120 }} />
          ))}

          {/* Game cards */}
          {!loading && filtered.map((game, i) => {
            const price   = game.sale_price || game.msrp;
            const inWish  = wishlist.includes(game.id);
            const hasAlt  = lineAlerts.includes(game.id);
            const afford  = price > 0 && price <= budget;
            const isExp   = expanded === game.id;
            return (
              <div key={game.id} className="c s" style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${game.on_sale ? "rgba(234,179,8,.22)" : "rgba(255,255,255,.07)"}`, borderRadius: 16, marginBottom: 10, overflow: "hidden", animationDelay: `${Math.min(i, 10) * .04}s` }}>
                {/* Banner */}
                {game.banner && (
                  <div style={{ height: 80, overflow: "hidden", position: "relative" }}>
                    <img src={game.banner} alt={game.title} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: .7 }} onError={e => e.target.style.display = "none"} />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 40%, rgba(8,8,16,.9))" }} />
                  </div>
                )}
                <div style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{game.emoji} {game.title}</div>
                      <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#888", background: "rgba(255,255,255,.07)", borderRadius: 6, padding: "2px 6px" }}>{game.genre}</span>
                        {game.released && <span style={{ fontSize: 10, color: "#555" }}>{game.released.slice(0, 4)}</span>}
                        {game.rating && <span style={{ fontSize: 10, color: "#f59e0b" }}>⭐ {game.rating.toFixed(1)}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                      <button className="b" onClick={() => toggleWishlist(game.id)} style={{ background: inWish ? "rgba(239,68,68,.2)" : "rgba(255,255,255,.07)", borderRadius: 8, padding: "5px 7px", fontSize: 14 }}>{inWish ? "❤️" : "🤍"}</button>
                      <button className="b" onClick={() => toggleAlert(game.id)} style={{ background: hasAlt ? "rgba(6,199,85,.15)" : "rgba(255,255,255,.07)", borderRadius: 8, padding: "5px 7px", fontSize: 14 }}>{hasAlt ? "🔔" : "🔕"}</button>
                    </div>
                  </div>

                  {/* Price */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                    {price > 0 ? (
                      <>
                        <div style={{ fontFamily: "'Black Han Sans',sans-serif", fontSize: 20, color: afford ? "#4ade80" : "#f87171" }}>{fmt(price)}</div>
                        {game.on_sale && <>
                          <div style={{ fontSize: 12, color: "#555", textDecoration: "line-through" }}>{fmt(game.msrp)}</div>
                          <div className="sale" style={{ fontSize: 10, background: "#eab308", color: "#000", borderRadius: 6, padding: "2px 7px", fontWeight: 800 }}>
                            -{Math.round((1 - game.sale_price / game.msrp) * 100)}%
                          </div>
                        </>}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: "#888" }}>ไม่มีราคา (ลองกด 🔄 ใหม่)</div>
                    )}
                    <div style={{ marginLeft: "auto", fontSize: 10, color: "#e4000f", fontWeight: 700, background: "rgba(228,0,15,.1)", borderRadius: 6, padding: "2px 7px" }}>🎮 eShop TH</div>
                  </div>
                  {price > 0 && !afford && <div style={{ fontSize: 11, color: "#f87171", marginTop: 2 }}>เกินงบ {fmt(price - budget)}</div>}

                  {/* Buy */}
                  <a href={`https://www.nintendo.com/th/search/#q=${encodeURIComponent(game.title)}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", marginTop: 10, background: game.on_sale ? "linear-gradient(135deg,#e4000f,#dc2626)" : "rgba(228,0,15,.13)", border: game.on_sale ? "none" : "1px solid rgba(228,0,15,.3)", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 800, color: "#fff", textAlign: "center", boxShadow: game.on_sale ? "0 4px 14px rgba(220,38,38,.3)" : "none" }}>
                    {game.on_sale ? `🛒 ซื้อเลย ${fmt(game.sale_price)} — Nintendo eShop TH →` : `🎮 ดูที่ Nintendo eShop TH →`}
                  </a>

                  {/* AI */}
                  <button className="b" onClick={() => {
                    if (isExp) setExpanded(null);
                    else { setExpanded(game.id); if (!aiAdvice[game.id]) askAI(game); }
                  }} style={{ marginTop: 8, width: "100%", background: "rgba(234,179,8,.08)", borderRadius: 8, padding: "6px 10px", fontSize: 11, color: "#eab308", fontWeight: 700 }}>
                    {isExp ? "▲ ซ่อน" : aiLoading === game.id ? <span className="p">🤖 กำลังวิเคราะห์...</span> : "🤖 AI บอกว่าควรซื้อมั้ย?"}
                  </button>
                  {isExp && aiAdvice[game.id] && (
                    <div style={{ marginTop: 8, background: "rgba(234,179,8,.07)", borderRadius: 10, padding: "9px 11px", border: "1px solid rgba(234,179,8,.2)", fontSize: 12, color: "#fde68a", lineHeight: 1.55 }}>
                      {aiAdvice[game.id]}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Empty */}
          {!loading && !error && filtered.length === 0 && games.length > 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#555" }}>
              <div style={{ fontSize: 40 }}>🔍</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10 }}>ไม่พบเกมที่ตรงกัน</div>
            </div>
          )}

          {/* First load */}
          {!loading && !error && games.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>🎮</div>
              <div style={{ fontFamily: "'Black Han Sans',sans-serif", fontSize: 20, marginBottom: 8 }}>ยินดีต้อนรับสู่ Switch2 TH Deals</div>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 22, lineHeight: 1.7 }}>
                กดปุ่มด้านล่างเพื่อโหลดเกมทั้งหมด<br />
                จาก Nintendo eShop Thailand โดยตรง
              </div>
              <button className="b" onClick={() => load(0, true)} style={{ background: "#dc2626", borderRadius: 14, padding: "14px 32px", fontSize: 15, fontWeight: 800, color: "#fff", boxShadow: "0 6px 20px rgba(220,38,38,.35)" }}>
                🔄 โหลดเกมทั้งหมด
              </button>
            </div>
          )}

          {/* Load More */}
          {!loading && hasMore && (
            <button className="b" onClick={loadMore} disabled={loadingMore} style={{ width: "100%", padding: "13px 0", background: "rgba(255,255,255,.06)", borderRadius: 14, fontSize: 13, fontWeight: 700, color: loadingMore ? "#666" : "#ccc", marginTop: 4 }}>
              {loadingMore ? <span className="p">⏳ กำลังโหลด...</span> : `โหลดเพิ่ม (${games.length}/${total}) →`}
            </button>
          )}
        </div>}

        {/* ═══ WISHLIST ═══════════════════════════════════════ */}
        {tab === "wishlist" && <div className="f">
          {wishlist.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#555" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🤍</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>ยังไม่มีเกมใน Wishlist</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>กดหัวใจที่ดีลเพื่อเพิ่ม</div>
            </div>
          ) : <>
            <div style={{ background: "linear-gradient(135deg,rgba(220,38,38,.12),rgba(234,179,8,.06))", border: "1px solid rgba(220,38,38,.2)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>📊 สรุป Wishlist</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "ราคารวม",        value: fmt(wishTotal),                                               color: "#f87171" },
                  { label: "งบที่มี",         value: fmt(budget),                                                  color: "#4ade80" },
                  { label: "ประหยัด Sale",   value: fmt(wishSave),                                               color: "#eab308" },
                  { label: wishTotal <= budget ? "✅ ในงบ" : "เกินงบ", value: wishTotal <= budget ? "พอดี!" : fmt(wishTotal - budget), color: wishTotal <= budget ? "#4ade80" : "#f87171" },
                ].map((s, i) => (
                  <div key={i} style={{ background: "rgba(0,0,0,.3)", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, color: "#666" }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
            {wishGames.map((game, i) => {
              const price = game.sale_price || game.msrp;
              const afford = price > 0 && price <= budget;
              return (
                <div key={game.id} className="c s" style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${afford ? "rgba(74,222,128,.2)" : "rgba(248,113,113,.2)"}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, animationDelay: `${i * .05}s` }}>
                  <div style={{ fontSize: 24 }}>{game.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{game.title}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: afford ? "#4ade80" : "#f87171" }}>{price > 0 ? fmt(price) : "N/A"}</span>
                      {game.on_sale && <span style={{ fontSize: 10, background: "#eab308", color: "#000", borderRadius: 6, padding: "2px 6px", fontWeight: 800 }}>-{Math.round((1 - game.sale_price / game.msrp) * 100)}%</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <a href={`https://www.nintendo.com/th/search/#q=${encodeURIComponent(game.title)}`} target="_blank" rel="noopener noreferrer"
                      style={{ background: "#e4000f", borderRadius: 10, padding: "8px 12px", fontSize: 11, fontWeight: 800, color: "#fff", textAlign: "center", boxShadow: "0 3px 10px rgba(228,0,15,.3)" }}>ซื้อ →</a>
                    <button className="b" onClick={() => toggleWishlist(game.id)} style={{ background: "rgba(248,113,113,.12)", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: "#f87171" }}>ลบ</button>
                  </div>
                </div>
              );
            })}
          </>}
        </div>}

        {/* ═══ ALERTS ════════════════════════════════════════ */}
        {tab === "alerts" && <div className="f">
          <div style={{ background: lineToken ? "rgba(6,199,85,.07)" : "rgba(255,255,255,.03)", border: `1px solid ${lineToken ? "rgba(6,199,85,.25)" : "rgba(255,255,255,.09)"}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>🟢 LINE Messaging API</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>{lineToken ? "✅ ตั้งค่าแล้ว" : "ยังไม่ได้ตั้ง Token"}</div>
              </div>
              <button className="b" onClick={() => setShowLineModal(true)} style={{ background: "#06c755", borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#fff" }}>{lineToken ? "แก้ไข" : "ตั้งค่า"}</button>
            </div>
            {lineToken && (
              <button className="b" onClick={sendLine} style={{ marginTop: 12, width: "100%", background: "#06c755", borderRadius: 12, padding: "11px", fontSize: 13, fontWeight: 700, color: "#fff" }}>
                {lineSending ? <span className="p">📤 กำลังส่ง...</span> : `📤 ส่งสรุปดีลไป LINE (${lineAlerts.length} เกม)`}
              </button>
            )}
          </div>

          <div style={{ fontSize: 12, color: "#888", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>เลือกเกมที่ต้องการแจ้งเตือน ({games.length} เกม)</div>
          {games.length === 0 && <div style={{ textAlign: "center", padding: "30px", color: "#555", fontSize: 13 }}>โหลดเกมจากหน้า ดีล ก่อนนะ</div>}
          {games.map((game, i) => (
            <div key={game.id} className="s" style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${lineAlerts.includes(game.id) ? "rgba(6,199,85,.25)" : "rgba(255,255,255,.07)"}`, borderRadius: 12, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, animationDelay: `${i * .02}s` }}>
              <div style={{ fontSize: 20 }}>{game.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{game.title}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{game.on_sale ? `🔥 Sale ${fmt(game.sale_price)}` : game.msrp > 0 ? fmt(game.msrp) : "ไม่มีราคา"}</div>
              </div>
              {game.on_sale && <div style={{ fontSize: 10, background: "#eab308", color: "#000", borderRadius: 6, padding: "2px 6px", fontWeight: 800 }}>SALE</div>}
              <button className="b" onClick={() => toggleAlert(game.id)} style={{ background: lineAlerts.includes(game.id) ? "#06c755" : "rgba(255,255,255,.07)", borderRadius: 20, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: lineAlerts.includes(game.id) ? "#fff" : "#888" }}>
                {lineAlerts.includes(game.id) ? "🔔 On" : "🔕 Off"}
              </button>
            </div>
          ))}
        </div>}
      </div>

      {/* ── LINE MODAL ──────────────────────────────────────── */}
      {showLineModal && (
        <div className="mbg" onClick={() => setShowLineModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "flex-end", zIndex: 100, backdropFilter: "blur(4px)" }}>
          <div onClick={e => e.stopPropagation()} className="s" style={{ background: "#11101e", borderRadius: "24px 24px 0 0", padding: "28px 22px 40px", width: "100%", border: "1px solid rgba(255,255,255,.1)" }}>
            <div style={{ fontFamily: "'Black Han Sans',sans-serif", fontSize: 20, marginBottom: 6 }}>🟢 ตั้งค่า LINE Alert</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 18, lineHeight: 1.6 }}>
              วาง Channel Access Token จาก LINE Messaging API<br />
              <a href="https://account.line.biz" target="_blank" style={{ color: "#06c755" }}>account.line.biz</a> → Messaging API → Issue Token
            </div>
            <input value={lineToken} onChange={e => setLineToken(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiJ9..."
              style={{ width: "100%", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#f0f0f8", fontFamily: "inherit", marginBottom: 14 }} />
            <button className="b" onClick={() => { localStorage.setItem("sw2_token", lineToken); setShowLineModal(false); showToast("✅ บันทึก Token แล้ว!", "#4ade80"); }}
              style={{ width: "100%", padding: 14, background: "#06c755", borderRadius: 14, fontSize: 15, fontWeight: 700, color: "#fff" }}>บันทึก</button>
            <div style={{ marginTop: 10, padding: "9px 12px", background: "rgba(234,179,8,.07)", borderRadius: 10, fontSize: 11, color: "#fde68a" }}>🔒 Token เก็บใน localStorage เท่านั้น</div>
          </div>
        </div>
      )}

      {/* ── TOAST ───────────────────────────────────────────── */}
      {toast && (
        <div className="s" style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#13111f", border: `1px solid ${toast.color}55`, borderRadius: 100, padding: "10px 20px", fontSize: 13, fontWeight: 700, color: toast.color, zIndex: 200, whiteSpace: "nowrap", boxShadow: "0 8px 28px rgba(0,0,0,.6)" }}>
          {toast.msg}
        </div>
      )}

      {/* ── BOTTOM NAV ──────────────────────────────────────── */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(8,8,16,.97)", borderTop: "1px solid rgba(255,255,255,.07)", padding: "10px 20px 24px", display: "flex", justifyContent: "space-around", backdropFilter: "blur(12px)", zIndex: 50 }}>
        {[["deals", "🎮", "ดีล"], ["wishlist", "❤️", "Wishlist"], ["alerts", "🔔", "LINE"]].map(([k, ic, l]) => (
          <button key={k} className="b" onClick={() => setTab(k)} style={{ background: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ fontSize: 20 }}>{ic}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: tab === k ? "#dc2626" : "#444" }}>{l}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

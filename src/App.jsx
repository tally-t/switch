import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  API calls — all go through Vercel proxies (keys stay server-side)
// ─────────────────────────────────────────────────────────────────────────────
async function searchGames(q) {
  if (!q || q.length < 2) return [];
  const r = await fetch(`/api/rawg?q=${encodeURIComponent(q)}&platforms=7&page_size=8`);
  if (!r.ok) throw new Error(`Search failed ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return (data.results || []).map(g => ({
    rawgId:  g.id,
    title:   g.name,
    cover:   g.background_image || null,
    released: g.released?.slice(0, 4) || "",
    rating:  g.rating ? g.rating.toFixed(1) : null,
    genres:  (g.genres || []).map(x => x.name).slice(0, 2),
  }));
}

async function fetchRates() {
  const r = await fetch("/api/rates");
  if (!r.ok) throw new Error("rates failed");
  return r.json(); // { base:"THB", rates:{ USD:36.5, JPY:0.245, ... } }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────
const ESHOP_ZONES   = ["TH","JP","US","EU","MX","HK","SG","AU","GB","KR","Other"];
const PHYS_REGIONS  = ["Asia","Japan","US/Canada","Europe","Multi-region","Other"];

// Currency → symbol + ISO code for conversion
const ZONE_CURRENCY = {
  TH:"THB", JP:"JPY", US:"USD", EU:"EUR", MX:"MXN",
  HK:"HKD", SG:"SGD", AU:"AUD", GB:"GBP", KR:"KRW", Other:"USD",
};
const CURRENCY_SYMBOL = {
  THB:"฿", JPY:"¥", USD:"$", EUR:"€", MXN:"MX$",
  HKD:"HK$", SGD:"S$", AUD:"A$", GBP:"£", KRW:"₩",
};
const ALL_CURRENCIES = Object.keys(CURRENCY_SYMBOL);

const ZONE_COLOR = {
  TH:"#dc2626",JP:"#e879f9",US:"#3b82f6",EU:"#10b981",MX:"#f97316",
  HK:"#f59e0b",SG:"#8b5cf6",AU:"#06b6d4",GB:"#ec4899",KR:"#84cc16",Other:"#94a3b8",
};
const TYPE_COLOR = { physical:"#f59e0b", digital:"#60a5fa" };

const ACCOUNT_PRESETS = [
  { name:"บัญชีหลัก TH", tag:"Main TH", color:"#dc2626" },
  { name:"บัญชี JP",      tag:"JP Shop", color:"#e879f9" },
  { name:"บัญชี US",      tag:"US Shop", color:"#3b82f6" },
  { name:"Family",         tag:"Family",  color:"#10b981" },
];

const fmtTHB = (n) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const fmtAmt = (n, sym) => `${sym||"฿"}${Number(n).toLocaleString()}`;
const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

const EMPTY_GAME = {
  title:"", type:"physical", eshopZone:"TH", physRegion:"Asia",
  buyPrice:"", currency:"THB", accountId:"", condition:"new",
  bought:"", rawgId:null, cover:null, genres:[], released:"", rating:null, notes:"",
};

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [accounts,   setAccounts]   = useState(() => LS.get("gvt_accounts_v3") || []);
  const [collection, setCollection] = useState(() => LS.get("gvt_games_v3")    || []);
  const [rates,      setRates]      = useState(null);   // { rates: { USD:36.5, ... } }
  const [ratesAge,   setRatesAge]   = useState(null);
  const [ratesErr,   setRatesErr]   = useState(false);

  const [tab,         setTab]        = useState("collection");
  const [showAddGame, setShowAddGame] = useState(false);
  const [editGame,    setEditGame]    = useState(null);
  const [newGame,     setNewGame]     = useState({ ...EMPTY_GAME });
  const [showAddAcc,  setShowAddAcc]  = useState(false);
  const [newAcc,      setNewAcc]      = useState({ id:"", name:"", tag:"", color:"#6366f1" });

  const [filterAcc,  setFilterAcc]  = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortBy,     setSortBy]     = useState("bought");
  const [toast,      setToast]      = useState(null);

  // RAWG search
  const [searchQ,       setSearchQ]       = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [searchErr,     setSearchErr]     = useState("");
  const debounceRef = useRef(null);

  // Persist
  useEffect(() => { LS.set("gvt_games_v3",    collection); }, [collection]);
  useEffect(() => { LS.set("gvt_accounts_v3", accounts);   }, [accounts]);

  // Load exchange rates on mount
  useEffect(() => {
    fetchRates()
      .then(d => { setRates(d); setRatesAge(d.updated); })
      .catch(() => setRatesErr(true));
  }, []);

  const showToast = (msg, color="#eab308") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2800);
  };

  // ── Currency conversion helper ───────────────────────────────────────────
  // Convert any amount+currency → THB using live rates
  const toTHB = useCallback((amount, iso) => {
    if (!amount) return 0;
    if (iso === "THB" || !iso) return parseFloat(amount);
    if (!rates?.rates) return parseFloat(amount); // fallback: treat as THB
    const rate = rates.rates[iso];
    if (!rate) return parseFloat(amount);
    return parseFloat(amount) * rate;
  }, [rates]);

  // ── RAWG search ──────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true); setSearchErr("");
    try {
      setSearchResults(await searchGames(q));
    } catch (e) {
      setSearchErr(e.message.includes("RAWG_API_KEY") ? "RAWG_API_KEY ยังไม่ได้ตั้งค่าใน Vercel" : "ค้นหาไม่ได้ — ตรวจสอบ Vercel ENV");
      setSearchResults([]);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(searchQ), 500);
    return () => clearTimeout(debounceRef.current);
  }, [searchQ, doSearch]);

  const pickGame = (g) => {
    setNewGame(p => ({ ...p, title:g.title, rawgId:g.rawgId, cover:g.cover, genres:g.genres, released:g.released, rating:g.rating }));
    setSearchQ(g.title); setSearchResults([]);
  };

  // ── Account CRUD ─────────────────────────────────────────────────────────
  const addAccount = () => {
    if (!newAcc.name.trim()) return;
    const acc = { ...newAcc, id: Date.now().toString() };
    setAccounts(p => [...p, acc]);
    setNewAcc({ id:"", name:"", tag:"", color:"#6366f1" });
    setShowAddAcc(false);
    showToast("✅ เพิ่ม Account แล้ว!", "#4ade80");
  };

  const deleteAccount = (id) => {
    setAccounts(p => p.filter(a => a.id !== id));
    setCollection(p => p.map(g => g.accountId === id ? { ...g, accountId:"" } : g));
    showToast("🗑️ ลบ Account แล้ว");
  };

  // ── Game CRUD ────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditGame(null);
    setNewGame({ ...EMPTY_GAME });
    setSearchQ(""); setSearchResults([]);
    setShowAddGame(true);
  };

  const openEdit = (game) => {
    setEditGame(game);
    setNewGame({ ...game, buyPrice: String(game.buyPrice) });
    setSearchQ(game.title); setSearchResults([]);
    setShowAddGame(true);
  };

  const saveGame = () => {
    if (!newGame.title.trim() || !newGame.buyPrice) return;
    const game = { ...newGame, buyPrice: parseFloat(newGame.buyPrice) };
    if (editGame) {
      setCollection(p => p.map(g => g.id === editGame.id ? { ...game, id:editGame.id } : g));
      showToast("✅ แก้ไขแล้ว!", "#4ade80");
    } else {
      setCollection(p => [...p, { ...game, id: Date.now().toString() }]);
      showToast("✅ เพิ่มเกมแล้ว!", "#4ade80");
    }
    setShowAddGame(false); setEditGame(null);
    setNewGame({ ...EMPTY_GAME }); setSearchQ("");
  };

  const deleteGame = (id) => {
    setCollection(p => p.filter(g => g.id !== id));
    showToast("🗑️ ลบเกมแล้ว");
  };

  // ── When zone changes, auto-set currency ─────────────────────────────────
  const handleZoneChange = (zone) => {
    const iso = ZONE_CURRENCY[zone] || "THB";
    setNewGame(p => ({ ...p, eshopZone: zone, currency: iso }));
  };

  // ── Derived data ─────────────────────────────────────────────────────────
  const accOf  = (id) => accounts.find(a => a.id === id);
  const gameTHB = (g)  => toTHB(g.buyPrice, g.currency);

  const filtered = collection
    .filter(g => filterAcc  === "all" || g.accountId === filterAcc)
    .filter(g => filterType === "all" || g.type      === filterType)
    .sort((a, b) => {
      if (sortBy === "title")  return a.title.localeCompare(b.title);
      if (sortBy === "price")  return gameTHB(b) - gameTHB(a);
      return (b.bought || "").localeCompare(a.bought || "");
    });

  const totalTHB = collection.reduce((s, g) => s + gameTHB(g), 0);
  const physTHB  = collection.filter(g=>g.type==="physical").reduce((s,g)=>s+gameTHB(g),0);
  const digTHB   = collection.filter(g=>g.type==="digital" ).reduce((s,g)=>s+gameTHB(g),0);

  // by account
  const byAccount = accounts.map(acc => ({
    ...acc,
    games: collection.filter(g => g.accountId === acc.id),
    thb:   collection.filter(g => g.accountId === acc.id).reduce((s,g)=>s+gameTHB(g),0),
  }));
  const unassigned = collection.filter(g => !g.accountId || !accounts.find(a=>a.id===g.accountId));
  const unassignedTHB = unassigned.reduce((s,g)=>s+gameTHB(g),0);

  // by eShop zone (digital)
  const byZone = ESHOP_ZONES.map(z => {
    const games = collection.filter(g => g.type==="digital" && g.eshopZone===z);
    return { zone:z, games, thb: games.reduce((s,g)=>s+gameTHB(g),0) };
  }).filter(z => z.games.length > 0);

  // by physical region
  const byRegion = PHYS_REGIONS.map(r => {
    const games = collection.filter(g => g.type==="physical" && g.physRegion===r);
    return { region:r, games, thb: games.reduce((s,g)=>s+gameTHB(g),0) };
  }).filter(r => r.games.length > 0);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#07080f", color:"#eef0f8", fontFamily:"'Noto Sans Thai','DM Sans',sans-serif", maxWidth:430, margin:"0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700;800&family=Syne:wght@700;800&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{display:none;}
        .b{transition:all .13s ease;cursor:pointer;font-family:inherit;border:none;}.b:active{transform:scale(.92);}
        .c{transition:transform .14s ease;}.c:active{transform:scale(.97);}
        .s{animation:su .28s cubic-bezier(.34,1.56,.64,1) both;}
        @keyframes su{from{transform:translateY(12px) scale(.97);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
        .f{animation:fi .28s ease;}@keyframes fi{from{opacity:0}to{opacity:1}}
        .p{animation:pu 1.8s infinite;}@keyframes pu{0%,100%{opacity:1}50%{opacity:.3}}
        .shine{background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.06) 50%,transparent 60%);background-size:200% 100%;animation:shine 3s infinite;}
        @keyframes shine{0%{background-position:200% 0}100%{background-position:-200% 0}}
        input,select{outline:none;font-family:inherit;}
        .mbg{animation:fi .18s ease;}
        .bar{transition:width 1s cubic-bezier(.4,0,.2,1);}
      `}</style>

      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{ background:"linear-gradient(160deg,#0e0b1f 0%,#07080f 65%)", padding:"50px 20px 0", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-50, right:-50, width:180, height:180, borderRadius:"50%", background:"radial-gradient(circle,rgba(99,102,241,.15) 0%,transparent 70%)" }}/>

        <div style={{ position:"relative", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:10, letterSpacing:4, color:"#6366f1", fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>🎮 Switch Collection</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:26, fontWeight:800, lineHeight:1.1 }}>Game Value<br/><span style={{ color:"#eab308" }}>Tracker</span></div>
          </div>
          {/* Rates status */}
          <div style={{ textAlign:"right", marginTop:4 }}>
            <div style={{ fontSize:10, color: ratesErr?"#f87171": rates?"#4ade80":"#eab308", background: ratesErr?"rgba(248,113,113,.1)":rates?"rgba(74,222,128,.1)":"rgba(234,179,8,.1)", border:`1px solid ${ratesErr?"rgba(248,113,113,.25)":rates?"rgba(74,222,128,.25)":"rgba(234,179,8,.25)"}`, borderRadius:8, padding:"5px 9px", fontWeight:700 }}>
              {ratesErr ? "⚠️ Rates fallback" : rates ? "💱 Live rates" : <span className="p">⏳ Loading...</span>}
            </div>
            {ratesAge && ratesAge !== "fallback" && <div style={{ fontSize:9, color:"#444", marginTop:3 }}>อัปเดต: {ratesAge?.slice(0,16)}</div>}
          </div>
        </div>

        {/* Portfolio summary card */}
        <div className="shine" style={{ background:"linear-gradient(135deg,rgba(99,102,241,.16),rgba(234,179,8,.07))", border:"1px solid rgba(99,102,241,.25)", borderRadius:18, padding:"16px 18px", margin:"16px 0 0", overflow:"hidden", position:"relative" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:10, color:"#666", marginBottom:3 }}>มูลค่า Collection รวม (THB)</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontSize:30, fontWeight:800 }}>{fmtTHB(totalTHB)}</div>
              <div style={{ fontSize:11, color:"#555", marginTop:4 }}>{collection.length} เกม · {accounts.length} บัญชี</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div style={{ background:"rgba(245,158,11,.1)", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"#f59e0b" }}>{collection.filter(g=>g.type==="physical").length}</div>
                <div style={{ fontSize:9, color:"#666", marginTop:1 }}>Physical</div>
                <div style={{ fontSize:10, color:"#f59e0b", marginTop:1 }}>{fmtTHB(physTHB)}</div>
              </div>
              <div style={{ background:"rgba(96,165,250,.1)", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"#60a5fa" }}>{collection.filter(g=>g.type==="digital").length}</div>
                <div style={{ fontSize:9, color:"#666", marginTop:1 }}>Digital</div>
                <div style={{ fontSize:10, color:"#60a5fa", marginTop:1 }}>{fmtTHB(digTHB)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:4, marginTop:14 }}>
          {[["collection","📦 Collection"],["summary","📊 Summary"],["accounts","👤 Accounts"]].map(([k,l]) => (
            <button key={k} className="b" onClick={() => setTab(k)} style={{ flex:1, padding:"10px 4px", borderRadius:"12px 12px 0 0", fontSize:11, fontWeight:700, background:tab===k?"#07080f":"rgba(255,255,255,.04)", color:tab===k?"#eab308":"#555", border:tab===k?"1px solid rgba(99,102,241,.2)":"1px solid transparent", borderBottom:"none" }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── CONTENT ─────────────────────────────────────────── */}
      <div style={{ padding:"16px 20px 100px", borderTop:"1px solid rgba(99,102,241,.15)" }}>

        {/* ════ COLLECTION ════════════════════════════════════ */}
        {tab==="collection" && <div className="f">

          {/* Filter chips */}
          <div style={{ display:"flex", gap:5, marginBottom:10, overflowX:"auto", paddingBottom:2 }}>
            {[["all","All"],["physical","📦"],["digital","💾"]].map(([k,l]) => (
              <button key={k} className="b" onClick={() => setFilterType(k)} style={{ flexShrink:0, padding:"6px 12px", borderRadius:20, fontSize:11, fontWeight:700, background:filterType===k?"#6366f1":"rgba(255,255,255,.06)", color:filterType===k?"#fff":"#666" }}>{l}</button>
            ))}
            <div style={{ width:1, background:"rgba(255,255,255,.08)", flexShrink:0, margin:"0 2px" }}/>
            <button className="b" onClick={()=>setFilterAcc("all")} style={{ flexShrink:0, padding:"6px 12px", borderRadius:20, fontSize:11, fontWeight:700, background:filterAcc==="all"?"rgba(255,255,255,.15)":"rgba(255,255,255,.06)", color:filterAcc==="all"?"#fff":"#666" }}>All</button>
            {accounts.map(a => (
              <button key={a.id} className="b" onClick={()=>setFilterAcc(a.id)} style={{ flexShrink:0, padding:"6px 12px", borderRadius:20, fontSize:11, fontWeight:700, background:filterAcc===a.id?a.color:"rgba(255,255,255,.06)", color:filterAcc===a.id?"#fff":"#888" }}>{a.tag||a.name}</button>
            ))}
          </div>

          {/* Sort + Add */}
          <div style={{ display:"flex", gap:8, marginBottom:14 }}>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ flex:1, background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:10, padding:"8px 10px", fontSize:11, color:"#aaa" }}>
              <option value="bought">ซื้อล่าสุด</option>
              <option value="title">ชื่อ A-Z</option>
              <option value="price">ราคาสูงสุด (THB)</option>
            </select>
            <button className="b" onClick={openAdd} style={{ background:"#6366f1", borderRadius:10, padding:"8px 18px", fontSize:12, fontWeight:700, color:"#fff", boxShadow:"0 4px 14px rgba(99,102,241,.4)", flexShrink:0 }}>+ เพิ่มเกม</button>
          </div>

          {/* Empty */}
          {filtered.length === 0 && (
            <div style={{ textAlign:"center", padding:"50px 20px", color:"#555" }}>
              <div style={{ fontSize:44, marginBottom:12 }}>📦</div>
              <div style={{ fontSize:15, fontWeight:700 }}>{collection.length===0?"ยังไม่มีเกม":"ไม่พบเกมที่ตรงกัน"}</div>
              <div style={{ fontSize:12, marginTop:6 }}>กด + เพิ่มเกม เพื่อเริ่ม track</div>
            </div>
          )}

          {/* Game cards */}
          {filtered.map((game, i) => {
            const acc   = accOf(game.accountId);
            const sym   = CURRENCY_SYMBOL[game.currency] || "฿";
            const thb   = gameTHB(game);
            const isForeign = game.currency !== "THB";
            return (
              <div key={game.id} className="c s" style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:16, marginBottom:10, overflow:"hidden", animationDelay:`${Math.min(i,.12)*0.05}s` }}>
                {game.cover && (
                  <div style={{ height:68, overflow:"hidden", position:"relative" }}>
                    <img src={game.cover} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", opacity:.5 }} onError={e=>e.target.style.display="none"}/>
                    <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom,transparent 20%,rgba(7,8,15,.95))" }}/>
                  </div>
                )}
                <div style={{ padding:"12px 14px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, lineHeight:1.25, marginBottom:5 }}>{game.title}</div>
                      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                        <span style={{ fontSize:10, fontWeight:700, color:TYPE_COLOR[game.type], background:`${TYPE_COLOR[game.type]}18`, borderRadius:6, padding:"2px 7px" }}>
                          {game.type==="physical"?"📦 Physical":"💾 Digital"}
                        </span>
                        <span style={{ fontSize:10, fontWeight:700, color:ZONE_COLOR[game.type==="digital"?game.eshopZone:"Other"]||"#94a3b8", background:"rgba(255,255,255,.06)", borderRadius:6, padding:"2px 7px" }}>
                          🌏 {game.type==="digital"?game.eshopZone:game.physRegion}
                        </span>
                        {acc && <span style={{ fontSize:10, fontWeight:700, color:acc.color, background:`${acc.color}18`, borderRadius:6, padding:"2px 7px" }}>👤 {acc.tag||acc.name}</span>}
                        {game.genres?.[0] && <span style={{ fontSize:10, color:"#555" }}>{game.genres[0]}</span>}
                      </div>
                    </div>
                    {/* Price — show original + THB if foreign */}
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:16, fontWeight:500, color:"#eef0f8" }}>
                        {fmtAmt(game.buyPrice, sym)}
                      </div>
                      {isForeign && (
                        <div style={{ fontSize:11, color:"#6366f1", marginTop:2, fontFamily:"'DM Mono',monospace" }}>
                          ≈ {fmtTHB(thb)}
                        </div>
                      )}
                      {game.bought && <div style={{ fontSize:10, color:"#555", marginTop:2 }}>{game.bought}</div>}
                    </div>
                  </div>
                  {game.notes && <div style={{ fontSize:11, color:"#666", marginTop:7, fontStyle:"italic" }}>"{game.notes}"</div>}
                  <div style={{ display:"flex", gap:6, marginTop:10 }}>
                    <button className="b" onClick={() => openEdit(game)} style={{ flex:1, background:"rgba(99,102,241,.1)", borderRadius:8, padding:"7px 0", fontSize:11, fontWeight:700, color:"#a5b4fc" }}>✏️ แก้ไข</button>
                    <button className="b" onClick={() => deleteGame(game.id)} style={{ flex:1, background:"rgba(248,113,113,.08)", borderRadius:8, padding:"7px 0", fontSize:11, fontWeight:700, color:"#f87171" }}>🗑️ ลบ</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>}

        {/* ════ SUMMARY ════════════════════════════════════════ */}
        {tab==="summary" && <div className="f">

          {/* Conversion notice */}
          {!ratesErr && (
            <div style={{ background:"rgba(99,102,241,.08)", border:"1px solid rgba(99,102,241,.2)", borderRadius:12, padding:"9px 12px", marginBottom:14, fontSize:11, color:"#a5b4fc" }}>
              💱 ราคาทุกสกุลเงินแปลงเป็น THB แล้ว — {rates ? "อัตราแลกเปลี่ยนสด" : "อัตราโดยประมาณ"}
            </div>
          )}
          {ratesErr && (
            <div style={{ background:"rgba(234,179,8,.07)", border:"1px solid rgba(234,179,8,.2)", borderRadius:12, padding:"9px 12px", marginBottom:14, fontSize:11, color:"#fde68a" }}>
              ⚠️ ใช้อัตราแลกเปลี่ยนโดยประมาณ (ไม่มีอินเทอร์เน็ต)
            </div>
          )}

          {/* Total */}
          <div style={{ background:"linear-gradient(135deg,rgba(99,102,241,.14),rgba(234,179,8,.06))", border:"1px solid rgba(99,102,241,.22)", borderRadius:18, padding:18, marginBottom:16 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:800, color:"#a5b4fc", marginBottom:12, letterSpacing:1, textTransform:"uppercase" }}>💰 รวมทั้งหมด (THB)</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                { label:"ราคารวม",    value:fmtTHB(totalTHB),  color:"#eef0f8" },
                { label:"จำนวนเกม",  value:`${collection.length} เกม`, color:"#a5b4fc" },
                { label:"📦 Physical", value:fmtTHB(physTHB),  color:"#f59e0b" },
                { label:"💾 Digital",  value:fmtTHB(digTHB),   color:"#60a5fa" },
              ].map((s,i) => (
                <div key={i} style={{ background:"rgba(0,0,0,.3)", borderRadius:12, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:"#555", marginBottom:3 }}>{s.label}</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:500, color:s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* By Account */}
          {byAccount.some(a=>a.games.length>0) && (
            <>
              <SectionTitle>👤 แยกตาม Account</SectionTitle>
              {byAccount.filter(a=>a.games.length>0).map((acc,i)=>(
                <SummaryRow key={acc.id} i={i} color={acc.color} label={acc.name} tag={acc.tag} count={acc.games.length} thb={acc.thb} total={totalTHB}/>
              ))}
              {unassigned.length>0 && (
                <SummaryRow color="#444" label="ไม่ได้กำหนด" count={unassigned.length} thb={unassignedTHB} total={totalTHB}/>
              )}
            </>
          )}

          {/* By eShop Zone */}
          {byZone.length>0 && (
            <>
              <SectionTitle style={{ marginTop:16 }}>🌏 แยกตาม eShop Zone (Digital)</SectionTitle>
              {byZone.map((z,i)=>(
                <SummaryRow key={z.zone} i={i} color={ZONE_COLOR[z.zone]||"#94a3b8"} label={`eShop ${z.zone}`} count={z.games.length} thb={z.thb} total={digTHB||1}
                  extra={z.games.map(g=>`${CURRENCY_SYMBOL[g.currency]||"?"}${g.buyPrice}`).slice(0,3).join(" · ")}/>
              ))}
            </>
          )}

          {/* By Physical Region */}
          {byRegion.length>0 && (
            <>
              <SectionTitle style={{ marginTop:16 }}>📀 แยกตาม Physical Region</SectionTitle>
              {byRegion.map((r,i)=>(
                <SummaryRow key={r.region} i={i} color="#f59e0b" label={r.region} count={r.games.length} thb={r.thb} total={physTHB||1}/>
              ))}
            </>
          )}

          {/* Conversion reference */}
          {rates && (
            <div style={{ marginTop:20, background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", borderRadius:14, padding:14 }}>
              <div style={{ fontSize:11, color:"#666", fontWeight:700, marginBottom:10, letterSpacing:1, textTransform:"uppercase" }}>อัตราแลกเปลี่ยนที่ใช้</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
                {["JPY","USD","EUR","MXN","HKD","SGD","AUD","GBP","KRW"].map(iso => (
                  <div key={iso} style={{ background:"rgba(255,255,255,.04)", borderRadius:8, padding:"6px 8px", textAlign:"center" }}>
                    <div style={{ fontSize:10, color:"#666" }}>1 {iso}</div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#a5b4fc", marginTop:2 }}>
                      ≈ ฿{(rates.rates[iso]||0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {collection.length===0 && (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#555" }}>
              <div style={{ fontSize:40, marginBottom:10 }}>📊</div>
              <div style={{ fontSize:14, fontWeight:700 }}>ยังไม่มีข้อมูล</div>
            </div>
          )}
        </div>}

        {/* ════ ACCOUNTS ════════════════════════════════════════ */}
        {tab==="accounts" && <div className="f">
          <button className="b" onClick={()=>{setNewAcc({id:"",name:"",tag:"",color:"#6366f1"});setShowAddAcc(true);}} style={{ width:"100%", background:"#6366f1", borderRadius:12, padding:"12px 0", fontSize:13, fontWeight:700, color:"#fff", marginBottom:16, boxShadow:"0 4px 14px rgba(99,102,241,.4)" }}>+ สร้าง Account ใหม่</button>

          <div style={{ fontSize:11, color:"#666", fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>Quick Add</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
            {ACCOUNT_PRESETS.map((p,i) => (
              <button key={i} className="b" onClick={() => {
                if (accounts.find(a=>a.name===p.name)) return showToast("มีแล้ว!");
                setAccounts(prev=>[...prev,{id:Date.now().toString(),...p}]);
                showToast(`✅ เพิ่ม ${p.name}!`,"#4ade80");
              }} style={{ background:`${p.color}14`, border:`1px solid ${p.color}33`, borderRadius:12, padding:"10px 8px", fontSize:11, fontWeight:700, color:p.color }}>
                + {p.name}
              </button>
            ))}
          </div>

          <div style={{ fontSize:11, color:"#666", fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>Accounts ({accounts.length})</div>
          {accounts.length===0 && (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#555" }}>
              <div style={{ fontSize:40, marginBottom:10 }}>👤</div>
              <div style={{ fontSize:14, fontWeight:700 }}>ยังไม่มี Account</div>
            </div>
          )}
          {accounts.map((acc, i) => {
            const gCount = collection.filter(g=>g.accountId===acc.id).length;
            const thb    = collection.filter(g=>g.accountId===acc.id).reduce((s,g)=>s+gameTHB(g),0);
            return (
              <div key={acc.id} className="s" style={{ background:"rgba(255,255,255,.04)", border:`1px solid ${acc.color}33`, borderRadius:14, padding:"14px 16px", marginBottom:10, animationDelay:`${i*.05}s` }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:42, height:42, borderRadius:12, background:`${acc.color}22`, border:`2px solid ${acc.color}44`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:18 }}>👤</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:700 }}>{acc.name}</div>
                    <div style={{ display:"flex", gap:6, marginTop:3, alignItems:"center" }}>
                      {acc.tag && <span style={{ fontSize:10, color:acc.color, background:`${acc.color}18`, borderRadius:6, padding:"1px 6px", fontWeight:700 }}>{acc.tag}</span>}
                      <span style={{ fontSize:10, color:"#555" }}>{gCount} เกม · {fmtTHB(thb)}</span>
                    </div>
                  </div>
                  <button className="b" onClick={()=>deleteAccount(acc.id)} style={{ background:"rgba(248,113,113,.1)", borderRadius:8, padding:"6px 10px", fontSize:12, color:"#f87171" }}>🗑️</button>
                </div>
              </div>
            );
          })}
        </div>}
      </div>

      {/* ── ADD/EDIT GAME MODAL ──────────────────────────────── */}
      {showAddGame && (
        <div className="mbg" onClick={()=>{setShowAddGame(false);setEditGame(null);}} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", display:"flex", alignItems:"flex-end", zIndex:100, backdropFilter:"blur(6px)" }}>
          <div onClick={e=>e.stopPropagation()} className="s" style={{ background:"#0d0b1a", borderRadius:"24px 24px 0 0", padding:"22px 20px 36px", width:"100%", border:"1px solid rgba(99,102,241,.2)", maxHeight:"92vh", overflowY:"auto" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, marginBottom:16 }}>{editGame?"✏️ แก้ไขเกม":"🎮 เพิ่มเกมใหม่"}</div>

            {/* RAWG search */}
            <Label>ค้นหาเกม (ดึงจาก Nintendo Switch database)</Label>
            <div style={{ position:"relative", marginBottom: searchResults.length>0?0:12 }}>
              <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setNewGame(p=>({...p,title:e.target.value}));}}
                placeholder="พิมพ์ชื่อเกม เช่น Mario, Zelda..."
                style={{ width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:12, padding:"11px 40px 11px 14px", fontSize:13, color:"#eef0f8" }}/>
              {searching && <div className="p" style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"#666" }}>🔍</div>}
            </div>
            {searchErr && <div style={{ fontSize:11, color:"#f87171", marginBottom:8 }}>{searchErr}</div>}
            {searchResults.length>0 && (
              <div style={{ background:"#13111f", border:"1px solid rgba(99,102,241,.25)", borderRadius:12, marginBottom:12, overflow:"hidden", maxHeight:220, overflowY:"auto" }}>
                {searchResults.map(g=>(
                  <div key={g.rawgId} className="b" onClick={()=>pickGame(g)} style={{ display:"flex", gap:10, padding:"9px 12px", borderBottom:"1px solid rgba(255,255,255,.05)", alignItems:"center" }}>
                    {g.cover && <img src={g.cover} alt="" style={{ width:40, height:28, objectFit:"cover", borderRadius:6, flexShrink:0 }}/>}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g.title}</div>
                      <div style={{ fontSize:10, color:"#666", marginTop:2 }}>{g.released} · {g.genres?.join(", ")}</div>
                    </div>
                    {g.rating && <div style={{ fontSize:10, color:"#f59e0b", flexShrink:0 }}>⭐{g.rating}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Type */}
            <Label>ประเภท</Label>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {[["physical","📦 Physical"],["digital","💾 Digital"]].map(([k,l])=>(
                <button key={k} className="b" onClick={()=>setNewGame(p=>({...p,type:k}))} style={{ flex:1, padding:"10px 0", borderRadius:10, fontSize:12, fontWeight:700, background:newGame.type===k?TYPE_COLOR[k]:"rgba(255,255,255,.06)", color:newGame.type===k?"#fff":"#888" }}>{l}</button>
              ))}
            </div>

            {/* Zone */}
            {newGame.type==="digital" && (
              <>
                <Label>🌏 eShop Zone → auto-set สกุลเงิน</Label>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12 }}>
                  {ESHOP_ZONES.map(z=>(
                    <button key={z} className="b" onClick={()=>handleZoneChange(z)} style={{ padding:"6px 11px", borderRadius:20, fontSize:11, fontWeight:700, background:newGame.eshopZone===z?(ZONE_COLOR[z]||"#94a3b8"):"rgba(255,255,255,.06)", color:newGame.eshopZone===z?"#fff":"#888" }}>{z}</button>
                  ))}
                </div>
              </>
            )}
            {newGame.type==="physical" && (
              <>
                <Label>📀 Physical Region</Label>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12 }}>
                  {PHYS_REGIONS.map(r=>(
                    <button key={r} className="b" onClick={()=>setNewGame(p=>({...p,physRegion:r}))} style={{ padding:"6px 10px", borderRadius:20, fontSize:10, fontWeight:700, background:newGame.physRegion===r?"#f59e0b":"rgba(255,255,255,.06)", color:newGame.physRegion===r?"#000":"#888" }}>{r}</button>
                  ))}
                </div>
              </>
            )}

            {/* Price + Currency */}
            <Label>ราคาที่ซื้อ</Label>
            <div style={{ display:"grid", gridTemplateColumns:"90px 1fr", gap:8, marginBottom: rates&&newGame.currency!=="THB"?4:12 }}>
              <select value={newGame.currency} onChange={e=>setNewGame(p=>({...p,currency:e.target.value}))} style={{ background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"10px 8px", fontSize:13, color:"#eef0f8" }}>
                {ALL_CURRENCIES.map(c=><option key={c}>{c}</option>)}
              </select>
              <input type="number" value={newGame.buyPrice} onChange={e=>setNewGame(p=>({...p,buyPrice:e.target.value}))} placeholder="เช่น 1990, 50, 3000"
                style={{ background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"10px 12px", fontSize:13, color:"#eef0f8" }}/>
            </div>
            {/* Live conversion preview */}
            {rates && newGame.buyPrice && newGame.currency && newGame.currency!=="THB" && (
              <div style={{ fontSize:11, color:"#6366f1", marginBottom:12, padding:"6px 10px", background:"rgba(99,102,241,.08)", borderRadius:8 }}>
                💱 {CURRENCY_SYMBOL[newGame.currency]||""}{newGame.buyPrice} {newGame.currency} ≈ {fmtTHB(toTHB(newGame.buyPrice, newGame.currency))} THB
              </div>
            )}

            {/* Account */}
            <Label>👤 Account ที่ซื้อ (optional)</Label>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12 }}>
              <button className="b" onClick={()=>setNewGame(p=>({...p,accountId:""}))} style={{ padding:"6px 12px", borderRadius:20, fontSize:11, fontWeight:700, background:!newGame.accountId?"rgba(255,255,255,.15)":"rgba(255,255,255,.06)", color:!newGame.accountId?"#fff":"#666" }}>ไม่ระบุ</button>
              {accounts.map(a=>(
                <button key={a.id} className="b" onClick={()=>setNewGame(p=>({...p,accountId:a.id}))} style={{ padding:"6px 12px", borderRadius:20, fontSize:11, fontWeight:700, background:newGame.accountId===a.id?a.color:"rgba(255,255,255,.06)", color:newGame.accountId===a.id?"#fff":"#888" }}>{a.tag||a.name}</button>
              ))}
              {accounts.length===0 && <div style={{ fontSize:11, color:"#555", padding:"6px 0" }}>ไปสร้าง Account ก่อนใน tab Accounts</div>}
            </div>

            {/* Condition + Date */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              {newGame.type==="physical" && (
                <div>
                  <Label>สภาพ</Label>
                  <select value={newGame.condition} onChange={e=>setNewGame(p=>({...p,condition:e.target.value}))} style={{ width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"10px 8px", fontSize:12, color:"#eef0f8" }}>
                    <option value="new">ใหม่มือ 1</option>
                    <option value="good">มือสอง - ดี</option>
                    <option value="fair">มือสอง - พอใช้</option>
                  </select>
                </div>
              )}
              <div>
                <Label>วันที่ซื้อ</Label>
                <input type="month" value={newGame.bought} onChange={e=>setNewGame(p=>({...p,bought:e.target.value}))}
                  style={{ width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"10px 8px", fontSize:12, color:"#eef0f8" }}/>
              </div>
            </div>

            {/* Notes */}
            <Label>หมายเหตุ (optional)</Label>
            <input value={newGame.notes} onChange={e=>setNewGame(p=>({...p,notes:e.target.value}))} placeholder="เช่น ซื้อตอน sale, ได้มาจากเพื่อน..."
              style={{ width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"10px 12px", fontSize:12, color:"#eef0f8", marginBottom:18 }}/>

            <button className="b" onClick={saveGame} disabled={!newGame.title||!newGame.buyPrice} style={{ width:"100%", padding:14, background:newGame.title&&newGame.buyPrice?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,.06)", borderRadius:14, fontSize:15, fontWeight:700, color:newGame.title&&newGame.buyPrice?"#fff":"#444", boxShadow:newGame.title&&newGame.buyPrice?"0 6px 20px rgba(99,102,241,.35)":"none" }}>
              {editGame?"💾 บันทึก":"✅ เพิ่มเกม"}
            </button>
          </div>
        </div>
      )}

      {/* ── ADD ACCOUNT MODAL ───────────────────────────────── */}
      {showAddAcc && (
        <div className="mbg" onClick={()=>setShowAddAcc(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", display:"flex", alignItems:"flex-end", zIndex:100, backdropFilter:"blur(6px)" }}>
          <div onClick={e=>e.stopPropagation()} className="s" style={{ background:"#0d0b1a", borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", border:"1px solid rgba(99,102,241,.2)" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, marginBottom:18 }}>👤 สร้าง Account</div>
            {[{label:"ชื่อ Account",key:"name",placeholder:"เช่น บัญชีหลัก TH"},{label:"Tag (optional)",key:"tag",placeholder:"เช่น Main, JP"}].map(f=>(
              <div key={f.key} style={{ marginBottom:12 }}>
                <Label>{f.label}</Label>
                <input value={newAcc[f.key]||""} onChange={e=>setNewAcc(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder}
                  style={{ width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"11px 12px", fontSize:13, color:"#eef0f8" }}/>
              </div>
            ))}
            <Label>สี</Label>
            <div style={{ display:"flex", gap:8, marginBottom:18 }}>
              {["#6366f1","#dc2626","#e879f9","#3b82f6","#10b981","#f59e0b","#f97316","#ec4899"].map(c=>(
                <button key={c} className="b" onClick={()=>setNewAcc(p=>({...p,color:c}))} style={{ width:28, height:28, borderRadius:"50%", background:c, border:newAcc.color===c?"3px solid #fff":"3px solid transparent" }}/>
              ))}
            </div>
            <button className="b" onClick={addAccount} disabled={!newAcc.name} style={{ width:"100%", padding:14, background:newAcc.name?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,.06)", borderRadius:14, fontSize:15, fontWeight:700, color:newAcc.name?"#fff":"#444" }}>✅ สร้าง Account</button>
          </div>
        </div>
      )}

      {/* ── TOAST ───────────────────────────────────────────── */}
      {toast && (
        <div className="s" style={{ position:"fixed", bottom:90, left:"50%", transform:"translateX(-50%)", background:"#0d0b1a", border:`1px solid ${toast.color}44`, borderRadius:100, padding:"10px 20px", fontSize:13, fontWeight:700, color:toast.color, zIndex:300, whiteSpace:"nowrap", boxShadow:"0 8px 28px rgba(0,0,0,.7)" }}>
          {toast.msg}
        </div>
      )}

      {/* ── BOTTOM NAV ──────────────────────────────────────── */}
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background:"rgba(7,8,15,.97)", borderTop:"1px solid rgba(99,102,241,.12)", padding:"10px 20px 24px", display:"flex", justifyContent:"space-around", backdropFilter:"blur(14px)", zIndex:50 }}>
        {[["collection","📦","Collection"],["summary","📊","Summary"],["accounts","👤","Accounts"]].map(([k,ic,l])=>(
          <button key={k} className="b" onClick={()=>setTab(k)} style={{ background:"none", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
            <div style={{ fontSize:20 }}>{ic}</div>
            <div style={{ fontSize:10, fontWeight:700, color:tab===k?"#eab308":"#444" }}>{l}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Small reusable components ──────────────────────────────────────────────
function Label({ children }) {
  return <div style={{ fontSize:11, color:"#888", fontWeight:700, marginBottom:6 }}>{children}</div>;
}

function SectionTitle({ children, style }) {
  return <div style={{ fontSize:11, color:"#666", fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:10, ...style }}>{children}</div>;
}

function SummaryRow({ color, label, tag, count, thb, total, extra, i=0 }) {
  const pct = total ? Math.min(100, (thb/total)*100) : 0;
  return (
    <div className="s" style={{ background:"rgba(255,255,255,.04)", border:`1px solid ${color}28`, borderRadius:14, padding:"12px 14px", marginBottom:8, animationDelay:`${i*.04}s` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:10, height:10, borderRadius:"50%", background:color, flexShrink:0 }}/>
          <div style={{ fontSize:13, fontWeight:700 }}>{label}</div>
          {tag && <div style={{ fontSize:10, color, background:`${color}18`, borderRadius:6, padding:"1px 6px", fontWeight:700 }}>{tag}</div>}
        </div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:14, color }}>{Math.round(thb).toLocaleString("th-TH")} ฿</div>
      </div>
      <div style={{ background:"rgba(255,255,255,.05)", borderRadius:100, height:4, marginBottom:5 }}>
        <div className="bar" style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:100 }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between" }}>
        <div style={{ fontSize:11, color:"#555" }}>{count} เกม · {Math.round(pct)}%</div>
        {extra && <div style={{ fontSize:10, color:"#555" }}>{extra}</div>}
      </div>
    </div>
  );
}

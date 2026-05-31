# 🎮 Switch2 Game Value Tracker

Track your Nintendo Switch game collection — physical & digital, multi-currency, multi-account.

## 🚀 Deploy (5 min)

### 1. Get free RAWG API key
- Go to **rawg.io/apidocs** → Sign Up (free) → copy key

### 2. Deploy to Vercel
```bash
# Option A: drag this folder to vercel.com/new
# Option B: CLI
npm install -g vercel
npm install
vercel --prod
```

### 3. Add environment variable
Vercel Dashboard → Settings → Environment Variables:
```
RAWG_API_KEY = your_key_here
```
Then redeploy (or push any commit).

## 📁 Files

```
tracker-clean/
├── api/
│   ├── rawg.js     ← RAWG game search proxy (key stays server-side)
│   └── rates.js    ← Live exchange rates (open.er-api.com, free, no key)
├── src/
│   ├── main.jsx
│   └── App.jsx     ← Main app
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

## ⚡ APIs (all free)

| API | Purpose | Key? |
|-----|---------|------|
| rawg.io | Game search + cover art | Yes → Vercel env var |
| open.er-api.com | Live exchange rates | No |

## Features
- 🎮 Search games via RAWG (500k+ games, cover art auto-loaded)
- 👤 Multiple Nintendo accounts
- 🌏 eShop zone + physical region tracking
- 💱 Auto currency conversion to THB (live rates)
- 📊 Summary by account / zone / region
- 💾 localStorage — no backend needed

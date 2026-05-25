# 🎮 Switch2 TH Deals — Nintendo eShop Thailand

ติดตามดีลเกม Nintendo Switch 2 Thailand eShop ราคาสด แจ้งเตือน LINE

## 🚀 Deploy บน Vercel (ฟรี 100%)

### ขั้นตอนที่ 1 — สมัคร Vercel
1. ไปที่ **vercel.com** → Sign up ด้วย GitHub (ฟรี)

### ขั้นตอนที่ 2 — อัปโหลดโปรเจค
**Option A: GitHub (แนะนำ)**
1. สร้าง repo ใหม่บน github.com
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้
3. ไปที่ Vercel → "Add New Project" → เลือก repo
4. กด Deploy → เสร็จแล้ว! ✅

**Option B: Vercel CLI**
```bash
npm install -g vercel
cd switch2-vercel
npm install
vercel --prod
```

### ขั้นตอนที่ 3 — ได้ URL แล้ว!
Vercel จะให้ URL เช่น `https://switch2-th-deals.vercel.app`
เปิดบนมือถือ → กด "โหลดเกมทั้งหมด" → เห็นเกมจาก Nintendo TH จริงๆ ทันที

---

## 📁 โครงสร้างไฟล์

```
switch2-vercel/
├── api/
│   └── eshop.js          ← Vercel proxy (bypass CORS)
├── src/
│   ├── main.jsx          ← React entry
│   └── App.jsx           ← Main app
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

---

## ⚡ API ที่ใช้

| Endpoint | ข้อมูลที่ได้ |
|----------|------------|
| `ec.nintendo.com/api/TH/en/search/sales` | เกม on sale ตอนนี้ |
| `ec.nintendo.com/api/TH/en/search/new_arrivals` | เกมใหม่ |
| `ec.nintendo.com/api/TH/en/search/ranking` | เกม ranking |
| `api.ec.nintendo.com/v1/price?country=TH` | ราคา + ส่วนลด |

ทั้งหมด **ฟรี ไม่ต้องมี API key**

---

## 🔔 ตั้งค่า LINE Alert

1. ไปที่ [account.line.biz](https://account.line.biz) → สมัคร LINE Official Account (ฟรี)
2. ไปที่ Messaging API → สร้าง Channel
3. กด "Issue" เพื่อสร้าง Channel Access Token
4. Copy Token → วางในแอป → กด "ส่งสรุปดีล LINE"

**ฟรี 500 messages/เดือน** — เพียงพอสำหรับ personal use

---

## 💰 สร้างรายได้

- เพิ่ม Shopee/Lazada affiliate links ในปุ่ม "ซื้อเลย"
- เพิ่ม Google AdSense สำหรับ banner ads
- สมัคร affiliate ที่ involve.asia

---

## 🛠 Development

```bash
npm install
vercel dev    # รัน local พร้อม proxy
```

เปิด http://localhost:3000

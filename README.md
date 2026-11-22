# T! — Strength & Coaching Operating System

Offline-first strength tracking, algorithmic progression, and client coaching PWA built for personal trainers managing ~30+ clients directly from an iPhone (or desktop/laptop).

## Core Capabilities
- **Local-First Sub-Second Logging (`IndexedDB` / Dexie):** Zero spinners in dead-zone basement gyms, offline Service Worker shell, and optional €0 Cloudflare D1 bidirectional delta sync.
- **Coach Multi-Client Architecture:** 1-tap Client Switcher (30+ clients + Personal Profile), **Parallel Semi-Private Active Sessions** (run multiple clients simultaneously with independent rest timers), sticky per-client equipment setup notes, active injury/contraindication flags, and 3-second pre-session readiness taps.
- **4 Algorithmic Progression Engines:**
  - **Mode A:** Deterministic Double Progression
  - **Mode B:** Percentage & Training Max (5/3/1) with AMRAP Auto-Scaling
  - **Mode C:** GZCLP Linear Failure-Cascade (`5×3 → 6×2 → 10×1 → 85% reset`)
  - **Mode D:** Intra-Session RPE/RIR Autoregulation (`±3.5% / RPE`) & Scheduled Deloads (`60%`)
- **Biomechanical Analytics & 2× PNG Progress Export:** Hybrid Brzycki/Empirical e1RM, DOTS + IPF Age Composite Strength Score (0–100), 5-Axis Balance Radar, Interactive Anterior/Posterior SVG Muscle Heatmap (Raw Fractional & RPE-Weighted Effective Sets), Greedy IPF Barbell Plate Solver + Warm-Up Ramp, 14-point Body Measurements with Before/After Photo Overlay Slider, and **1-Tap Shareable Client Progress PNG Card**.
- **End-of-Day Sync File Backup & Universal Portability:** One-tap `.tfit.json` snapshot export/import (Smart Merge or Full Restore) plus Strong / Hevy / Jefit CSV import and lossless CSV export.

## Local Development (Windows / macOS / Linux)
```bash
npm install
npm run dev
```

## Production Build & Tests
```bash
npm test       # Run Vitest unit tests
npm run build  # Type-check & emit dist/ with offline precached sw.js
```

## €0 Deployment (Cloudflare Pages + Cloudflare D1)
1. Push this repo to GitHub (`EKOKIBO/t-fitness-tracker`).
2. In Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**, select `EKOKIBO/t-fitness-tracker`:
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Create a free **D1 SQLite database** named `t-fitness-db` under **Storage & Databases → D1 SQL Database**.
4. In your Pages project → **Settings → Bindings → Add → D1 database**:
   - Variable name: `DB`
   - D1 database: `t-fitness-db`
5. In **Settings → Environment variables**, add an encrypted secret:
   - Variable name: `COACH_SYNC_KEY`
   - Value: any strong private passphrase (e.g. `my-gym-sync-2026!`)
6. Trigger a redeploy in Cloudflare Pages.
7. Open your `*.pages.dev` URL in Safari on the coach's iPhone 16 → **Share → Add to Home Screen** → open **T!** → **Settings → Cloudflare D1 Cloud Sync** → enter your `COACH_SYNC_KEY` → tap **Sync Now**.

# RetireIQ — Vercel deploy (static app + Finnhub quote proxy)

This folder hosts the **RetireIQ** retirement calculator as a static site on
[Vercel](https://vercel.com) **plus** a tiny serverless proxy that fetches live market
quotes from [Finnhub](https://finnhub.io) **without ever exposing your API key to the
browser**. The app still works 100% offline from `file://` — the live data path is purely
additive and degrades gracefully.

---

## Folder structure

```
retireiq-deploy/
├── api/
│   └── quote.js        # Vercel Node serverless function → Finnhub proxy
├── index.html          # the RetireIQ app (a COPY of the Desktop source of truth)
├── vercel.json         # function config + CORS header
├── package.json        # Node engine pin (no runtime dependencies)
├── .gitignore          # node_modules, .vercel, .env
└── README.md           # this file
```

> **Source of truth / re-syncing:** the authoritative app file is
> `C:\Users\SHAHP050\Desktop\retirement-portfolio-calculator.html`. The `index.html` here is
> a **copy** of it for hosting. There is **no second copy of the logic** — only the single
> HTML is duplicated. **Whenever you change the Desktop file, re-copy it over `index.html`**
> before redeploying:
>
> ```powershell
> Copy-Item "C:\Users\SHAHP050\Desktop\retirement-portfolio-calculator.html" `
>           "C:\Users\SHAHP050\Desktop\retireiq-deploy\index.html" -Force
> ```

---

## 1. Get a free Finnhub API key

1. Sign up at <https://finnhub.io/register> (free).
2. Copy your API key from the dashboard.
3. **Free-tier limits:** ~**60 API calls/minute**. Endpoints used here — `/quote` and
   `/stock/profile2` — are available on the free tier. **Historical candles**
   (`/stock/candle`, used for trailing return/volatility) are **often gated on the free
   tier**; the proxy attempts them but degrades gracefully (no trailing figures) if they
   return 403/no-data. The app then keeps its built-in long-run estimates for modeling.

---

## 2. Deploy to Vercel

### Option A — Vercel CLI

```bash
npm i -g vercel
cd retireiq-deploy
vercel            # first run: link/create the project (accept defaults)
vercel --prod     # deploy to production
```

### Option B — Git + Vercel dashboard

1. Push this folder to a GitHub/GitLab/Bitbucket repo.
2. In the Vercel dashboard: **Add New… → Project → Import** the repo.
3. Framework preset: **Other** (it's a static site). Root directory: this folder.
4. Deploy.

---

## 3. Set the API key as an environment variable (never in code!)

In the Vercel dashboard:

1. Open your project → **Settings → Environment Variables**.
2. Add a variable:
   - **Name:** `FINNHUB_API_KEY`
   - **Value:** *(your Finnhub key)*
   - **Environments:** Production (and Preview/Development if you want live data there too).
3. **Redeploy** so the new env var is picked up (`vercel --prod`, or "Redeploy" in the dashboard).

If the env var is missing, the proxy returns a clear `500 {"error":"FINNHUB_API_KEY not configured"}`
and the app falls back to built-in estimates — it never crashes and never leaks anything.

---

## 4. Verify

After deploy, the app is at `https://<your-project>.vercel.app/`.

Test the proxy directly:

```
https://<your-project>.vercel.app/api/quote?symbols=AAPL,MSFT,VOO
```

Expected shape (per symbol; fields present only when upstream returns them):

```json
{
  "asOf": "2026-07-17T19:30:00.000Z",
  "source": "finnhub",
  "count": 3,
  "total": 3,
  "quotes": {
    "AAPL": { "symbol": "AAPL", "ok": true, "price": 231.4, "change": 1.2, "changePct": 0.52,
              "prevClose": 230.2, "name": "Apple Inc", "exchange": "NASDAQ NMS - GLOBAL MARKET",
              "industry": "Technology", "currency": "USD",
              "trailingReturn": 18.3, "trailingVol": 24.1 }
  }
}
```

(`trailingReturn`/`trailingVol` appear only if candle data is available on your plan.)

---

## API — `GET /api/quote`

| Query param | Description |
|---|---|
| `symbol` | A single ticker, e.g. `?symbol=AAPL`. |
| `symbols` | Comma-separated batch, e.g. `?symbols=AAPL,MSFT,VOO` (max **25** per call). |

- Symbols are **validated/sanitized** (uppercased, de-duped, allow-listed to
  `[A-Z0-9.-]{1,10}`); invalid symbols are dropped. Treat all input as untrusted.
- The key is read from `process.env.FINNHUB_API_KEY` **only** — never hardcoded, never returned.
- **CORS:** `Access-Control-Allow-Origin: *` with an `OPTIONS` preflight handler.
- **Partial results:** per-symbol failures are isolated; the response returns whatever
  succeeded plus `count`/`total`.
- Finnhub endpoints used: **`/quote`** (price), **`/stock/profile2`** (name/exchange/industry/
  currency), and best-effort **`/stock/candle`** (trailing return/vol; degrades on free tier).
  `/search` is available on Finnhub for symbol lookup but is not required by the client.

---

## How the client (RetireIQ) uses this

- **Hosted (http/https):** the app auto-detects `location.origin` and calls the relative
  endpoint **`/api/quote`** on the same Vercel deployment.
- **Offline (`file://`):** no live fetch by default. You can point a local `file://` copy at
  your deployed proxy by pasting the URL into **Configure → Your Accounts → "Live data source
  (API base)"** (e.g. `https://<your-project>.vercel.app` or `.../api/quote`). This is stored
  locally and used for both the on-load auto-refresh and the manual **↻ Refresh prices** button.
- **On load (once per session):** the app fetches quotes for all held tickers (deduped,
  batched, time-sliced), updates prices + trailing figures in its local cache
  (`localStorage: retireiq_tickers_v1`, with a timestamp), and refreshes the holdings rows
  in place. If no live source is available it silently keeps the built-in estimates.
- **Fallback order:** Finnhub proxy → keyless Stooq attempt → local cache → built-in/estimated.
  Live **price** values a position today; usable **trailing return/vol** feed unrecognized-ticker
  modeling assumptions (still user-overridable) — recognized tickers keep their long-run figures.

## Security notes

- **No secrets in the repo or client.** The Finnhub key lives only in the Vercel env var and
  is used only server-side in `api/quote.js`.
- All fetched data is treated as untrusted on both ends: validated/bounded numbers, defensive
  JSON parsing, and never `eval`'d.

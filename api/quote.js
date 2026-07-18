// RetireIQ — Finnhub quote proxy (Vercel Node serverless function)
// ---------------------------------------------------------------------------
// SECURITY-REVIEW:
//   • External HTTP call: this function calls Finnhub (https://finnhub.io) server-side.
//   • Env-var secret: the API key is read ONLY from process.env.FINNHUB_API_KEY. It is
//     never hardcoded, never logged, and never returned to the client. If the env var is
//     missing we return a generic 500 JSON error without leaking anything.
//   • Untrusted input: every incoming symbol is treated as hostile. Symbols are uppercased,
//     de-duplicated, length-capped, allow-listed to /^[A-Z0-9.\-]{1,10}$/, and the batch is
//     capped at MAX_SYMBOLS. Anything failing validation is dropped.
//   • Upstream responses are parsed defensively (type/range checks) and never eval'd. Raw
//     upstream errors are swallowed and summarized generically so nothing sensitive leaks.
//   • Permissive CORS is set (Access-Control-Allow-Origin: *) with an OPTIONS preflight
//     handler so a browser client (including a file:// copy pointed here via override) can call it.
// ---------------------------------------------------------------------------

const FINNHUB = 'https://finnhub.io/api/v1';
const MAX_SYMBOLS = 25;                    // hard cap on symbols per call
const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;   // allow-list: letters, digits, dot, hyphen; 1–10 chars
const FETCH_TIMEOUT_MS = 6000;             // per-upstream-call timeout

// Parse + sanitize a raw comma-separated symbol string into a bounded, de-duped array.
function sanitizeSymbols(raw) {
  const out = [];
  const seen = new Set();
  String(raw == null ? '' : raw)
    .split(',')
    .forEach((s) => {
      const t = String(s || '').trim().toUpperCase();
      if (!t || seen.has(t)) return;
      if (SYMBOL_RE.test(t)) { seen.add(t); out.push(t); }
    });
  return out.slice(0, MAX_SYMBOLS);
}

function num(v) { const n = +v; return isFinite(n) ? n : null; }

// Fetch JSON from a URL with a short timeout. Never throws; returns {ok,status,data}.
async function fetchJson(url) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS) : null;
  try {
    const r = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!r || !r.ok) return { ok: false, status: r ? r.status : 0 };
    const data = await r.json();
    return { ok: true, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Compute annualized trailing return & volatility from a Finnhub daily candle payload.
// Free-tier accounts frequently do NOT have candle access → this returns null and we
// degrade gracefully (no trailing figures), never hard-failing the whole response.
function statsFromCandles(c) {
  if (!c || c.s !== 'ok' || !Array.isArray(c.c)) return null;
  const closes = c.c.filter((x) => isFinite(x) && x > 0);
  if (closes.length < 30) return null;
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  if (rets.length < 20) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varc = rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, rets.length - 1);
  const annReturn = (Math.pow(1 + mean, 252) - 1) * 100; // ~252 trading days/yr
  const annVol = Math.sqrt(varc * 252) * 100;
  if (!isFinite(annReturn) || !isFinite(annVol)) return null;
  return { trailingReturn: +annReturn.toFixed(2), trailingVol: +annVol.toFixed(2) };
}

// Resolve one symbol into a compact quote record. Best-effort per endpoint: a failure on
// any single endpoint degrades that field but never the whole record.
async function quoteOne(symbol, key) {
  const enc = encodeURIComponent(symbol);
  const out = { symbol, ok: false, currency: 'USD' };

  // /quote — current price (free tier)
  const q = await fetchJson(`${FINNHUB}/quote?symbol=${enc}&token=${key}`);
  if (q.ok && q.data && num(q.data.c) != null && q.data.c > 0) {
    out.price = +(+q.data.c).toFixed(4);
    out.change = num(q.data.d);
    out.changePct = num(q.data.dp);
    out.prevClose = num(q.data.pc);
    out.ok = true;
  }

  // /stock/profile2 — name / exchange / industry / currency (free tier)
  const p = await fetchJson(`${FINNHUB}/stock/profile2?symbol=${enc}&token=${key}`);
  if (p.ok && p.data && typeof p.data === 'object') {
    if (p.data.name) out.name = String(p.data.name).slice(0, 80);
    if (p.data.exchange) out.exchange = String(p.data.exchange).slice(0, 60);
    if (p.data.finnhubIndustry) out.industry = String(p.data.finnhubIndustry).slice(0, 60);
    if (p.data.currency) out.currency = String(p.data.currency).slice(0, 8);
  }

  // /stock/candle — OPTIONAL trailing return/vol. Often 403/no-data on the free tier;
  // we attempt it but degrade gracefully (no trailing figures) rather than hard-failing.
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 370 * 24 * 3600; // ~1 year of daily candles
    const c = await fetchJson(`${FINNHUB}/stock/candle?symbol=${enc}&resolution=D&from=${from}&to=${now}&token=${key}`);
    if (c.ok) {
      const st = statsFromCandles(c.data);
      if (st) { out.trailingReturn = st.trailingReturn; out.trailingVol = st.trailingVol; }
    }
  } catch (e) { /* candles unavailable — ignore, keep partial record */ }

  return out;
}

module.exports = async (req, res) => {
  // ── CORS (permissive so the static client, incl. a file:// override, can call it) ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // ── Secret from env only. Never hardcode; never leak. ──
  const key = process.env.FINNHUB_API_KEY;
  if (!key) { res.status(500).json({ error: 'FINNHUB_API_KEY not configured' }); return; }

  // ── Untrusted input: accept ?symbol=AAPL and/or ?symbols=AAPL,MSFT,... ──
  const q = (req && req.query) || {};
  const rawSingle = Array.isArray(q.symbol) ? q.symbol.join(',') : (q.symbol || '');
  const rawBatch = Array.isArray(q.symbols) ? q.symbols.join(',') : (q.symbols || '');
  const symbols = sanitizeSymbols([rawBatch, rawSingle].filter(Boolean).join(','));

  if (!symbols.length) {
    res.status(400).json({ error: 'No valid symbols. Use ?symbol=AAPL or ?symbols=AAPL,MSFT (A-Z 0-9 . - , max ' + MAX_SYMBOLS + ').' });
    return;
  }

  try {
    // Resolve all symbols; per-symbol failures are isolated so we return partial results.
    const results = await Promise.all(
      symbols.map((s) => quoteOne(s, key).catch(() => ({ symbol: s, ok: false })))
    );
    const quotes = {};
    let okCount = 0;
    results.forEach((r) => {
      if (r && r.symbol) { quotes[r.symbol] = r; if (r.ok) okCount++; }
    });
    res.status(200).json({
      asOf: new Date().toISOString(),
      source: 'finnhub',
      count: okCount,
      total: symbols.length,
      quotes,
    });
  } catch (e) {
    // Never leak upstream/internal detail.
    res.status(502).json({ error: 'Upstream fetch failed' });
  }
};

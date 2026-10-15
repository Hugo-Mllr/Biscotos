/* Open Food Facts client (docs/ARCHITECTURE.md § 4).
 *
 * Called by the server, never by the browser: OFF asks every app to identify itself with a
 * User-Agent (a browser cannot set one), the person's address and searches stay off a third
 * party, and one cache serves everybody — products are public data, nothing personal is stored.
 *
 * What comes back is never OFF's raw JSON: each product is reduced to the handful of fields the
 * app uses and run through the same validator as a food typed by hand (store.js), so a strange
 * or hostile record upstream is dropped, not relayed.
 *
 * OFF's published limits are 100 product reads and 10 searches per minute per client; the
 * instance-wide budgets below stay under them whatever the number of profiles (search-a-licious
 * has a budget of its own, `quick`). Data © Open Food
 * Facts contributors, ODbL. */
import { validateFood, isBarcode, LIMITS } from './store.js';

export const DEFAULT_BASE = 'https://world.openfoodfacts.org';
// Search-a-licious, OFF's Elasticsearch-backed search. The historical /cgi/search.pl full-text
// search is slow (often past 10 s) and shed first under load (503), so it is the fallback only.
export const DEFAULT_SEARCH_BASE = 'https://search.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_fr,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity';
const TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 6000;     // search-a-licious answers in well under a second when it is up
const LEGACY_TIMEOUT_MS = 15000;    // /cgi/search.pl
const PAGE_SIZE = 20;

export class OffError extends Error {
  // code: 'unavailable' | 'not-found' | 'busy' (the instance-wide budget is spent; retryAfter in s)
  constructor(code, message, retryAfter) { super(message); this.code = code; this.retryAfter = retryAfter; }
}

const first = (...vs) => vs.find(v => typeof v === 'string' && v.trim());
// Search-a-licious returns translated fields as { main, en, fr, … } and lists as arrays.
const textIn = (v, lang) => (v && typeof v === 'object' && !Array.isArray(v) ? first(v[lang], v.main, v.en, ...Object.values(v)) : v);
const listText = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').join(',') : v);
const n = v => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** OFF product → { name, brand, barcode, source:'off', per100, serving } or null when unusable. */
export function normalizeProduct(p, lang = 'fr') {
  if (!p || typeof p !== 'object') return null;
  const nm = p.nutriments || {};
  let kcal = n(nm['energy-kcal_100g']);
  if (!(kcal >= 0)) {
    const kj = n(nm['energy-kj_100g'] ?? nm.energy_100g);
    if (kj >= 0) kcal = kj / 4.184;
  }
  const name = first(p['product_name_' + lang], textIn(p.product_name, lang), p.product_name_en, textIn(p.generic_name, lang));
  const brand = first(String(listText(p.brands) || '').split(',')[0].trim());
  const candidate = {
    name, brand,
    barcode: isBarcode(String(p.code || '')) ? String(p.code) : undefined,
    source: 'off',
    per100: {
      kcal: kcal === undefined ? undefined : Math.round(kcal),
      protein: n(nm.proteins_100g) ?? 0,
      carbs: n(nm.carbohydrates_100g) ?? 0,
      fat: n(nm.fat_100g) ?? 0,
      fiber: n(nm.fiber_100g),
      sugar: n(nm.sugars_100g),
      salt: n(nm.salt_100g),
    },
  };
  const sq = n(p.serving_quantity);
  if (sq > 0 && sq <= LIMITS.GRAMS_MAX) {
    candidate.serving = { label: first(p.serving_size) || `${sq} g`, grams: sq };
  }
  // Values OFF sometimes carries (negative, >100 g of salt per 100 g, NaN) fail validation.
  for (const k of ['fiber', 'sugar', 'salt']) {
    const v = candidate.per100[k];
    if (!(v >= 0 && v <= 100)) delete candidate.per100[k];
  }
  try { return validateFood(candidate); } catch { return null; }
}

/** A small TTL + size bounded cache (insertion order = age). */
export function createCache({ max = 2000, ttlMs = 86400000, now = () => Date.now() } = {}) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (e.exp < now()) { m.delete(k); return undefined; }
      return e.v;
    },
    set(k, v, ttl = ttlMs) {
      m.delete(k);
      while (m.size >= max) m.delete(m.keys().next().value);
      m.set(k, { v, exp: now() + ttl });
    },
    get size() { return m.size; },
  };
}

/**
 * createOff({ fetch, base, userAgent, budget }) → { search(q, {page, lang}), barcode(code, {lang}) }
 * `fetch` is injectable for the tests (no network in CI). `budget` holds two rate-limit windows
 * ({ search, product }, rate-limit.js createWindow): only a real upstream call spends them,
 * never a cache hit.
 */
export function createOff({
  fetch = globalThis.fetch, base = DEFAULT_BASE, searchBase = DEFAULT_SEARCH_BASE, userAgent,
  cache = createCache(), budget = {}, onFail = () => {}
} = {}) {
  const root = String(base).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(root)) throw new Error('OFF base URL must be http(s)');
  // searchBase '' (or null) skips search-a-licious and goes straight to /cgi/search.pl.
  const sroot = searchBase ? String(searchBase).replace(/\/+$/, '') : '';
  if (sroot && !/^https?:\/\//.test(sroot)) throw new Error('OFF search URL must be http(s)');
  const spend = kind => {
    const wait = budget[kind]?.take('instance') || 0;
    if (wait) throw new OffError('busy', 'food database busy, try again shortly', wait);
  };

  // `what` names the call in onFail (the server log): never the terms, only which call and why.
  async function get(url, what, timeoutMs = TIMEOUT_MS) {
    let r;
    try {
      r = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (e) {
      const why = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network';
      onFail(what, why);
      throw new OffError('unavailable', 'food database unreachable');
    }
    if (r.status === 404) return null;
    // OFF sheds load with 503 and rate-limits with 429: "busy", so the app says "try again shortly".
    if (r.status === 429 || r.status === 503) {
      onFail(what, 'status ' + r.status);
      throw new OffError('busy', 'food database busy, try again shortly', 30);
    }
    if (!r.ok) { onFail(what, 'status ' + r.status); throw new OffError('unavailable', 'food database error'); }
    // Reading the body can fail on its own (connection cut mid-transfer, timeout): still upstream's.
    let text;
    try { text = String((await r.text()) ?? ''); } catch { throw new OffError('unavailable', 'food database answer cut short'); }
    if (text.length > 2_000_000) throw new OffError('unavailable', 'food database answer too large');
    try { return JSON.parse(text); } catch { onFail(what, 'not json'); throw new OffError('unavailable', 'food database answer unreadable'); }
  }

  async function quickSearch(terms, pg, lang) {
    const langs = lang === 'en' ? 'en' : `${lang},en`;
    const url = `${sroot}/search?q=${encodeURIComponent(terms)}&langs=${encodeURIComponent(langs)}`
      + `&page_size=${PAGE_SIZE}&page=${pg}&fields=${FIELDS}`;
    const body = await get(url, 'search', SEARCH_TIMEOUT_MS);
    const hits = Array.isArray(body?.hits) ? body.hits : [];
    return hits.map(p => normalizeProduct(p, lang)).filter(Boolean);
  }

  async function legacySearch(terms, pg, lang) {
    spend('search');
    const url = `${root}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1`
      + `&page_size=${PAGE_SIZE}&page=${pg}&lc=${encodeURIComponent(lang)}&fields=${FIELDS}`;
    const body = await get(url, 'legacy search', LEGACY_TIMEOUT_MS);
    const products = Array.isArray(body?.products) ? body.products : [];
    return products.map(p => normalizeProduct(p, lang)).filter(Boolean);
  }

  return {
    async search(q, { page = 1, lang = 'fr' } = {}) {
      const terms = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (terms.length < 2) return [];
      const pg = Math.min(5, Math.max(1, Math.trunc(+page) || 1));
      const key = `s|${lang}|${pg}|${terms.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit) return hit;
      // Search-a-licious first; when it fails or has nothing usable, the historical search.
      let out = [];
      if (sroot) {
        spend('quick');
        try { out = await quickSearch(terms, pg, lang); } catch (e) { if (!(e instanceof OffError)) throw e; }
      }
      if (!out.length) out = await legacySearch(terms, pg, lang);
      cache.set(key, out);
      return out;
    },
    async barcode(code, { lang = 'fr' } = {}) {
      if (!isBarcode(code)) throw new OffError('not-found', 'not a barcode');
      const key = `b|${lang}|${code}`;
      const hit = cache.get(key);
      if (hit !== undefined) { if (hit === null) throw new OffError('not-found', 'unknown product'); return hit; }
      spend('product');
      const body = await get(`${root}/api/v2/product/${code}.json?fields=${FIELDS}`, 'product');
      const food = body && body.status !== 0 && body.product ? normalizeProduct({ code, ...body.product }, lang) : null;
      // Unknown products are cached too, for less long: someone may add it to OFF meanwhile.
      cache.set(key, food, food ? 7 * 86400000 : 3600000);
      if (!food) throw new OffError('not-found', 'unknown product');
      return food;
    },
  };
}

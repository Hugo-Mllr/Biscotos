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
 * instance-wide budgets below stay under them whatever the number of profiles. Data © Open Food
 * Facts contributors, ODbL. */
import { validateFood, isBarcode, LIMITS } from './store.js';

export const DEFAULT_BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_fr,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity';
const TIMEOUT_MS = 8000;
const PAGE_SIZE = 20;

export class OffError extends Error {
  // code: 'unavailable' | 'not-found' | 'busy' (the instance-wide budget is spent; retryAfter in s)
  constructor(code, message, retryAfter) { super(message); this.code = code; this.retryAfter = retryAfter; }
}

const first = (...vs) => vs.find(v => typeof v === 'string' && v.trim());
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
  const name = first(p['product_name_' + lang], p.product_name, p.product_name_en, p.generic_name);
  const brand = first(String(p.brands || '').split(',')[0]);
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
export function createOff({ fetch = globalThis.fetch, base = DEFAULT_BASE, userAgent, cache = createCache(), budget = {} } = {}) {
  const root = String(base).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(root)) throw new Error('OFF base URL must be http(s)');
  const spend = kind => {
    const wait = budget[kind]?.take('instance') || 0;
    if (wait) throw new OffError('busy', 'food database busy, try again shortly', wait);
  };

  async function get(url) {
    let r;
    try {
      r = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch { throw new OffError('unavailable', 'food database unreachable'); }
    if (r.status === 404) return null;
    if (!r.ok) throw new OffError('unavailable', 'food database error');
    // Reading the body can fail on its own (connection cut mid-transfer, timeout): still upstream's.
    let text;
    try { text = String((await r.text()) ?? ''); } catch { throw new OffError('unavailable', 'food database answer cut short'); }
    if (text.length > 2_000_000) throw new OffError('unavailable', 'food database answer too large');
    try { return JSON.parse(text); } catch { throw new OffError('unavailable', 'food database answer unreadable'); }
  }

  return {
    async search(q, { page = 1, lang = 'fr' } = {}) {
      const terms = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (terms.length < 2) return [];
      const pg = Math.min(5, Math.max(1, Math.trunc(+page) || 1));
      const key = `s|${lang}|${pg}|${terms.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit) return hit;
      spend('search');
      const url = `${root}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1`
        + `&page_size=${PAGE_SIZE}&page=${pg}&lc=${encodeURIComponent(lang)}&fields=${FIELDS}`;
      const body = await get(url);
      const products = Array.isArray(body?.products) ? body.products : [];
      const out = products.map(p => normalizeProduct(p, lang)).filter(Boolean);
      cache.set(key, out);
      return out;
    },
    async barcode(code, { lang = 'fr' } = {}) {
      if (!isBarcode(code)) throw new OffError('not-found', 'not a barcode');
      const key = `b|${lang}|${code}`;
      const hit = cache.get(key);
      if (hit !== undefined) { if (hit === null) throw new OffError('not-found', 'unknown product'); return hit; }
      spend('product');
      const body = await get(`${root}/api/v2/product/${code}.json?fields=${FIELDS}`);
      const food = body && body.status !== 0 && body.product ? normalizeProduct({ code, ...body.product }, lang) : null;
      // Unknown products are cached too, for less long: someone may add it to OFF meanwhile.
      cache.set(key, food, food ? 7 * 86400000 : 3600000);
      if (!food) throw new OffError('not-found', 'unknown product');
      return food;
    },
  };
}

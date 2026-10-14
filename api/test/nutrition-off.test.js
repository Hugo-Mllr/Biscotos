/* Open Food Facts client: what is kept of a product, what is refused, and what the instance
 * spends upstream. No network: fetch is a stub. Fixture products are synthetic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct, createOff, createCache, OffError } from '../nutrition/off.js';
import { createWindow } from '../rate-limit.js';

const product = {
  code: '3000000000017', product_name: 'Demo oats', product_name_fr: 'Flocons démo', brands: 'DemoBrand, Other',
  serving_size: '40 g', serving_quantity: 40,
  nutriments: { 'energy-kcal_100g': 372, proteins_100g: 13.5, carbohydrates_100g: 58.7, fat_100g: 7, fiber_100g: 10, salt_100g: 0.01, sugars_100g: -2 },
  ingredients_text: 'ignored', image_url: 'https://example.invalid/x.jpg'
};

test('a product is reduced to the fields the app uses, in the asked language', () => {
  const f = normalizeProduct(product, 'fr');
  assert.deepEqual(f, {
    name: 'Flocons démo', brand: 'DemoBrand', barcode: '3000000000017', source: 'off',
    per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10, salt: 0.01 },
    serving: { label: '40 g', grams: 40 }
  });
  assert.equal(normalizeProduct(product, 'de').name, 'Demo oats');
});

test('kcal falls back to kJ; unusable products are dropped, not relayed', () => {
  const kj = normalizeProduct({ product_name: 'Kj only', nutriments: { energy_100g: 1000, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 } });
  assert.equal(kj.per100.kcal, 239);
  assert.equal(normalizeProduct({ product_name: 'no energy', nutriments: {} }), null);
  assert.equal(normalizeProduct({ nutriments: product.nutriments }), null, 'no name');
  assert.equal(normalizeProduct({ product_name: 'x', nutriments: { 'energy-kcal_100g': 5000 } }), null, 'impossible kcal');
  assert.equal(normalizeProduct({ product_name: 'x', nutriments: { 'energy-kcal_100g': 100, fat_100g: 90, proteins_100g: 90 } }), null);
  assert.equal(normalizeProduct(null), null);
  assert.equal(normalizeProduct({ ...product, code: '12<script>' }).barcode, undefined);
});

function stubFetch(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const a = typeof answer === 'function' ? answer(url) : answer;
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, calls };
}

test('barcode: identifies itself, caches hits and misses, maps errors', async () => {
  const s = stubFetch(url => (url.includes('3000000000017') ? { status: 200, body: { status: 1, product } } : { status: 404, body: {} }));
  const off = createOff({ fetch: s.fetch, base: 'http://off.test/', userAgent: 'Biscotos/test (+repo)' });
  const f = await off.barcode('3000000000017');
  assert.equal(f.name, 'Flocons démo');
  assert.equal(s.calls[0].init.headers['User-Agent'], 'Biscotos/test (+repo)');
  assert.equal(s.calls[0].init.redirect, 'error');
  assert.match(s.calls[0].url, /^http:\/\/off\.test\/api\/v2\/product\/3000000000017\.json\?fields=/);
  await off.barcode('3000000000017');
  assert.equal(s.calls.length, 1, 'second read from cache');
  await assert.rejects(off.barcode('3000000000024'), e => e instanceof OffError && e.code === 'not-found');
  await assert.rejects(off.barcode('3000000000024'), e => e.code === 'not-found');
  assert.equal(s.calls.length, 2, 'a miss is cached too');
  await assert.rejects(off.barcode('../../etc'), e => e.code === 'not-found');
  assert.equal(s.calls.length, 2, 'a malformed code never reaches upstream');
});

test('upstream failures are "unavailable", whatever their shape', async () => {
  for (const answer of [new TypeError('fetch failed'), { status: 500, body: {} }, { status: 200, body: undefined }]) {
    const off = createOff({ fetch: stubFetch(answer).fetch, userAgent: 'x' });
    await assert.rejects(off.barcode('3000000000017'), e => e.code === 'unavailable' || e.code === 'not-found');
  }
  const off = createOff({ fetch: async () => ({ ok: true, status: 200, text: async () => '<html>' }), userAgent: 'x' });
  await assert.rejects(off.search('oats'), e => e.code === 'unavailable');
});

test('search: terms encoded, short queries never sent, results normalised and cached', async () => {
  const s = stubFetch({ status: 200, body: { products: [product, { product_name: 'junk' }] } });
  const off = createOff({ fetch: s.fetch, base: 'http://off.test', userAgent: 'x' });
  assert.deepEqual(await off.search(' a '), []);
  assert.equal(s.calls.length, 0);
  const r = await off.search('flocons & avoine', { page: 99 });
  assert.equal(r.length, 1);
  assert.match(s.calls[0].url, /search_terms=flocons%20%26%20avoine/);
  assert.match(s.calls[0].url, /&page=5&/, 'page clamped');
  await off.search('FLOCONS & avoine', { page: 5 });
  assert.equal(s.calls.length, 1, 'cache is case-insensitive on terms');
});

test('the instance-wide budget is spent only by real upstream calls', async () => {
  const s = stubFetch({ status: 200, body: { status: 1, product } });
  const budget = { search: createWindow({ max: 1, windowMs: 60000 }), product: createWindow({ max: 1, windowMs: 60000 }) };
  const off = createOff({ fetch: s.fetch, userAgent: 'x', budget });
  await off.barcode('3000000000017');
  await off.barcode('3000000000017');       // cache: free
  await assert.rejects(off.barcode('3000000000024'), e => e.code === 'busy' && e.retryAfter > 0);
  assert.equal(s.calls.length, 1);
});

test('only http(s) bases', () => {
  assert.throws(() => createOff({ base: 'file:///etc', userAgent: 'x' }));
});

test('cache: bounded and expiring', () => {
  let t = 0;
  const c = createCache({ max: 2, ttlMs: 10, now: () => t });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.size, 2);
  t = 11;
  assert.equal(c.get('b'), undefined);
});

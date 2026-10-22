/* Biscotos nutrition routes against the real server.js in a child process, with a local stand-in
 * for Open Food Facts (OFF_BASE_URL) so no test touches the network.
 *
 * The brief's rule is one authorization test per route. For every route:
 *   - no session → 401, and nothing is written;
 *   - profile B never reads, changes or deletes profile A's data: an id of A's answers 404 to B,
 *     exactly like an id that never existed, and A's file is byte-for-byte unchanged afterwards.
 * Every user and product below is synthetic. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const A = 'u_alex_demo', B = 'u_sam_demo';

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });
const anon = { 'Content-Type': 'application/json' };

const PRODUCT = {
  code: '3000000000017', product_name: 'Flocons démo', brands: 'DemoBrand',
  nutriments: { 'energy-kcal_100g': 372, proteins_100g: 13.5, carbohydrates_100g: 58.7, fat_100g: 7 }
};

let h, offServer, offHits = [];

before(async () => {
  offServer = http.createServer((req, res) => {
    offHits.push({ url: req.url, ua: req.headers['user-agent'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/v2/product/3000000000017.json')) return res.end(JSON.stringify({ status: 1, product: PRODUCT }));
    if (req.url.startsWith('/api/v2/product/')) { res.statusCode = 404; return res.end('{}'); }
    if (req.url.startsWith('/cgi/search.pl')) return res.end(JSON.stringify({ products: [PRODUCT] }));
    res.statusCode = 500; res.end('{}');
  });
  await new Promise(r => offServer.listen(0, '127.0.0.1', r));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-nutri-routes-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: A, name: 'Alex Demo', created: new Date().toISOString() }, { id: B, name: 'Sam Demo', created: new Date().toISOString() }],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      OFF_SEARCH_URL: '0', OFF_BASE_URL: `http://127.0.0.1:${offServer.address().port}` }
  });
  h = { log: '', dataDir, child };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
});

after(() => {
  h?.child.kill('SIGKILL');
  offServer?.close();
  if (h) fs.rmSync(h.dataDir, { recursive: true, force: true });
});

async function call(method, route, headers, body) {
  const r = await fetch(h.api + route, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json, headers: r.headers };
}
const fileOf = uid => path.join(h.dataDir, `nutrition-${uid}.json`);
const snapshot = uid => (fs.existsSync(fileOf(uid)) ? fs.readFileSync(fileOf(uid), 'utf8') : null);

const per100 = { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 };
const entry = { d: '2026-10-14', meal: 'breakfast', grams: 60, name: 'Flocons démo', per100 };
const food = { name: 'Skyr démo', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, serving: { label: '1 pot', grams: 150 } };
const RANGE = '?from=2026-10-01&to=2026-10-31';

/* ------------------------------------------------ happy paths (profile A) -- */

test('A logs, edits and deletes an entry; the macros are never stored, only grams and per100', async () => {
  let r = await call('POST', '/api/nutrition/log', as(A), { ...entry, uid: B, id: 'forged', createdAt: 1 });
  assert.equal(r.status, 201);
  const id = r.body.entry.id;
  assert.notEqual(id, 'forged', 'the server mints ids');
  assert.equal(r.body.entry.uid, undefined, 'a uid in the body is dropped');
  assert.ok(r.body.entry.createdAt > 1);

  r = await call('POST', '/api/nutrition/log/update', as(A), { id, grams: 80, meal: 'snack' });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.grams, 80);
  assert.equal(r.body.entry.meal, 'snack');

  r = await call('GET', '/api/nutrition' + RANGE, as(A));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.log.map(e => e.id), [id]);

  r = await call('POST', '/api/nutrition/log/delete', as(A), { id });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/nutrition' + RANGE, as(A));
  assert.deepEqual(r.body.log, []);
  assert.equal(fs.statSync(fileOf(A)).mode & 0o777, 0o600);
});

test('A keeps foods and settings', async () => {
  let r = await call('POST', '/api/nutrition/foods', as(A), food);
  assert.equal(r.status, 201);
  const id = r.body.food.id;
  r = await call('POST', '/api/nutrition/foods/update', as(A), { id, ...food, name: 'Skyr nature démo' });
  assert.equal(r.body.food.name, 'Skyr nature démo');
  r = await call('PUT', '/api/nutrition/settings', as(A), { goals: { kcal: 2400, protein: 160 }, profile: { heightCm: 178 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { profile: { heightCm: 178 }, goals: { kcal: 2400, protein: 160 } });
  r = await call('GET', '/api/nutrition' + RANGE, as(A));
  assert.deepEqual(r.body.foods.map(f => f.id), [id]);
  r = await call('POST', '/api/nutrition/foods/delete', as(A), { id });
  assert.equal(r.status, 200);
});

/* ------------------------------------------------------ validation (400) -- */

test('bad input is refused with the field named, and nothing is written', async () => {
  const before = snapshot(A);
  for (const [route, body, field] of [
    ['/api/nutrition/log', { ...entry, d: '2026-02-30' }, 'd'],
    ['/api/nutrition/log', { ...entry, grams: -5 }, 'grams'],
    ['/api/nutrition/log', { ...entry, per100: { kcal: 'lots' } }, 'per100.kcal'],
    ['/api/nutrition/log', { ...entry, meal: '<img>' }, 'meal'],
    ['/api/nutrition/foods', { ...food, barcode: '12;DROP' }, 'barcode'],
    ['/api/nutrition/foods', { name: 'x' }, 'per100'],
  ]) {
    const r = await call('POST', route, as(A), body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.field, field);
  }
  for (const q of ['', '?from=2026-10-01', '?from=2026-10-31&to=2026-10-01', '?from=2026-01-01&to=2026-12-31', '?from=x&to=y']) {
    assert.equal((await call('GET', '/api/nutrition' + q, as(A))).status, 400, q);
  }
  assert.equal((await call('PUT', '/api/nutrition/settings', as(A), { goals: { kcal: 1e9 } })).status, 400);
  assert.equal((await call('PUT', '/api/nutrition/settings', as(A), {})).status, 400);
  assert.equal(snapshot(A), before);
});

/* --------------------------------------------- authorization, per route -- */

const ROUTES = [
  ['GET', '/api/nutrition' + RANGE],
  ['PUT', '/api/nutrition/settings', { goals: { kcal: 1 } }],
  ['POST', '/api/nutrition/log', entry],
  ['POST', '/api/nutrition/log/update', { id: 'x', grams: 1 }],
  ['POST', '/api/nutrition/log/delete', { id: 'x' }],
  ['POST', '/api/nutrition/foods', food],
  ['POST', '/api/nutrition/foods/update', { id: 'x', ...food }],
  ['POST', '/api/nutrition/foods/delete', { id: 'x' }],
  ['GET', '/api/food/search?q=oats'],
  ['GET', '/api/food/barcode?code=3000000000017'],
];

for (const [method, route, body] of ROUTES) {
  test(`authz ${method} ${route.split('?')[0]}: no session → 401, nothing written`, async () => {
    const files = fs.readdirSync(h.dataDir).filter(f => f.startsWith('nutrition-')).map(f => f + fs.readFileSync(path.join(h.dataDir, f), 'utf8'));
    const r = await call(method, route, anon, body);
    assert.equal(r.status, 401);
    // A forged or expired cookie is no session either.
    const forged = { ...anon, Cookie: `gymsid=${A}:${Date.now() + 1e6}:0.${'A'.repeat(43)}` };
    assert.equal((await call(method, route, forged, body)).status, 401);
    const after = fs.readdirSync(h.dataDir).filter(f => f.startsWith('nutrition-')).map(f => f + fs.readFileSync(path.join(h.dataDir, f), 'utf8'));
    assert.deepEqual(after, files);
  });
}

test('authz GET /api/nutrition: B never sees A\'s log, foods, goals or height', async () => {
  await call('POST', '/api/nutrition/log', as(A), entry);
  await call('POST', '/api/nutrition/foods', as(A), food);
  await call('PUT', '/api/nutrition/settings', as(A), { goals: { kcal: 2400 }, profile: { heightCm: 178 } });
  const r = await call('GET', '/api/nutrition' + RANGE, as(B));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.log, []);
  assert.deepEqual(r.body.foods, []);
  assert.equal(r.body.goals, null);
  assert.equal(r.body.profile.heightCm, null);
  // Parameters naming another profile are ignored: the profile is the session's.
  const r2 = await call('GET', `/api/nutrition${RANGE}&uid=${A}&user=${A}`, as(B));
  assert.deepEqual(r2.body.log, []);
});

test('authz PUT /api/nutrition/settings: B\'s settings land in B\'s file only', async () => {
  const before = snapshot(A);
  const r = await call('PUT', '/api/nutrition/settings', as(B), { goals: { kcal: 1800 }, uid: A });
  assert.equal(r.status, 200);
  assert.equal(snapshot(A), before);
  assert.equal(JSON.parse(snapshot(B)).goals.kcal, 1800);
});

test('authz POST /api/nutrition/log: a uid or id in the body cannot write into A', async () => {
  const before = snapshot(A);
  const r = await call('POST', '/api/nutrition/log', as(B), { ...entry, uid: A, userId: A });
  assert.equal(r.status, 201);
  assert.equal(snapshot(A), before);
});

async function aEntryAndFood() {
  const e = (await call('POST', '/api/nutrition/log', as(A), entry)).body.entry;
  const f = (await call('POST', '/api/nutrition/foods', as(A), food)).body.food;
  return { e, f };
}

test('authz POST /api/nutrition/log/update: A\'s entry id → 404 for B, A unchanged', async () => {
  const { e } = await aEntryAndFood();
  const before = snapshot(A);
  const r = await call('POST', '/api/nutrition/log/update', as(B), { id: e.id, grams: 999 });
  assert.equal(r.status, 404);
  const never = await call('POST', '/api/nutrition/log/update', as(B), { id: 'neverExisted', grams: 999 });
  assert.deepEqual([never.status, never.body], [r.status, r.body], 'indistinguishable from an unknown id');
  assert.equal(snapshot(A), before);
});

test('authz POST /api/nutrition/log/delete: A\'s entry id → 404 for B, A unchanged', async () => {
  const { e } = await aEntryAndFood();
  const before = snapshot(A);
  assert.equal((await call('POST', '/api/nutrition/log/delete', as(B), { id: e.id })).status, 404);
  assert.equal(snapshot(A), before);
});

test('authz POST /api/nutrition/foods: B\'s food is B\'s', async () => {
  const before = snapshot(A);
  assert.equal((await call('POST', '/api/nutrition/foods', as(B), { ...food, uid: A })).status, 201);
  assert.equal(snapshot(A), before);
});

test('authz POST /api/nutrition/foods/update: A\'s food id → 404 for B, A unchanged', async () => {
  const { f } = await aEntryAndFood();
  const before = snapshot(A);
  assert.equal((await call('POST', '/api/nutrition/foods/update', as(B), { id: f.id, ...food, name: 'pwned' })).status, 404);
  assert.equal(snapshot(A), before);
});

test('authz POST /api/nutrition/foods/delete: A\'s food id → 404 for B, A unchanged', async () => {
  const { f } = await aEntryAndFood();
  const before = snapshot(A);
  assert.equal((await call('POST', '/api/nutrition/foods/delete', as(B), { id: f.id })).status, 404);
  assert.equal(snapshot(A), before);
});

test('authz GET /api/food/search and /barcode: public data only, nothing of a profile', async () => {
  const before = [snapshot(A), snapshot(B)];
  const s = await call('GET', '/api/food/search?q=flocons', as(B));
  assert.equal(s.status, 200);
  assert.equal(s.body.foods[0].name, 'Flocons démo');
  const b = await call('GET', '/api/food/barcode?code=3000000000017', as(B));
  assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(b.body.food).sort(), ['barcode', 'brand', 'name', 'per100', 'source']);
  assert.deepEqual([snapshot(A), snapshot(B)], before);
});

test('a cross-site write is refused (CSRF), like every other state-changing route', async () => {
  const r = await call('POST', '/api/nutrition/log', { ...as(A), 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' }, entry);
  assert.equal(r.status, 403);
});

/* ------------------------------------------------ Open Food Facts proxy -- */

test('food lookups: identify Biscotos upstream, cache, 404 and 400 mapped', async () => {
  offHits = [];
  assert.equal((await call('GET', '/api/food/barcode?code=3000000000017', as(A))).status, 200);
  assert.equal(offHits.length, 0, 'served from the cache filled above');
  const miss = await call('GET', '/api/food/barcode?code=3000000000024', as(A));
  assert.equal(miss.status, 404);
  assert.match(offHits[0].ua, /^Biscotos\/\S+ \(\+https:\/\/github\.com\/Hugo-Mllr\/Biscotos\)$/);
  assert.equal((await call('GET', '/api/food/barcode?code=abc', as(A))).status, 400);
  assert.equal((await call('GET', '/api/food/search?q=a', as(A))).status, 400);
  assert.equal((await call('GET', '/api/food/search?q=' + 'x'.repeat(81), as(A))).status, 400);
});

test('food lookups are rate limited per profile (429 with Retry-After)', async () => {
  let last;
  for (let i = 0; i < 35; i++) {
    last = await call('GET', '/api/food/barcode?code=3000000000017', as(B));
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.ok(+last.headers.get('retry-after') > 0);
  // Another profile still has its own budget.
  assert.equal((await call('GET', '/api/food/barcode?code=3000000000017', as(A))).status, 200);
});

test('nothing of the food log ever reaches the server log', async () => {
  await call('POST', '/api/nutrition/log', as(A), { ...entry, name: 'Canary-Food-7f3a' });
  await call('POST', '/api/nutrition/log', as(A), { ...entry, grams: -1, name: 'Canary-Food-7f3b' });
  assert.ok(!h.log.includes('Canary-Food'), 'a food name was logged');
});

test('the body profile: partial updates keep the rest, bad values are 400', async () => {
  await call('PUT', '/api/nutrition/settings', as(A), { profile: { heightCm: 178 } });
  let r = await call('PUT', '/api/nutrition/settings', as(A), { profile: { sex: 'm', birthYear: 1999, goalMode: 'bulk', pace: 'gentle' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.profile, { heightCm: 178, sex: 'm', birthYear: 1999, goalMode: 'bulk', pace: 'gentle' });
  r = await call('PUT', '/api/nutrition/settings', as(A), { profile: { goalMode: null, calibrate: true } });
  assert.deepEqual(r.body.profile, { heightCm: 178, sex: 'm', birthYear: 1999, goalMode: null, pace: 'gentle', calibrate: true });
  const kept = await call('GET', '/api/nutrition' + RANGE, as(A));
  assert.equal(kept.body.profile.birthYear, 1999);
  for (const bad of [{ stepGoal: 5 }, { sex: 'robot' }, { goalMode: 'yolo' }, { birthYear: 1700 }, { bodyFatPct: 2 }, { calibrate: 'sure' }]) {
    assert.equal((await call('PUT', '/api/nutrition/settings', as(A), { profile: bad })).status, 400, JSON.stringify(bad));
  }
});

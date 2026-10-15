/* Biscotos data portability: export, import and erase of a profile's nutrition and health data,
 * against the real server.js. One authorization test per route; synthetic data only. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { parseImport, buildExport, EXPORT_FORMAT } from '../nutrition/portability.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const A = 'u_alex_demo', B = 'u_sam_demo';
const TODAY = new Date().toISOString().slice(0, 10);

const session = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const as = uid => ({ Cookie: `gymsid=${session(uid)}`, 'Content-Type': 'application/json' });
const anon = { 'Content-Type': 'application/json' };
const per100 = { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 };
const entry = { d: TODAY, meal: 'breakfast', grams: 60, name: 'Flocons démo', per100 };

let h;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-port-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: A, name: 'Alex Demo', created: new Date().toISOString() }, { id: B, name: 'Sam Demo', created: new Date().toISOString() }],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', FOOD_SEARCH: '0' } });
  h = { log: '', dataDir, child };
  child.stdout.on('data', d => h.log += d); child.stderr.on('data', d => h.log += d);
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
});
after(() => { h?.child.kill('SIGKILL'); if (h) fs.rmSync(h.dataDir, { recursive: true, force: true }); });

async function call(method, route, headers, body) {
  const r = await fetch(h.api + route, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json, headers: r.headers };
}
const snap = name => { const f = path.join(h.dataDir, name); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

/* ----------------------------------------------------------- pure parts -- */

test('parseImport keeps what validates, counts and skips the rest, refuses a foreign file', () => {
  const file = {
    format: EXPORT_FORMAT, version: 1,
    nutrition: {
      goals: { kcal: 2400 }, profile: { heightCm: 178 },
      foods: [{ id: 'f1', name: 'Skyr démo', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 } }, { name: 'bad', per100: { kcal: 5000 } }, 'junk'],
      log: [{ id: 'e1', ...entry, uid: 'someone', isAdmin: true }, { id: '../../x', ...entry }, { ...entry, d: 'never' }],
    },
    health: { samples: [{ type: 'steps', d: TODAY, value: 9000, source: 'strava' }, { type: 'steps', d: TODAY, value: -4 }, { type: 'weight', d: TODAY, value: 70.2, source: 'apple-health' }] },
  };
  const p = parseImport(file);
  assert.deepEqual(p.foods.map(f => f.id), ['f1']);
  assert.equal(p.log.length, 2);
  assert.equal(p.log[0].id, 'e1');
  assert.notEqual(p.log[1].id, '../../x', 'an id that is not one of ours is replaced');
  assert.equal(p.log[0].uid, undefined);
  assert.equal(p.log[0].isAdmin, undefined);
  // a sample from another source is skipped, never relabelled as Apple Health
  assert.deepEqual(p.samples.map(s => [s.type, s.source]), [['weight', 'apple-health']]);
  assert.equal(p.skipped, 5);
  assert.deepEqual(p.goals, { kcal: 2400 });
  for (const bad of [null, {}, { format: 'opengym-backup', version: 1 }, { format: EXPORT_FORMAT, version: 2 }]) {
    assert.throws(() => parseImport(bad));
  }
});

test('an export never carries tokens and round-trips through parseImport', () => {
  const ex = buildExport({ profile: { heightCm: 170 }, goals: null, foods: [], log: [{ id: 'e1', ...entry, createdAt: 1, updatedAt: 1 }] },
    { samples: [{ type: 'weight', d: TODAY, value: 70, source: 'apple-health', at: 5 }] });
  assert.ok(!JSON.stringify(ex).includes('token'));
  assert.equal(ex.health.samples[0].at, undefined);
  const back = parseImport(JSON.parse(JSON.stringify(ex)));
  assert.equal(back.log.length, 1);
  assert.equal(back.samples.length, 1);
  assert.equal(back.skipped, 0);
});

/* ------------------------------------------------------------ the routes -- */

test('A exports, erases, then imports the export back', async () => {
  await call('POST', '/api/nutrition/log', as(A), entry);
  await call('PUT', '/api/nutrition/settings', as(A), { goals: { kcal: 2300 }, profile: { heightCm: 178 } });
  const tok = await call('POST', '/api/hooks/tokens', as(A), { label: 'iPhone' });
  await call('POST', '/api/hooks/apple-health', { Authorization: 'Bearer ' + tok.body.token, 'Content-Type': 'application/json' },
    { samples: [{ type: 'weight', date: TODAY, value: 75.4 }] });

  const ex = await call('GET', '/api/nutrition/export', as(A));
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-disposition'), /attachment; filename="biscotos-nutrition\.json"/);
  assert.equal(ex.body.nutrition.log.length, 1);
  assert.equal(ex.body.health.samples.length, 1);
  assert.ok(!JSON.stringify(ex.body).includes(tok.body.token.slice(4)), 'no token in the export');

  assert.equal((await call('POST', '/api/nutrition/erase', as(A), {})).status, 400, 'needs the confirmation');
  assert.equal((await call('POST', '/api/nutrition/erase', as(A), { confirm: 'erase' })).status, 200);
  assert.equal(snap(`nutrition-${A}.json`), null);
  assert.equal(snap(`health-${A}.json`), null);
  assert.deepEqual((await call('GET', '/api/hooks/tokens', as(A))).body.hooks, [], 'tokens erased too');
  assert.equal((await call('POST', '/api/hooks/apple-health', { Authorization: 'Bearer ' + tok.body.token, 'Content-Type': 'application/json' }, { samples: [] })).status, 401);

  const im = await call('POST', '/api/nutrition/import', as(A), { file: ex.body });
  assert.equal(im.status, 200);
  assert.deepEqual(im.body, { mode: 'merge', added: { foods: 0, log: 1, samples: 1 }, skipped: 0 });
  const again = await call('POST', '/api/nutrition/import', as(A), { file: ex.body });
  assert.deepEqual(again.body.added, { foods: 0, log: 0, samples: 0 }, 'a second import of the same file adds nothing');
  const got = await call('GET', `/api/nutrition?from=${TODAY}&to=${TODAY}`, as(A));
  assert.equal(got.body.log.length, 1);
  assert.equal(got.body.goals.kcal, 2300);
  assert.equal(got.body.profile.heightCm, 178);
});

test('replace mode swaps the log, keeps settings the file does not have', async () => {
  const file = { format: EXPORT_FORMAT, version: 1, nutrition: { log: [{ id: 'only', ...entry }] } };
  const r = await call('POST', '/api/nutrition/import', as(A), { file, mode: 'replace' });
  assert.equal(r.status, 200);
  const got = await call('GET', `/api/nutrition?from=${TODAY}&to=${TODAY}`, as(A));
  assert.deepEqual(got.body.log.map(e => e.id), ['only']);
  assert.equal(got.body.goals.kcal, 2300);
});

for (const [method, route, body] of [
  ['GET', '/api/nutrition/export'],
  ['POST', '/api/nutrition/import', { file: { format: EXPORT_FORMAT, version: 1 } }],
  ['POST', '/api/nutrition/erase', { confirm: 'erase' }],
]) {
  test(`authz ${method} ${route}: no session → 401, nothing touched`, async () => {
    const before = [snap(`nutrition-${A}.json`), snap(`nutrition-${B}.json`), snap('integrations.json')];
    assert.equal((await call(method, route, anon, body)).status, 401);
    assert.deepEqual([snap(`nutrition-${A}.json`), snap(`nutrition-${B}.json`), snap('integrations.json')], before);
  });
}

test('authz GET /api/nutrition/export: B exports B\'s data, never A\'s', async () => {
  const r = await call('GET', `/api/nutrition/export?uid=${A}`, as(B));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.nutrition.log, []);
  assert.deepEqual(r.body.health.samples, []);
});

test('authz POST /api/nutrition/import: B\'s import lands in B\'s file only', async () => {
  const before = snap(`nutrition-${A}.json`);
  const file = { format: EXPORT_FORMAT, version: 1, nutrition: { log: [{ id: 'only', ...entry, uid: A }] } };
  assert.equal((await call('POST', '/api/nutrition/import', as(B), { file, uid: A })).status, 200);
  assert.equal(snap(`nutrition-${A}.json`), before);
  assert.ok(snap(`nutrition-${B}.json`).includes('"only"'));
});

test('authz POST /api/nutrition/erase: B erases B only; A\'s data and tokens stay', async () => {
  const tok = await call('POST', '/api/hooks/tokens', as(A), { label: 'kept' });
  const before = snap(`nutrition-${A}.json`);
  assert.equal((await call('POST', '/api/nutrition/erase', as(B), { confirm: 'erase', uid: A })).status, 200);
  assert.equal(snap(`nutrition-${A}.json`), before);
  assert.equal(snap(`nutrition-${B}.json`), null);
  assert.equal((await call('POST', '/api/hooks/apple-health', { Authorization: 'Bearer ' + tok.body.token, 'Content-Type': 'application/json' }, { samples: [] })).status, 200);
});

test('a cross-site erase is refused (CSRF)', async () => {
  const r = await call('POST', '/api/nutrition/erase', { ...as(A), 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' }, { confirm: 'erase' });
  assert.equal(r.status, 403);
  assert.ok(snap(`nutrition-${A}.json`));
});

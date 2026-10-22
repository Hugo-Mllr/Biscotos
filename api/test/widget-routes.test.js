/* The iPhone widget's summary (health/widget.js) against the real server.js in a child process.
 * A widget key reads the summary and nothing else; a health key is not a widget key and the other
 * way round; no / malformed / revoked key → 401; numbers only, no name or id. Synthetic users only. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { totalsOn, goalOf, latestSteps } from '../health/widget.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const A = 'u_alex_demo';
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localDay();
const daysAgo = n => localDay(new Date(Date.now() - n * 86400000));
const session = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const as = uid => ({ Cookie: `gymsid=${session(uid)}`, 'Content-Type': 'application/json' });
const bearer = t => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const lift = (d, w) => ({ id: 'w' + d + w, d, start: Date.now(), entries: [{ id: 'bench', sets: [{ w, r: 5, done: true }] }] });

let h;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-widget-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: A, name: 'Alex Demo', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, `state-${A}.json`), JSON.stringify({ unit: 'kg', accent: 'lime', workouts: [lift(TODAY, 80), lift(daysAgo(1), 78)] }));
  fs.writeFileSync(path.join(dataDir, `nutrition-${A}.json`), JSON.stringify({
    v: 1, profile: { heightCm: 180, stepGoal: 8000, goalToday: { d: TODAY, kcal: 2450, protein: 170, carbs: 260, fat: 70 } }, goals: { kcal: 2000 }, foods: [],
    log: [{ id: 'f1', d: TODAY, meal: 'lunch', name: 'Secret snack 12345', grams: 200, per100: { kcal: 250, protein: 10, carbs: 30, fat: 8 } },
      { id: 'f2', d: daysAgo(1), meal: 'lunch', name: 'Yesterday', grams: 100, per100: { kcal: 900, protein: 0, carbs: 0, fat: 100 } }]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', FOOD_SEARCH: '0' }
  });
  h = { log: '', dataDir, child };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
});
after(() => { h?.child.kill('SIGKILL'); if (h) fs.rmSync(h.dataDir, { recursive: true, force: true }); });

async function call(method, route, headers, body) {
  const r = await fetch(h.api + route, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}

let widgetKey, healthKey, widgetId;
test('keys of two kinds are minted by a session, and a bad kind is refused', async () => {
  let r = await call('POST', '/api/hooks/tokens', as(A), { kind: 'widget', label: 'iPhone widget' });
  assert.equal(r.status, 201);
  assert.equal(r.body.hook.kind, 'widget');
  widgetKey = r.body.token; widgetId = r.body.hook.id;
  r = await call('POST', '/api/hooks/tokens', as(A), { label: 'Shortcut' });
  assert.equal(r.body.hook.kind, 'apple-health', 'no kind: an Apple Health token, as before');
  healthKey = r.body.token;
  r = await call('POST', '/api/hooks/tokens', as(A), { kind: 'widget' });
  assert.equal(r.body.hook.label, 'Widget');
  assert.equal((await call('POST', '/api/hooks/tokens', as(A), { kind: 'admin' })).status, 400);
});

test('the summary: numbers of today only, the calculated goal, steps and the goal for them', async () => {
  await call('POST', '/api/hooks/apple-health', bearer(healthKey), { samples: [{ type: 'steps', date: TODAY, value: 6543 }] });
  const r = await call('GET', '/api/hooks/widget', bearer(widgetKey));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    v: 1, day: TODAY, accent: 'lime', streak: 1,
    week: { workouts: r.body.week.workouts, planned: r.body.week.planned },
    kcal: { eaten: 500, goal: 2450 },
    macros: [{ id: 'protein', eaten: 20, goal: 170 }, { id: 'carbs', eaten: 60, goal: 260 }, { id: 'fat', eaten: 16, goal: 70 }],
    steps: { d: TODAY, value: 6543, goal: 8000 },
  });
  assert.ok(r.body.week.workouts >= 1);
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes('Secret snack') && !raw.includes(A) && !raw.includes('Alex'), 'no food name, id or name');
});

test('a key of the other kind, none, a malformed one, a session cookie: all 401', async () => {
  for (const headers of [bearer(healthKey), bearer('bxh_' + 'x'.repeat(43)), bearer('nope'), { 'Content-Type': 'application/json' }, as(A)]) {
    assert.equal((await call('GET', '/api/hooks/widget', headers)).status, 401);
  }
  // and a widget key writes nothing: it is no Apple Health key
  const before = fs.existsSync(path.join(h.dataDir, `health-${A}.json`)) ? fs.readFileSync(path.join(h.dataDir, `health-${A}.json`), 'utf8') : null;
  assert.equal((await call('POST', '/api/hooks/apple-health', bearer(widgetKey), { samples: [{ type: 'steps', date: TODAY, value: 1 }] })).status, 401);
  const after = fs.existsSync(path.join(h.dataDir, `health-${A}.json`)) ? fs.readFileSync(path.join(h.dataDir, `health-${A}.json`), 'utf8') : null;
  assert.equal(after, before);
  // nor a session anywhere else
  assert.equal((await call('GET', '/api/nutrition?from=' + TODAY + '&to=' + TODAY, bearer(widgetKey))).status, 401);
});

test('revoked, it stops at once', async () => {
  assert.equal((await call('POST', '/api/hooks/tokens/revoke', as(A), { id: widgetId })).status, 200);
  assert.equal((await call('GET', '/api/hooks/widget', bearer(widgetKey))).status, 401);
});

test('without a calculated goal for today the typed one is used; without steps there are none', () => {
  assert.deepEqual(goalOf({ profile: { goalToday: { d: '2020-01-01', kcal: 3000 } }, goals: { kcal: 2000, protein: 150 } }, TODAY), { kcal: 2000, protein: 150, carbs: null, fat: null });
  assert.equal(goalOf({ profile: {}, goals: null }, TODAY), null);
  assert.deepEqual(totalsOn([{ d: TODAY, grams: 50, per100: { kcal: 100, protein: 10, carbs: 0, fat: 0 } }, { d: 'x', grams: 50, per100: { kcal: 9 } }, null], TODAY), { kcal: 50, protein: 5, carbs: 0, fat: 0 });
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  assert.equal(latestSteps([{ type: 'steps', d: '2026-01-01', value: 5 }], '2026-01-09', shift), null, 'older than yesterday');
  assert.deepEqual(latestSteps([{ type: 'steps', d: '2026-01-08', value: 4999.6 }, { type: 'weight', d: '2026-01-09', value: 80 }], '2026-01-09', shift), { d: '2026-01-08', value: 5000 });
});

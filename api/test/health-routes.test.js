/* Biscotos Apple Health webhook against the real server.js in a child process.
 *
 * One authorization test per route:
 *   - token routes and the samples read: no session → 401; another profile's token id → 404;
 *   - the webhook: no / malformed / unknown / revoked token → 401 with nothing written; a session
 *     cookie is not a webhook token; a webhook token is not a session anywhere else; a token only
 *     writes into its owner's file.
 * Every user and value is synthetic. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const A = 'u_alex_demo', B = 'u_sam_demo';
const TODAY = new Date().toISOString().slice(0, 10);

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });
const bearer = t => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

let h;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-health-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: A, name: 'Alex Demo', created: new Date().toISOString() }, { id: B, name: 'Sam Demo', created: new Date().toISOString() }],
    creds: [], subs: [], invites: []
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
  const r = await fetch(h.api + route, { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json, headers: r.headers };
}
const file = name => path.join(h.dataDir, name);
const snap = name => (fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : null);
const samples = [
  { type: 'weight', date: TODAY, value: 75.4, unit: 'kg' },
  { type: 'steps', date: TODAY + 'T21:00:00+02:00', value: 9120 },
  { type: 'restingHr', date: TODAY, value: 54 },
];

async function newToken(uid, label) {
  const r = await call('POST', '/api/hooks/tokens', as(uid), { label });
  assert.equal(r.status, 201);
  return r.body;
}

test('A creates a token, the Shortcut posts with it, A reads the samples back', async () => {
  const { hook, token } = await newToken(A, 'iPhone de démo');
  assert.match(token, /^bxh_[A-Za-z0-9_-]{43}$/);
  assert.equal(hook.label, 'iPhone de démo');
  assert.equal(hook.tokenHash, undefined, 'the hash never leaves the server');
  assert.ok(!snap('integrations.json').includes(token), 'the token itself is never stored');
  assert.equal(fs.statSync(file('integrations.json')).mode & 0o777, 0o600);

  let r = await call('POST', '/api/hooks/apple-health', bearer(token), { samples: [...samples, { type: 'weight', date: TODAY, value: 9999 }, { type: 'mood', date: TODAY, value: 1 }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.accepted, r.body.changed, r.body.rejected], [3, 3, 2]);
  assert.deepEqual(r.body.errors.map(e => e.index), [3, 4]);
  assert.ok(!JSON.stringify(r.body).includes('9999'), 'values are never echoed');

  r = await call('POST', '/api/hooks/apple-health', bearer(token), { samples: [{ type: 'steps', date: TODAY, value: 10400 }] });
  assert.equal(r.body.changed, 1);

  r = await call('GET', `/api/health-samples?from=${TODAY}&to=${TODAY}`, as(A));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.samples.map(s => [s.type, s.value, s.source]).sort(), [['restingHr', 54, 'apple-health'], ['steps', 10400, 'apple-health'], ['weight', 75.4, 'apple-health']]);
  assert.equal(fs.statSync(file(`health-${A}.json`)).mode & 0o777, 0o600);

  r = await call('GET', '/api/hooks/tokens', as(A));
  assert.equal(r.body.hooks.length, 1);
  assert.ok(r.body.hooks[0].lastUsedAt > 0);
});

/* ------------------------------------------------- authz, per route -- */

for (const [method, route, body] of [
  ['GET', '/api/hooks/tokens'],
  ['POST', '/api/hooks/tokens', { label: 'x' }],
  ['POST', '/api/hooks/tokens/revoke', { id: 'x' }],
  ['GET', `/api/health-samples?from=${TODAY}&to=${TODAY}`],
]) {
  test(`authz ${method} ${route.split('?')[0]}: no session → 401`, async () => {
    const before = snap('integrations.json');
    assert.equal((await call(method, route, { 'Content-Type': 'application/json' }, body)).status, 401);
    assert.equal(snap('integrations.json'), before);
  });
}

test('authz GET /api/hooks/tokens and /api/health-samples: B sees none of A\'s', async () => {
  const r = await call('GET', '/api/hooks/tokens', as(B));
  assert.deepEqual(r.body.hooks, []);
  const s = await call('GET', `/api/health-samples?from=${TODAY}&to=${TODAY}&uid=${A}`, as(B));
  assert.deepEqual(s.body.samples, []);
});

test('authz POST /api/hooks/tokens/revoke: A\'s token id → 404 for B, still live for A', async () => {
  const { hook, token } = await newToken(A, 'second');
  const before = snap('integrations.json');
  const r = await call('POST', '/api/hooks/tokens/revoke', as(B), { id: hook.id });
  assert.equal(r.status, 404);
  assert.equal(snap('integrations.json'), before);
  assert.equal((await call('POST', '/api/hooks/apple-health', bearer(token), { samples: [] })).status, 200);
});

test('authz POST /api/hooks/tokens: B\'s token writes into B\'s file only', async () => {
  const { token } = await newToken(B, 'Sam');
  const beforeA = snap(`health-${A}.json`);
  const r = await call('POST', '/api/hooks/apple-health', bearer(token), { samples: [{ type: 'steps', date: TODAY, value: 1, uid: A }] , uid: A });
  assert.equal(r.status, 200);
  assert.equal(snap(`health-${A}.json`), beforeA);
  assert.ok(snap(`health-${B}.json`).includes('"steps"'));
});

test('authz POST /api/hooks/apple-health: missing, malformed, unknown and revoked tokens are all one 401', async () => {
  const before = snap(`health-${A}.json`);
  const { hook, token } = await newToken(A, 'to revoke');
  assert.equal((await call('POST', '/api/hooks/tokens/revoke', as(A), { id: hook.id })).status, 200);
  const answers = [];
  for (const headers of [
    { 'Content-Type': 'application/json' },
    bearer('nope'),
    bearer('bxh_' + 'A'.repeat(43)),
    bearer(token),                                  // revoked
    as(A),                                          // a session cookie is not a webhook token
    { ...bearer(token.slice(4)) },                  // the bare secret without its prefix
  ]) {
    const r = await call('POST', '/api/hooks/apple-health', headers, { samples });
    answers.push([r.status, r.body.error, r.headers.get('www-authenticate')]);
  }
  assert.ok(answers.every(a => a[0] === 401 && a[1] === 'invalid webhook token' && a[2] === 'Bearer'), JSON.stringify(answers));
  assert.equal(snap(`health-${A}.json`), before);
});

test('a webhook token is not a session anywhere else', async () => {
  const { token } = await newToken(A, 'not a session');
  for (const [m, r] of [['GET', '/api/me'], ['GET', '/api/data'], ['GET', '/api/hooks/tokens'], ['GET', `/api/nutrition?from=${TODAY}&to=${TODAY}`]]) {
    assert.equal((await call(m, r, bearer(token))).status, 401, r);
  }
});

test('webhook input limits: shape, batch size, body size', async () => {
  const { token } = await newToken(B, 'limits');
  assert.equal((await call('POST', '/api/hooks/apple-health', bearer(token), { samples: 'all' })).status, 400);
  assert.equal((await call('POST', '/api/hooks/apple-health', bearer(token), { samples: Array(501).fill(samples[0]) })).status, 413);
  assert.equal((await call('POST', '/api/hooks/apple-health', bearer(token), JSON.stringify({ samples: [], pad: 'x'.repeat(300 * 1024) }))).status, 413);
  assert.equal((await call('POST', '/api/hooks/apple-health', bearer(token), '{not json')).status, 400);
});

test('at most five live tokens per profile', async () => {
  const live = (await call('GET', '/api/hooks/tokens', as(B))).body.hooks.filter(x => !x.revokedAt).length;
  for (let i = live; i < 5; i++) await newToken(B, 't' + i);
  const r = await call('POST', '/api/hooks/tokens', as(B), { label: 'one too many' });
  assert.equal(r.status, 409);
});

test('the webhook is rate limited per token (429 with Retry-After)', async () => {
  const { token } = await newToken(A, 'flood');
  let last;
  for (let i = 0; i < 35; i++) {
    last = await call('POST', '/api/hooks/apple-health', bearer(token), { samples: [] });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.ok(+last.headers.get('retry-after') > 0);
});

test('nothing of a token or a value reaches the server log', async () => {
  const { token } = await newToken(A, 'log check');
  await call('POST', '/api/hooks/apple-health', bearer(token), { samples: [{ type: 'weight', date: TODAY, value: 123.45 }] });
  assert.ok(!h.log.includes(token.slice(4, 20)));
  assert.ok(!h.log.includes('123.45'));
});

test('the old /api/hooks/tokens paths and the /api/integrations/tokens ones are the same routes', async () => {
  for (const h of (await call('GET', '/api/integrations/tokens', as(A))).body.hooks.filter(x => !x.revokedAt)) await call('POST', '/api/integrations/tokens/revoke', as(A), { id: h.id });
  const a = await call('POST', '/api/integrations/tokens', as(A), { label: 'new path' });
  assert.equal(a.status, 201);
  const list = (await call('GET', '/api/hooks/tokens', as(A))).body.hooks;
  assert.ok(list.some(h => h.id === a.body.hook.id), 'seen through the old path');
  assert.equal((await call('POST', '/api/hooks/tokens/revoke', as(A), { id: a.body.hook.id })).status, 200);
  const after = (await call('GET', '/api/integrations/tokens', as(A))).body.hooks.find(h => h.id === a.body.hook.id);
  assert.ok(after.revokedAt, 'revoked through the old path, seen through the new one');
});

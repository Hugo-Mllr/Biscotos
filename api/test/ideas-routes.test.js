/* Biscotos ideas box against the real server.js, with a fake GitHub on localhost.
 *
 * Authorization on every route, what a friend sees (names, never a uid), the admin-only status,
 * and the issue GitHub receives: anonymous, @mentions defused, the token sent to GitHub only and
 * never written to the log. Synthetic users and ideas only. */
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
import { cleanText, defuse, issueFor } from '../ideas/index.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const TOKEN = 'github_pat_fake_' + crypto.randomBytes(8).toString('hex');
const A = 'u_alex_demo', B = 'u_sam_demo', C = 'u_lou_demo';

const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const as = uid => ({ Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' });
const anon = { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' };

let h, gh;
const issues = [];
before(async () => {
  // The fake GitHub: records each request; a title containing FAIL answers 500, one containing
  // NOLABEL refuses labels (422) the first time.
  gh = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      issues.push({ url: req.url, auth: req.headers.authorization, body });
      if (/FAIL/.test(body.title)) { res.writeHead(500); return res.end('{}'); }
      if (/NOLABEL/.test(body.title) && body.labels) { res.writeHead(422); return res.end('{}'); }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ number: issues.length, html_url: `https://github.example/issues/${issues.length}` }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => gh.once('listening', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-ideas-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [A, B, C].map((id, i) => ({ id, name: ['Alex Demo', 'Sam Demo', 'Lou Demo'][i], created: new Date().toISOString() })),
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', FOOD_SEARCH: '0',
      ADMIN_UIDS: A, IDEAS_GITHUB_TOKEN: TOKEN, IDEAS_GITHUB_REPO: 'demo-owner/demo-repo', IDEAS_GITHUB_API: `http://127.0.0.1:${gh.address().port}` }
  });
  h = { log: '', dataDir, child };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
});
after(() => { h?.child.kill('SIGKILL'); gh?.close(); if (h) fs.rmSync(h.dataDir, { recursive: true, force: true }); });

async function call(method, route, headers, body) {
  const r = await fetch(h.api + route, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const ideasFile = () => path.join(h.dataDir, 'ideas.json');

test('pure helpers: text is cleaned, mentions defused, the issue names nobody', () => {
  assert.equal(cleanText('  a\u0000  b \n c ', 80), 'a b c');
  assert.equal(cleanText('l1\n\n\n\nl2  x', 100, { multiline: true }), 'l1\n\nl2 x');
  assert.equal(cleanText(42, 10), '');
  assert.equal(defuse('hi @bob'), 'hi @​bob');
  const issue = issueFor({ id: 'i1', title: 'Ping @team', body: 'line one\nline two' });
  assert.equal(issue.title, '[Idée] Ping @​team');
  assert.match(issue.body, /^> line one\n> line two/);
  assert.deepEqual(issue.labels, ['idea']);
});

test('every route: no session → 401', async () => {
  for (const [m, route] of [['GET', '/api/ideas'], ['POST', '/api/ideas'], ['POST', '/api/ideas/vote'], ['POST', '/api/ideas/status'], ['POST', '/api/ideas/delete']]) {
    assert.equal((await call(m, route, anon, m === 'GET' ? undefined : { title: 'x x x', id: 'x' })).status, 401, `${m} ${route}`);
  }
});

let first;
test('a friend posts an idea: cleaned, named by display name, never by uid, stored 0600', async () => {
  assert.equal((await call('POST', '/api/ideas', as(B), { title: 'ab' })).status, 400);
  const r = await call('POST', '/api/ideas', as(B), { title: '  Minuteur   de repos @bob ', body: 'Avec un son\nplus fort' });
  assert.equal(r.status, 201);
  first = r.body.idea;
  assert.equal(first.title, 'Minuteur de repos @bob');
  assert.equal(first.author, 'Sam Demo');
  assert.equal(first.mine, true);
  assert.ok(!JSON.stringify(r.body).includes(B), 'no uid');
  assert.equal(fs.statSync(ideasFile()).mode & 0o777, 0o600);
});

test('GitHub receives an anonymous, defused issue with the token, and the idea gets its link', async () => {
  assert.ok(await waitFor(async () => (await call('GET', '/api/ideas', as(B))).body.ideas.find(i => i.id === first.id)?.url));
  const sent = issues.find(i => i.body.title.includes('Minuteur'));
  assert.equal(sent.url, '/repos/demo-owner/demo-repo/issues');
  assert.equal(sent.auth, `Bearer ${TOKEN}`);
  assert.equal(sent.body.title, '[Idée] Minuteur de repos @​bob');
  assert.ok(!JSON.stringify(sent.body).includes('Sam'), 'the issue never names the author');
  assert.ok(!JSON.stringify(sent.body).includes(B), 'nor carries a uid');
  assert.match(sent.body.body, /^> Avec un son\n> plus fort/);
  assert.ok(!h.log.includes(TOKEN), 'the token is never logged');
});

test('everyone sees the box and +1s once; an unknown idea is 404', async () => {
  let r = await call('GET', '/api/ideas', as(C));
  const seen = r.body.ideas.find(i => i.id === first.id);
  assert.equal(seen.author, 'Sam Demo');
  assert.equal(seen.mine, false);
  assert.equal(r.body.github, true);
  r = await call('POST', '/api/ideas/vote', as(C), { id: first.id });
  assert.deepEqual([r.body.idea.votes, r.body.idea.voted], [1, true]);
  r = await call('POST', '/api/ideas/vote', as(C), { id: first.id });
  assert.deepEqual([r.body.idea.votes, r.body.idea.voted], [0, false]);
  assert.equal((await call('POST', '/api/ideas/vote', as(C), { id: 'nope' })).status, 404);
});

test('only the admin sets a status', async () => {
  assert.equal((await call('POST', '/api/ideas/status', as(B), { id: first.id, status: 'done' })).status, 403);
  assert.equal((await call('POST', '/api/ideas/status', as(A), { id: first.id, status: 'shipped' })).status, 400);
  const r = await call('POST', '/api/ideas/status', as(A), { id: first.id, status: 'done' });
  assert.equal(r.body.idea.status, 'done');
  assert.equal((await call('GET', '/api/ideas', as(A))).body.admin, true);
  assert.equal((await call('GET', '/api/ideas', as(B))).body.admin, false);
});

test('an idea GitHub refuses stays in the box and is retried; labels are dropped on a 422', async () => {
  const bad = (await call('POST', '/api/ideas', as(C), { title: 'FAIL please' })).body.idea;
  const nolabel = (await call('POST', '/api/ideas', as(C), { title: 'NOLABEL idea' })).body.idea;
  assert.ok(await waitFor(async () => (await call('GET', '/api/ideas', as(C))).body.ideas.find(i => i.id === nolabel.id)?.url));
  const tries = issues.filter(i => i.body.title.includes('NOLABEL'))
  assert.equal(tries.length, 2);
  assert.equal(tries[1].body.labels, undefined);
  const doc = JSON.parse(fs.readFileSync(ideasFile(), 'utf8'));
  assert.ok(doc.ideas.find(i => i.id === bad.id).tries >= 1);
  assert.equal(doc.ideas.find(i => i.id === bad.id).issue, null);
  assert.ok(!h.log.includes(TOKEN));
});

test('only its author or the admin takes an idea out; for anyone else it does not exist', async () => {
  const mine = (await call('POST', '/api/ideas', as(B), { title: 'Mode sombre auto' })).body.idea;
  assert.equal((await call('POST', '/api/ideas/delete', as(C), { id: mine.id })).status, 404);
  assert.equal((await call('POST', '/api/ideas/delete', as(B), { id: mine.id })).status, 200);
  const other = (await call('POST', '/api/ideas', as(B), { title: 'Graphique des pas' })).body.idea;
  assert.equal((await call('POST', '/api/ideas/delete', as(A), { id: other.id })).status, 200);
});

test('five ideas a day per friend', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/ideas', as(A), { title: `Idée numéro ${i}` });
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'per-day');
});

test('a cross-site write is refused, like every other state-changing route', async () => {
  const r = await call('POST', '/api/ideas', { ...as(B), 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' }, { title: 'pwned idea' });
  assert.equal(r.status, 403);
});

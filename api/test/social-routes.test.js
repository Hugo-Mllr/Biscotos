/* Biscotos circles and league against the real server.js in a child process.
 *
 * One authorization test per route: no session → 401; a circle the caller is not in → 404, the
 * same answer as an id that does not exist, with social.json unchanged; owner-only actions → 403
 * for a member. Plus what friends may see: never a uid, a weight or a food. Synthetic users only. */
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
const A = 'u_alex_demo', B = 'u_sam_demo', C = 'u_lou_demo';
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localDay();
const daysAgo = n => localDay(new Date(Date.now() - n * 86400000));

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' });
const anon = { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' };
const lift = (d, w) => ({ id: 'w' + d + w, d, start: Date.now(), entries: [{ id: 'bench', sets: [{ w, r: 5, done: true }] }] });

let h;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-social-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [A, B, C].map((id, i) => ({ id, name: ['Alex Demo', 'Sam Demo', 'Lou Demo'][i], created: new Date().toISOString() })),
    creds: [], subs: [], invites: []
  }));
  // Alex: an older bench and a heavier one today (a record); body weight that must never leak.
  fs.writeFileSync(path.join(dataDir, `state-${A}.json`), JSON.stringify({
    unit: 'kg', bodyweight: [{ d: TODAY, w: 81.3 }], workouts: [lift(daysAgo(40), 80), lift(TODAY, 84)]
  }));
  fs.writeFileSync(path.join(dataDir, `state-${B}.json`), JSON.stringify({ unit: 'kg', workouts: [lift(TODAY, 50)] }));
  fs.writeFileSync(path.join(dataDir, `nutrition-${B}.json`), JSON.stringify({ v: 1, goals: { kcal: 2000 }, log: [{ id: 'f1', d: TODAY, name: 'Secret snack', grams: 1000, per100: { kcal: 200 } }] }));
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
const socialFile = () => path.join(h.dataDir, 'social.json');
const snap = () => (fs.existsSync(socialFile()) ? fs.readFileSync(socialFile(), 'utf8') : null);

let circle;
test('Alex creates a circle, Sam joins with the code, Lou is not in it', async () => {
  let r = await call('POST', '/api/social/circles', as(A), { name: '  Les Biscotos  ' });
  assert.equal(r.status, 201);
  circle = r.body.circle;
  assert.equal(circle.name, 'Les Biscotos');
  assert.match(circle.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(fs.statSync(socialFile()).mode & 0o777, 0o600);

  r = await call('POST', '/api/social/join', as(B), { code: circle.code.toLowerCase().replace('-', ' '), prefs: { nutrition: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.circle.members.length, 2);
  assert.equal(r.body.circle.owner, false);
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes(A) && !raw.includes(B), 'members are named by key, never by uid');

  r = await call('GET', '/api/social', as(C));
  assert.deepEqual(r.body.circles, []);
});

test('a wrong or malformed code gets one answer', async () => {
  for (const code of ['ZZZZ-ZZZZ', 'nope', 42]) {
    const r = await call('POST', '/api/social/join', as(C), { code });
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'bad-code');
  }
});

test('the league: points from each member’s own data, and nothing private', async () => {
  const r = await call('GET', `/api/social/leaderboard?circle=${circle.id}`, as(B));
  assert.equal(r.status, 200);
  const alex = r.body.week.rows.find(x => x.name === 'Alex Demo');
  const sam = r.body.week.rows.find(x => x.name === 'Sam Demo');
  assert.equal(alex.breakdown.sessions, 10);
  assert.equal(alex.breakdown.records, 25);
  assert.equal(alex.breakdown.nutrition, null, 'Alex does not share nutrition');
  assert.equal(sam.breakdown.nutrition, 5, 'Sam shares it and hit the goal');
  assert.equal(alex.rank, 1);
  assert.equal(sam.me, true);
  const raw = JSON.stringify(r.body);
  for (const secret of ['81.3', 'Secret snack', 'bench', A, B]) assert.ok(!raw.includes(secret), `leaks ${secret}`);
  assert.ok(r.body.season.rows.every(x => typeof x.points === 'number'));
});

test('a member who stops sharing training shows no points at all', async () => {
  let r = await call('PUT', '/api/social/prefs', as(A), { training: false });
  assert.equal(r.status, 200);
  r = await call('GET', `/api/social/leaderboard?circle=${circle.id}`, as(B));
  const alex = r.body.week.rows.find(x => x.name === 'Alex Demo');
  assert.equal(alex.points, null);
  assert.equal(alex.breakdown, undefined);
  assert.equal(alex.streak, undefined);
  assert.equal((await call('PUT', '/api/social/prefs', as(A), { training: 'yes' })).status, 400);
  await call('PUT', '/api/social/prefs', as(A), { training: true });
});

test('every route: no session → 401', async () => {
  const routes = [['GET', '/api/social'], ['PUT', '/api/social/prefs'], ['POST', '/api/social/circles'], ['POST', '/api/social/join'],
    ['POST', '/api/social/leave'], ['POST', '/api/social/circles/update'], ['POST', '/api/social/circles/remove'],
    ['POST', '/api/social/circles/delete'], ['GET', `/api/social/leaderboard?circle=${circle.id}`],
    ['GET', `/api/social/gym?circle=${circle.id}`], ['POST', '/api/social/gym'], ['GET', `/api/social/challenge?circle=${circle.id}`], ['GET', '/api/social/ghosts?ex=bench'], ['GET', '/api/social/badges']];
  for (const [m, route] of routes) {
    const r = await call(m, route, anon, m === 'GET' ? undefined : { circle: circle.id, code: circle.code, name: 'x', training: true });
    assert.equal(r.status, 401, `${m} ${route}`);
  }
});

test('every circle route: a circle you are not in is 404, like one that does not exist, and nothing changes', async () => {
  const before = snap();
  for (const id of [circle.id, 'does-not-exist']) {
    assert.equal((await call('GET', `/api/social/leaderboard?circle=${id}`, as(C))).status, 404);
    assert.equal((await call('GET', `/api/social/gym?circle=${id}`, as(C))).status, 404);
    assert.equal((await call('GET', `/api/social/challenge?circle=${id}`, as(C))).status, 404);
    for (const route of ['/api/social/leave', '/api/social/circles/update', '/api/social/circles/remove', '/api/social/circles/delete']) {
      const r = await call('POST', route, as(C), { circle: id, name: 'Pwned', rotateCode: true, member: 'x' });
      assert.equal(r.status, 404, `${route} ${id}`);
    }
  }
  assert.equal(snap(), before);
});

test('owner-only actions are refused to a member (403), allowed to the owner', async () => {
  const members = (await call('GET', '/api/social', as(B))).body.circles[0].members;
  const alexKey = members.find(m => m.name === 'Alex Demo').member;
  const before = snap();
  for (const [route, body] of [['/api/social/circles/update', { name: 'Pwned' }], ['/api/social/circles/remove', { member: alexKey }], ['/api/social/circles/delete', {}]]) {
    assert.equal((await call('POST', route, as(B), { circle: circle.id, ...body })).status, 403, route);
  }
  assert.equal(snap(), before);
  const r = await call('POST', '/api/social/circles/update', as(A), { circle: circle.id, rotateCode: true });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.circle.code, circle.code);
  assert.equal((await call('POST', '/api/social/join', as(C), { code: circle.code })).status, 404, 'the old code stopped working');
  circle = r.body.circle;
});

test('the owner removes a member; a member leaves; the last one out deletes the circle', async () => {
  const sam = circle.members.find(m => m.name === 'Sam Demo').member;
  let r = await call('POST', '/api/social/circles/remove', as(A), { circle: circle.id, member: sam });
  assert.equal(r.status, 200);
  assert.equal(r.body.circle.members.length, 1);
  assert.equal((await call('GET', `/api/social/leaderboard?circle=${circle.id}`, as(B))).status, 404);
  r = await call('POST', '/api/social/join', as(B), { code: circle.code });
  assert.equal(r.status, 200);
  // the owner leaves: Sam inherits the circle
  assert.equal((await call('POST', '/api/social/leave', as(A), { circle: circle.id })).status, 200);
  r = await call('GET', '/api/social', as(B));
  assert.equal(r.body.circles[0].owner, true);
  assert.equal((await call('POST', '/api/social/leave', as(B), { circle: circle.id })).status, 200);
  assert.deepEqual(JSON.parse(snap()).circles, []);
});

test('limits: names are checked, five circles at most', async () => {
  assert.equal((await call('POST', '/api/social/circles', as(C), { name: '' })).status, 400);
  assert.equal((await call('POST', '/api/social/circles', as(C), { name: 'x'.repeat(41) })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/social/circles', as(C), { name: 'C' + i })).status, 201);
  assert.equal((await call('POST', '/api/social/circles', as(C), { name: 'one too many' })).status, 409);
});

test('nothing private reaches the server log', () => {
  for (const secret of ['Secret snack', '81.3']) assert.ok(!h.log.includes(secret));
});

test('the feed: friends’ workouts with name, length and record count — never a load — and reactions', async () => {
  // a fresh circle: Alex owns it, Sam joins (Lou stays out)
  const made = (await call('POST', '/api/social/circles', as(A), { name: 'Feed demo' })).body.circle;
  await call('POST', '/api/social/join', as(B), { code: made.code });
  let r = await call('GET', `/api/social/feed?circle=${made.id}`, as(B));
  assert.equal(r.status, 200);
  const alexToday = r.body.events.find(e => e.kind === 'workout' && e.name === 'Alex Demo' && e.d === TODAY);
  assert.ok(alexToday, 'Alex’s workout of today is there');
  assert.equal(alexToday.records, 1);
  const raw = JSON.stringify(r.body);
  for (const secret of ['bench', '81.3', '"w":', '"sets"', A, B, 'Secret snack']) assert.ok(!raw.includes(secret), `leaks ${secret}`);
  assert.deepEqual(alexToday.reactions, { counts: {}, mine: null });

  // Sam reacts, changes their mind, takes it back
  r = await call('POST', '/api/social/react', as(B), { circle: made.id, event: alexToday.id, emoji: '🔥' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.reactions, { counts: { '🔥': 1 }, mine: '🔥' });
  r = await call('POST', '/api/social/react', as(A), { circle: made.id, event: alexToday.id, emoji: '💪' });
  assert.deepEqual(r.body.reactions.counts, { '🔥': 1, '💪': 1 });
  r = await call('POST', '/api/social/react', as(B), { circle: made.id, event: alexToday.id, emoji: '🔥' });
  assert.deepEqual(r.body.reactions, { counts: { '💪': 1 }, mine: null });
  assert.equal((await call('POST', '/api/social/react', as(B), { circle: made.id, event: alexToday.id, emoji: '<script>' })).status, 400);
  assert.equal((await call('POST', '/api/social/react', as(B), { circle: made.id, event: 'made-up-event-id', emoji: '🔥' })).status, 404);

  // feed and react: no session 401, outsider 404 with nothing stored
  assert.equal((await call('GET', `/api/social/feed?circle=${made.id}`, anon)).status, 401);
  assert.equal((await call('POST', '/api/social/react', anon, { circle: made.id, event: alexToday.id, emoji: '🔥' })).status, 401);
  const before = snap();
  assert.equal((await call('GET', `/api/social/feed?circle=${made.id}`, as(C))).status, 404);
  assert.equal((await call('POST', '/api/social/react', as(C), { circle: made.id, event: alexToday.id, emoji: '🔥' })).status, 404);
  assert.equal(snap(), before);

  // a member who stops sharing training leaves the feed but for their arrival
  await call('PUT', '/api/social/prefs', as(A), { training: false });
  r = await call('GET', `/api/social/feed?circle=${made.id}`, as(B));
  assert.ok(!r.body.events.some(e => e.name === 'Alex Demo' && e.kind === 'workout'));
  assert.ok(r.body.events.some(e => e.name === 'Alex Demo' && e.kind === 'joined'));
  await call('PUT', '/api/social/prefs', as(A), { training: true });

  // the owner turns the wall of shame off; a member cannot
  assert.equal((await call('POST', '/api/social/circles/update', as(B), { circle: made.id, shame: false })).status, 403);
  r = await call('POST', '/api/social/circles/update', as(A), { circle: made.id, shame: false });
  assert.equal(r.body.circle.shame, false);
});

test('who is at the gym: opt-in, circle mates only, memory only, no uid', async () => {
  const mine = (await call('POST', '/api/social/circles', as(A), { name: 'Gym' })).body.circle;
  await call('POST', '/api/social/join', as(B), { code: mine.code });
  const gym = uid => call('GET', `/api/social/gym?circle=${mine.id}`, as(uid));
  assert.deepEqual((await gym(B)).body.here, []);
  assert.equal((await call('POST', '/api/social/gym', as(A), { in: 'yes' })).status, 400);
  const before = snap();
  let r = await call('POST', '/api/social/gym', as(A), { in: true });
  assert.deepEqual(r.body, { mine: true });
  assert.equal(snap(), before, 'presence is never written to disk');
  r = await gym(B);
  assert.equal(r.body.here.length, 1);
  assert.equal(r.body.here[0].name, 'Alex Demo');
  assert.equal(r.body.here[0].me, false);
  assert.equal(r.body.mine, false);
  assert.ok(!JSON.stringify(r.body).includes(A), 'named by key, never by uid');
  assert.equal((await gym(A)).body.here[0].me, true);
  assert.equal((await gym(C)).status, 404, 'not in the circle: same answer as unknown');
  await call('POST', '/api/social/gym', as(A), { in: false });
  assert.deepEqual((await gym(B)).body.here, []);
});

test('the challenge: derived from what members share, circle mates only, no uid', async () => {
  const mine = (await call('POST', '/api/social/circles', as(A), { name: 'Defi' })).body.circle;
  await call('POST', '/api/social/join', as(B), { code: mine.code });
  const before = snap();
  let r = await call('GET', `/api/social/challenge?circle=${mine.id}`, as(B));
  assert.equal(r.status, 200);
  assert.equal(r.body.challenge.members, 2);
  assert.ok(['sessions', 'records', 'plan'].includes(r.body.challenge.kind));
  assert.deepEqual(r.body.members.map(m => m.name).sort(), ['Alex Demo', 'Sam Demo']);
  assert.ok(Array.isArray(r.body.members.find(m => m.name === 'Alex Demo').badges));
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes(A) && !raw.includes(B), 'named by key, never by uid');
  assert.ok(!raw.includes('81.3'), 'no body weight');
  assert.equal(snap(), before, 'nothing is stored');
  // Sam stops sharing training: no badges for Sam, and one sharer is not a challenge.
  await call('PUT', '/api/social/prefs', as(B), { training: false });
  r = await call('GET', `/api/social/challenge?circle=${mine.id}`, as(A));
  assert.equal(r.body.challenge, null);
  assert.deepEqual(r.body.members.find(m => m.name === 'Sam Demo').badges, []);
  assert.equal((await call('GET', `/api/social/challenge?circle=${mine.id}`, as(C))).status, 404);
});

test('ghosts: only friends who turned lifts on, best set in kg, never the caller, checked ids', async () => {
  const mine = (await call('POST', '/api/social/circles', as(A), { name: 'Ghost' })).body.circle;
  await call('POST', '/api/social/join', as(B), { code: mine.code });
  await call('PUT', '/api/social/prefs', as(B), { training: true });
  const ghosts = uid => call('GET', '/api/social/ghosts?ex=bench,squat', as(uid));
  assert.deepEqual((await ghosts(B)).body.ghosts, {}, 'lifts are off by default');
  assert.equal((await call('GET', '/api/social', as(A))).body.prefs.lifts, false);
  assert.equal((await call('PUT', '/api/social/prefs', as(A), { lifts: true })).body.prefs.lifts, true);
  let r = await ghosts(B);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ghosts.bench, [{ name: 'Alex Demo', kg: 84, reps: 5, e1rm: 98, d: TODAY }]);
  assert.equal(r.body.ghosts.squat, undefined);
  assert.ok(!JSON.stringify(r.body).includes(A) && !JSON.stringify(r.body).includes('81.3'));
  assert.deepEqual((await ghosts(A)).body.ghosts, {}, 'Sam keeps lifts off; Alex never sees Alex');
  assert.deepEqual((await ghosts(C)).body.ghosts, {}, 'not a circle mate');
  await call('PUT', '/api/social/prefs', as(A), { training: false });
  assert.deepEqual((await ghosts(B)).body.ghosts, {}, 'no training shared, no ghost');
  await call('PUT', '/api/social/prefs', as(A), { training: true, lifts: false });
  for (const q of ['', '?ex=', '?ex=a%20b', '?ex=' + Array.from({ length: 31 }, (_, i) => 'e' + i).join(',')]) {
    assert.equal((await call('GET', '/api/social/ghosts' + q, as(B))).status, 400, q);
  }
});

test('badges: the caller\'s own, with the tiers, no circle needed', async () => {
  const r = await call('GET', '/api/social/badges', as(A));
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.badges));
  assert.deepEqual(Object.keys(r.body.tiers).sort(), ['records', 'sessions', 'streak']);
});

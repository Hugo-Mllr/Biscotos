/* Biscotos social notifications (createSocial's onStateSaved, tick and the reaction push) with
 * in-memory stand-ins for the server: no network, no child process. Synthetic profiles only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocial } from '../social/routes.js';
import { writeSocial } from '../social/store.js';
import { createWindow } from '../rate-limit.js';
import { recapPush } from '../social/push-copy.js';

const A = 'u_a', B = 'u_b', C = 'u_c';
const names = { [A]: 'Alex Demo', [B]: 'Sam Demo', [C]: 'Lou Demo' };
const lift = (id, d, w) => ({ id, d, start: Date.parse(d + 'T18:00:00Z'), end: Date.parse(d + 'T19:00:00Z'), name: 'Push', entries: [{ id: 'bench', sets: [{ w, r: 5, done: true }] }] });

function setup({ now = new Date('2026-10-19T09:30:00'), today = '2026-10-19', states = {}, prefs = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-hooks-'));
  const write = (f, s) => fs.writeFileSync(f, s);
  writeSocial(dataDir, {
    v: 1, prefs, reactions: {}, recaps: {},
    circles: [{ id: 'c1', name: 'Demo', ownerUid: A, code: 'ABCD-EFGH', createdAt: Date.parse('2026-09-01'), members: [A, B, C].map((uid, i) => ({ uid, joinedAt: Date.parse('2026-09-01') + i })) }],
  }, write);
  const pushes = [];
  const social = createSocial({
    json() {}, readBody: async () => ({}), readSession: () => null, tooMany() {}, createWindow, limitAddress: () => 'x', audit() {},
    dataDir, atomicWrite: write, secret: 'test-secret',
    userById: uid => (names[uid] ? { id: uid, name: names[uid] } : null),
    readState: uid => states[uid] || null, readNutrition: () => null,
    today: () => today, now: () => now,
    sendPush: (uid, payload) => { pushes.push({ uid, ...payload }); },
  });
  return { social, pushes, dataDir };
}

test('a new workout with a record tells the friends, once, and never the lifter', () => {
  const prev = { lang: 'fr', workouts: [lift('w1', '2026-10-01', 80)] };
  const next = { lang: 'fr', workouts: [...prev.workouts, lift('w2', '2026-10-19', 85)] };
  const { social, pushes } = setup({ states: { [B]: { lang: 'fr' }, [C]: { lang: 'en' } } });
  social.onStateSaved(A, prev, next);
  assert.deepEqual(pushes.map(p => p.uid).sort(), [B, C]);
  assert.equal(pushes.find(p => p.uid === B).body, '🏆 Alex Demo vient de battre un record perso');
  assert.equal(pushes.find(p => p.uid === C).body, '🏆 Alex Demo just set a personal record');
  assert.ok(pushes.every(p => !/85|80|bench/.test(p.body)), 'no load, no exercise');
  social.onStateSaved(A, next, next);
  assert.equal(pushes.length, 2, 'the same workout is never announced twice');
});

test('no record, an old backfilled workout, a profile not sharing records, a friend who muted: no push', () => {
  const base = { workouts: [lift('w1', '2026-10-01', 80)] };
  let s = setup();
  s.social.onStateSaved(A, base, { workouts: [...base.workouts, lift('w2', '2026-10-19', 70)] });
  s.social.onStateSaved(A, base, { workouts: [...base.workouts, lift('w3', '2026-10-10', 90)] });
  assert.equal(s.pushes.length, 0);
  s = setup({ prefs: { [A]: { prs: false } } });
  s.social.onStateSaved(A, base, { workouts: [...base.workouts, lift('w2', '2026-10-19', 85)] });
  assert.equal(s.pushes.length, 0);
  s = setup({ prefs: { [B]: { notify: false } } });
  s.social.onStateSaved(A, base, { workouts: [...base.workouts, lift('w2', '2026-10-19', 85)] });
  assert.deepEqual(s.pushes.map(p => p.uid), [C]);
});

test('the Monday recap: last week’s podium, once, from 9:00, to those who want it', () => {
  const states = {
    [A]: { lang: 'fr', workouts: [lift('a1', '2026-10-13', 80), lift('a2', '2026-10-14', 80)] },
    [B]: { lang: 'fr', workouts: [lift('b1', '2026-10-15', 50)] },
    [C]: { lang: 'fr', workouts: [] },
  };
  let s = setup({ now: new Date('2026-10-19T08:00:00'), states });
  assert.equal(s.social.tick(), 0, 'not before 9:00');
  s = setup({ now: new Date('2026-10-20T10:00:00'), today: '2026-10-20', states });
  assert.equal(s.social.tick(), 0, 'Mondays only');
  s = setup({ states, prefs: { [C]: { notify: false } } });
  assert.equal(s.social.tick(), 2);
  const body = s.pushes[0].body;
  assert.match(body, /^1\. Alex Demo 20 pts · 2\. Sam Demo 10 pts\n0 point : Lou Demo$/);
  assert.equal(s.pushes[0].title, '🏆 Demo : la semaine est finie');
  assert.equal(s.social.tick(), 0, 'once a week');
});

test('the recap names nobody on 0 when the wall of shame is off, or when nobody scored', () => {
  const rows = [{ name: 'A', points: 30, rank: 1 }, { name: 'B', points: 0, rank: 2 }];
  assert.ok(!recapPush('en', 'X', rows, false).body.includes('B'));
  assert.equal(recapPush('en', 'X', [{ name: 'B', points: 0, rank: 1 }], true).body, 'Nobody scored this week. New week, new chances!');
});

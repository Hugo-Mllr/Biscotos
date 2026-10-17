/* Badges and the weekly challenge: pure rules over synthetic profiles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgesOf, challengeOf, kindOf, CHALLENGES, MEMBER_CAP } from '../social/badges.js';
import { shiftDay } from '../social/score.js';

const TODAY = '2026-03-18';   // a Wednesday
const lift = (d, w, extra = {}) => ({ id: 'w' + d + w, d, start: 1, entries: [{ id: 'bench', sets: [{ w, r: 5, done: true }] }], ...extra });
const profile = (n, step = 1) => ({ workouts: Array.from({ length: n }, (_, i) => lift(shiftDay(TODAY, -i * step), 60 + i)) });

test('badges: the highest tier reached of each kind, nothing below the first step', () => {
  assert.deepEqual(badgesOf({ workouts: [] }, TODAY), []);
  assert.deepEqual(badgesOf(profile(9), TODAY).filter(b => b.id === 'sessions'), []);
  assert.deepEqual(badgesOf(profile(10), TODAY).filter(b => b.id === 'sessions'), [{ id: 'sessions', tier: 10 }]);
  assert.equal(badgesOf(profile(60), TODAY).find(b => b.id === 'sessions').tier, 50);
});

test('badges: a streak counts weeks in a row', () => {
  const four = { workouts: [0, 7, 14, 21].map(n => lift(shiftDay(TODAY, -n), 60)) };
  assert.deepEqual(badgesOf(four, TODAY).find(b => b.id === 'streak'), { id: 'streak', tier: 4 });
  assert.equal(badgesOf(profile(3, 7), TODAY).find(b => b.id === 'streak'), undefined);
});

test('badges: Strava workouts, the future and empty workouts earn nothing', () => {
  const ws = [...profile(10).workouts.map(w => ({ ...w, source: 'strava' })), lift(shiftDay(TODAY, 3), 60)];
  assert.deepEqual(badgesOf({ workouts: ws }, TODAY), []);
});

test('badges: the records badge disappears when records are not shared', () => {
  const S = { workouts: Array.from({ length: 12 }, (_, i) => lift(shiftDay(TODAY, -(11 - i) * 7), 60 + i * 5)) };
  assert.ok(badgesOf(S, TODAY, { prs: true }).some(b => b.id === 'records'));
  assert.ok(!badgesOf(S, TODAY, { prs: false }).some(b => b.id === 'records'));
});

test('challenge: needs two people who share training, and the three kinds take turns', () => {
  const monday = '2026-03-16';
  assert.equal(challengeOf(monday, []), null);
  assert.equal(challengeOf(monday, [{ workouts: 3, records: 1, plan: true }]), null);
  const seen = new Set(Array.from({ length: 3 }, (_, i) => kindOf(shiftDay(monday, i * 7))));
  assert.deepEqual([...seen].sort(), [...CHALLENGES].sort());
});

test('challenge: one person cannot carry the circle, and the goal scales with the circle', () => {
  const sessionsWeek = Array.from({ length: 3 }, (_, i) => shiftDay('2026-03-16', i * 7)).find(d => kindOf(d) === 'sessions');
  const lone = challengeOf(sessionsWeek, [{ workouts: 40, records: null, plan: false }, { workouts: 0, records: null, plan: false }]);
  assert.equal(lone.goal, 6);
  assert.equal(lone.progress, MEMBER_CAP.sessions);
  assert.equal(lone.done, false);
  const together = challengeOf(sessionsWeek, [{ workouts: 3 }, { workouts: 3 }]);
  assert.deepEqual([together.progress, together.goal, together.done], [6, 6, true]);
});

test('challenge: a records week falls back to sessions when fewer than two share records', () => {
  const recordsWeek = Array.from({ length: 3 }, (_, i) => shiftDay('2026-03-16', i * 7)).find(d => kindOf(d) === 'records');
  const c = challengeOf(recordsWeek, [{ workouts: 2, records: null, plan: false }, { workouts: 2, records: 1, plan: false }]);
  assert.equal(c.kind, 'sessions');
  const ok = challengeOf(recordsWeek, [{ workouts: 2, records: 2, plan: false }, { workouts: 2, records: 1, plan: false }]);
  assert.deepEqual([ok.kind, ok.goal, ok.progress, ok.done], ['records', 2, 3, true]);
});

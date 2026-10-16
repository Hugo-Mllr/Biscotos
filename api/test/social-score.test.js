/* Biscotos league rules (social/score.js) on synthetic workouts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekPoints, streakOf, weekOf, shiftDay, bestsOf, usableWorkouts, plannedPerWeek, seasonOf, POINTS } from '../social/score.js';

const MON = '2026-10-12';           // a Monday
const TODAY = '2026-10-16';         // the Friday after
let n = 0;
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra });
const wk = (d, entries, extra = {}) => ({ id: 'w' + (++n), d, start: Date.parse(d + 'T18:00:00Z'), entries, ...extra });
const ex = (id, ...sets) => ({ id, sets });

test('weeks start on Monday, whatever the weekday', () => {
  assert.equal(weekOf('2026-10-12'), MON);
  assert.equal(weekOf('2026-10-18'), MON);            // Sunday
  assert.equal(weekOf('2026-10-19'), '2026-10-19');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
});

test('a workout counts only with a completed work set; warm-ups, Strava and the future do not', () => {
  const S = { workouts: [
    wk('2026-10-13', [ex('squat', set(60, 5, { phase: 'warmup' }))]),
    wk('2026-10-13', [ex('squat', { w: 100, r: 5, done: false })]),
    wk('2026-10-14', [ex('squat', set(100, 5))], { source: 'strava' }),
    wk('2026-10-20', [ex('squat', set(100, 5))]),
    wk('2026-10-14', [ex('squat', { sides: { L: { w: 20, r: 10, done: true }, R: { w: 20, r: 10 } } })]),
  ] };
  assert.equal(usableWorkouts(S, TODAY).length, 1);
});

test('sessions: 10 each, at most two a day', () => {
  const S = { workouts: [1, 2, 3].map(() => wk('2026-10-13', [ex('bench', set(60, 8))])).concat(wk('2026-10-15', [ex('bench', set(60, 8))])) };
  const p = weekPoints(S, MON, { today: TODAY });
  assert.equal(p.breakdown.sessions, 3 * POINTS.SESSION);
  assert.equal(p.workouts, 4);
});

test('a record beats every earlier e1RM of the exercise; the first time ever is not one', () => {
  const S = { workouts: [
    wk('2026-09-01', [ex('bench', set(80, 5))]),
    wk('2026-10-13', [ex('bench', set(85, 5)), ex('row', set(70, 8))]),
  ] };
  const p = weekPoints(S, MON, { today: TODAY });
  assert.deepEqual(p.records, ['bench']);
  assert.equal(p.breakdown.records, POINTS.RECORD);
});

test('records are capped at five a week, sets past 12 reps and absurd loads are ignored', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const S = { workouts: [
    wk('2026-09-01', ids.map(id => ex(id, set(50, 5)))),
    wk('2026-10-13', [...ids.map(id => ex(id, set(55, 5))), ex('a', set(40, 20))]),
  ] };
  assert.equal(weekPoints(S, MON, { today: TODAY }).breakdown.records, 5 * POINTS.RECORD);
  assert.deepEqual(bestsOf(wk('2026-10-13', [ex('x', set(2000, 3)), ex('y', set(40, 20))])), {});
});

test('progress: the week against the four weeks before, relative to oneself', () => {
  const strong = { workouts: [wk('2026-10-05', [ex('squat', set(200, 5))]), wk('2026-10-13', [ex('squat', set(202, 5))])] };
  const novice = { workouts: [wk('2026-10-05', [ex('squat', set(40, 5))]), wk('2026-10-13', [ex('squat', set(41.2, 5))])] };
  assert.equal(weekPoints(strong, MON, { today: TODAY }).breakdown.progress, 10);   // +1 %
  assert.equal(weekPoints(novice, MON, { today: TODAY }).breakdown.progress, 30);   // +3 %: same as a big jump for the strong one
  const worse = { workouts: [wk('2026-10-05', [ex('squat', set(100, 5))]), wk('2026-10-13', [ex('squat', set(90, 5))])] };
  assert.equal(weekPoints(worse, MON, { today: TODAY }).breakdown.progress, 0);
});

test('plan: 40 when the week has as many workouts as the weekday plan has training days', () => {
  const S = { routines: [{ id: 'r1' }, { id: 'r2' }], week: { 1: ['r1'], 4: ['r2'], 6: ['gone'] }, workouts: [] };
  assert.equal(plannedPerWeek(S), 2);
  S.workouts = [wk('2026-10-12', [ex('a', set(10, 5))])];
  assert.equal(weekPoints(S, MON, { today: TODAY }).breakdown.plan, 0);
  S.workouts.push(wk('2026-10-15', [ex('a', set(10, 5))]));
  assert.equal(weekPoints(S, MON, { today: TODAY }).breakdown.plan, POINTS.PLAN);
  assert.equal(plannedPerWeek({ ...S, rotation: { id: 'x' } }), 0, 'a rotation has no weekday plan');
});

test('nutrition: 5 a day within ±10 % of the kcal goal, only when a document is passed', () => {
  const food = (d, grams) => ({ d, grams, per100: { kcal: 200 } });
  const nutrition = { goals: { kcal: 2000 }, log: [food('2026-10-12', 1000), food('2026-10-13', 1050), food('2026-10-14', 500), food('2026-10-20', 1000)] };
  const S = { workouts: [] };
  assert.equal(weekPoints(S, MON, { today: TODAY, nutrition }).breakdown.nutrition, 2 * POINTS.NUTRITION_DAY);
  assert.equal(weekPoints(S, MON, { today: TODAY }).breakdown.nutrition, 0);
});

test('streak: weeks in a row, this week may still be empty, one joker a month bridges a lone gap', () => {
  const on = d => wk(d, [ex('a', set(10, 5))]);
  assert.equal(streakOf({ workouts: [] }, TODAY).weeks, 0);
  // trained the three weeks before this one, nothing yet this week
  let s = streakOf({ workouts: [on('2026-09-22'), on('2026-09-29'), on('2026-10-06')] }, TODAY);
  assert.equal(s.weeks, 3);
  // a gap in the week of Monday 2026-09-28 (September), bridged by September's joker
  s = streakOf({ workouts: [on('2026-09-15'), on('2026-09-22'), on('2026-10-06'), on('2026-10-13')] }, TODAY);
  assert.equal(s.weeks, 4);
  assert.deepEqual(s.jokersUsed, ['2026-09-28']);
  assert.equal(s.jokerAvailable, true, "October's joker is still there");
  // two gaps in the same month: the second one ends the streak
  s = streakOf({ workouts: [on('2026-08-25'), on('2026-09-08'), on('2026-09-22'), on('2026-10-06')] }, TODAY);
  assert.equal(s.weeks, 2);
  // two missed weeks in a row are never bridged
  s = streakOf({ workouts: [on('2026-09-15'), on('2026-10-06')] }, TODAY);
  assert.equal(s.weeks, 1);
});

test('season: one entry per week, the last 52 at most', () => {
  const S = { workouts: [wk('2026-10-13', [ex('a', set(10, 5))])] };
  assert.equal(seasonOf(S, '2026-09-28', { today: TODAY }).length, 3);
  assert.equal(seasonOf(S, '2020-01-01', { today: TODAY }).length, 52);
});

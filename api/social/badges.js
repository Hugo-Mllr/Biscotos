/* Biscotos badges and the weekly circle challenge (docs/SOCIAL.md).
 *
 * Pure functions, derived on demand from what a profile already shares: nothing is stored, so
 * there is nothing to forge or to clean up when someone leaves a circle. Badges are milestones
 * over a profile's whole history (sessions, streak, records); the challenge is one goal a week
 * that the whole circle works on together, never against each other.
 *
 * Both go through usableWorkouts (score.js), so Strava workouts count for nothing here either. */
import { usableWorkouts, streakOf } from './score.js';
import { recordsByWorkout } from './feed.js';

export const TIERS = Object.freeze({
  sessions: [10, 50, 100, 250],
  streak: [4, 12, 26, 52],       // weeks in a row
  records: [10, 50, 100],
});

const reached = (n, steps) => steps.filter(s => n >= s);

/** [{ id: 'sessions', tier: 50 }, …]: the highest tier reached of each kind, in a stable order.
 *  `prs` false hides the records badge (a profile that does not share its records). */
export function badgesOf(S, today, { prs = true } = {}) {
  const out = [];
  const top = (id, n, steps) => { const r = reached(n, steps); if (r.length) out.push({ id, tier: r[r.length - 1] }); };
  top('sessions', usableWorkouts(S, today).length, TIERS.sessions);
  top('streak', streakOf(S, today).weeks, TIERS.streak);
  if (prs) top('records', Object.values(recordsByWorkout(S, today)).reduce((a, b) => a + b, 0), TIERS.records);
  return out;
}

export const CHALLENGES = Object.freeze(['sessions', 'records', 'plan']);
const WEEK_MS = 7 * 86400000;
export const MEMBER_CAP = Object.freeze({ sessions: 5, records: 3 });   // one person cannot carry the circle

/** The kind of challenge for the week starting `monday`: the three take turns. */
export const kindOf = monday => CHALLENGES[Math.floor(Date.parse(monday + 'T00:00:00Z') / WEEK_MS) % CHALLENGES.length];

/**
 * `rows`: what each member sharing training shows for the week, as { workouts, records (null when
 * not shared), plan (true when the week's plan was met) }. Fewer than two sharing members: no
 * challenge (null). The goal scales with the number of people who count.
 */
export function challengeOf(monday, rows) {
  const n = rows.length;
  if (n < 2) return null;
  const sessions = () => ({ goal: 3 * n, progress: rows.reduce((a, r) => a + Math.min(r.workouts || 0, MEMBER_CAP.sessions), 0) });
  let kind = kindOf(monday);
  const counting = rows.filter(r => r.records != null);
  if (kind === 'records' && counting.length < 2) kind = 'sessions';   // too few share records: a session week instead
  let res;
  if (kind === 'sessions') res = sessions();
  else if (kind === 'records') res = { goal: counting.length, progress: counting.reduce((a, r) => a + Math.min(r.records, MEMBER_CAP.records), 0) };
  else res = { goal: Math.ceil(n / 2), progress: rows.filter(r => r.plan).length };
  return { week: monday, kind, goal: res.goal, progress: res.progress, members: n, done: res.progress >= res.goal };
}

/* Biscotos league: points and streaks, computed from a profile's own documents (docs/SOCIAL.md).
 *
 * Pure functions over the openGym state document (state-<uid>.json) and the nutrition document:
 * nothing here reads a file, so every rule is a unit test away (test/social-score.test.js).
 *
 * The points reward effort against one's OWN level, never raw load: the strongest friend does
 * not win every week by default.
 *
 *   session           10 per workout with at least one completed work set, at most 2 a day
 *   record            25 per exercise whose best estimated 1RM this week beats everything
 *                     before it, at most 5 a week
 *   progress          up to 30: the week's best e1RM per exercise against the same exercise's
 *                     best of the 4 weeks before, averaged; +1 % = 10 points
 *   plan              40 when the week holds at least as many workouts as the weekly plan has
 *                     training days (a profile without a weekday plan gets none)
 *   nutrition         5 per day within ±10 % of the calorie goal, only for a profile sharing
 *                     nutrition, at most 35 a week
 *
 * Anything stamped `source: 'strava'` is never counted (Strava's terms forbid leaderboards):
 * filtered in usableWorkouts, the single door every rule goes through. Days after `today` are
 * ignored, and so are loads no human lifts (e1RM above 1000), so a typo cannot win a week.
 *
 * Weeks start on Monday for everyone in a circle and are named by that Monday ('YYYY-MM-DD'). */

export const POINTS = Object.freeze({
  SESSION: 10, SESSIONS_PER_DAY: 2,
  RECORD: 25, RECORDS_PER_WEEK: 5,
  PROGRESS_PER_PCT: 10, PROGRESS_MAX: 30, PROGRESS_WEEKS: 4,
  PLAN: 40,
  NUTRITION_DAY: 5, NUTRITION_TOLERANCE: 0.10,
});
export const REP_CAP = 12;          // e1RM from sets of 12 reps or fewer, as the app's records
export const E1RM_MAX = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- dates (UTC arithmetic on calendar days: no time zone can shift a day) ---------- */
const toMs = d => Date.parse(d + 'T00:00:00Z');
export const shiftDay = (d, n) => new Date(toMs(d) + n * 86400000).toISOString().slice(0, 10);
/** The Monday of `d`'s week. */
export function weekOf(d) {
  const wd = new Date(toMs(d)).getUTCDay();          // 0 = Sunday
  return shiftDay(d, -((wd + 6) % 7));
}
export const isDay = d => typeof d === 'string' && DAY.test(d) && Number.isFinite(toMs(d));

/* ---------- reading a workout ---------- */
const isWarmup = s => s?.phase === 'warmup' || (s?.phase == null && s?.warmup === true);
const sideDone = s => s && typeof s === 'object' && s.sides && typeof s.sides === 'object';
function doneRows(set) {
  if (isWarmup(set)) return [];
  if (sideDone(set)) return ['L', 'R'].map(k => set.sides[k]).filter(x => x?.done === true);
  return set?.done === true ? [set] : [];
}
const epley = (w, r) => w * (1 + r / 30);

/** Best estimated 1RM per exercise in one workout: { exerciseId: kg-or-lb }. */
export function bestsOf(workout) {
  const out = {};
  for (const e of Array.isArray(workout?.entries) ? workout.entries : []) {
    if (!e || typeof e.id !== 'string') continue;
    for (const set of Array.isArray(e.sets) ? e.sets : []) {
      for (const row of doneRows(set)) {
        const w = Number(row.w), r = Number(row.r);
        if (!(w > 0) || !(r >= 1) || r > REP_CAP) continue;
        const v = epley(w, r);
        if (v > E1RM_MAX) continue;
        if (!(out[e.id] >= v)) out[e.id] = v;
      }
    }
  }
  return out;
}

export const hasWork = w => (Array.isArray(w?.entries) ? w.entries : [])
  .some(e => (Array.isArray(e?.sets) ? e.sets : []).some(s => doneRows(s).length > 0));

/** The workouts that may count: dated, not in the future, not from Strava, with real work. */
export function usableWorkouts(S, today) {
  return (Array.isArray(S?.workouts) ? S.workouts : [])
    .filter(w => w && typeof w === 'object' && w.source !== 'strava' && isDay(w.d) && w.d <= today && hasWork(w))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)));
}

/** Training days in the weekday plan (0 when the profile has none, or runs a rotation). */
export function plannedPerWeek(S) {
  if (S?.queue || S?.rotation) return 0;
  const ids = new Set((Array.isArray(S?.routines) ? S.routines : []).map(r => r?.id));
  const week = S?.week && typeof S.week === 'object' ? S.week : {};
  let n = 0;
  for (let wd = 0; wd < 7; wd++) if ([].concat(week[wd] || []).some(id => ids.has(id))) n++;
  return n;
}

/* ---------- one week ---------- */

/**
 * The points of the week starting `monday`, with the detail behind them.
 * `opts.nutrition` (the nutrition document) is passed only when the profile shares nutrition.
 */
export function weekPoints(S, monday, { today, nutrition = null } = {}) {
  const end = shiftDay(monday, 6);
  const all = usableWorkouts(S, today);
  const inWeek = all.filter(w => w.d >= monday && w.d <= end);

  // sessions, at most 2 a day
  const perDay = {};
  let sessions = 0;
  for (const w of inWeek) {
    perDay[w.d] = (perDay[w.d] || 0) + 1;
    if (perDay[w.d] <= POINTS.SESSIONS_PER_DAY) sessions++;
  }

  // the best e1RM per exercise before the week, in the 4 weeks before it, and during it
  const before = {}, recent = {}, during = {};
  const recentFrom = shiftDay(monday, -7 * POINTS.PROGRESS_WEEKS);
  for (const w of all) {
    if (w.d > end) break;
    const b = bestsOf(w);
    for (const [id, v] of Object.entries(b)) {
      if (w.d < monday) {
        if (!(before[id] >= v)) before[id] = v;
        if (w.d >= recentFrom && !(recent[id] >= v)) recent[id] = v;
      } else if (!(during[id] >= v)) during[id] = v;
    }
  }
  // A record needs a history to beat: the first time an exercise is ever logged is not one.
  const records = Object.keys(during).filter(id => before[id] > 0 && during[id] > before[id]);
  const recordsCounted = Math.min(records.length, POINTS.RECORDS_PER_WEEK);

  const gains = Object.keys(during).filter(id => recent[id] > 0).map(id => (during[id] / recent[id] - 1) * 100);
  const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
  const progress = Math.max(0, Math.min(POINTS.PROGRESS_MAX, Math.round(avgGain * POINTS.PROGRESS_PER_PCT)));

  const planned = plannedPerWeek(S);
  const planDone = planned > 0 && inWeek.length >= planned;

  let nutritionDays = 0;
  const goal = Number(nutrition?.goals?.kcal);
  if (nutrition && goal > 0) {
    const byDay = {};
    for (const e of Array.isArray(nutrition.log) ? nutrition.log : []) {
      if (!e || !isDay(e.d) || e.d < monday || e.d > end || e.d > today) continue;
      const kcal = (Number(e.per100?.kcal) || 0) * (Number(e.grams) || 0) / 100;
      byDay[e.d] = (byDay[e.d] || 0) + kcal;
    }
    nutritionDays = Object.values(byDay).filter(k => Math.abs(k - goal) <= goal * POINTS.NUTRITION_TOLERANCE).length;
  }

  const breakdown = {
    sessions: sessions * POINTS.SESSION,
    records: recordsCounted * POINTS.RECORD,
    progress,
    plan: planDone ? POINTS.PLAN : 0,
    nutrition: nutritionDays * POINTS.NUTRITION_DAY,
  };
  return {
    week: monday,
    points: Object.values(breakdown).reduce((a, b) => a + b, 0),
    breakdown,
    workouts: inWeek.length,
    records: records.slice(0, POINTS.RECORDS_PER_WEEK),
    planned,
  };
}

/* ---------- streak ---------- */

/**
 * Consecutive weeks with at least one workout, ending this week (or last week, while this one
 * is still empty: a Monday morning does not break a streak). One joker a calendar month covers a
 * single missed week (the month of that week's Monday), applied on its own and walking back.
 * Returns { weeks, jokersUsed: ['YYYY-MM-DD', …] (the bridged Mondays), jokerAvailable }.
 */
export function streakOf(S, today, { maxWeeks = 520 } = {}) {
  const trained = new Set(usableWorkouts(S, today).map(w => weekOf(w.d)));
  const thisWeek = weekOf(today);
  let wk = trained.has(thisWeek) ? thisWeek : shiftDay(thisWeek, -7);
  const usedMonths = new Set();
  const jokersUsed = [];
  let weeks = 0;
  for (let i = 0; i < maxWeeks; i++) {
    if (trained.has(wk)) { weeks++; wk = shiftDay(wk, -7); continue; }
    const month = wk.slice(0, 7);
    const prev = shiftDay(wk, -7);
    // Bridge only a lone gap with a trained week behind it, once per month, and never the
    // start of a streak (nothing before it to join).
    if (weeks > 0 && !usedMonths.has(month) && trained.has(prev)) {
      usedMonths.add(month); jokersUsed.push(wk); wk = prev; continue;
    }
    break;
  }
  return { weeks, jokersUsed, jokerAvailable: !usedMonths.has(today.slice(0, 7)) };
}

/** Points of every week from `fromMonday` to the week of `today`, oldest first (the last 52). */
export function seasonOf(S, fromMonday, opts) {
  const out = [];
  const last = weekOf(opts.today);
  const floor = shiftDay(last, -7 * 51);
  let wk = weekOf(fromMonday) < floor ? floor : weekOf(fromMonday);
  while (wk <= last) { out.push(weekPoints(S, wk, opts)); wk = shiftDay(wk, 7); }
  return out;
}

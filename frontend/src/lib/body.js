// Biscotos: from a body profile to a daily calorie goal (views/BodyGoals.jsx).
//
// Pure helpers (body.test.js). The chain is: metabolism (BMR) → what a day costs → the goal for a
// mode (lose / maintain / gain / recomp). A day costs, in order of what is known about it:
//   health-active  Apple Health's active energy for the day was sent (the Shortcut): BMR + that
//   health-steps   only the steps were: BMR × 1.2, plus the steps above 3,000, plus the workouts
//   estimate       nothing came in: BMR × the activity level, plus the day's workouts
// Everything is an estimate and the screens say so; nothing here ever blocks typing a goal by hand.
import { workoutDuration, workoutVolume } from './history.js'

export const ACTIVITY = Object.freeze({ low: 1.2, mid: 1.35, high: 1.5 })   // daily life, the gym left out
export const KCAL_PER_KG = 7700
export const PACE_KG_WEEK = Object.freeze({
  cut: { gentle: 0.25, steady: 0.5, fast: 0.75 },
  bulk: { gentle: 0.1, steady: 0.25, fast: 0.4 },
})
export const PROTEIN_PER_KG = Object.freeze({ cut: 2.2, recomp: 2.2, maintain: 1.8, bulk: 1.8 })
const KCAL_FLOOR = 1200
const STEPS_FREE = 3000          // the walking already inside "BMR × 1.2"
const KCAL_PER_STEP_70KG = 0.04
const LB_TO_KG = 0.45359237

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = v => (Number.isFinite(+v) && v !== null && v !== '' ? +v : 0)
const ten = n => Math.round(n / 10) * 10

export const ageOf = (birthYear, year = new Date().getFullYear()) => (num(birthYear) > 1900 ? year - num(birthYear) : null)

/** Basal metabolism, kcal a day: Katch-McArdle when a body-fat share is known, else Mifflin-St Jeor. null when a number is missing. */
export function bmrOf({ sex, age, heightCm, weightKg, bodyFatPct } = {}) {
  const w = num(weightKg)
  if (!(w > 0)) return null
  if (num(bodyFatPct) > 0) return Math.round(370 + 21.6 * w * (1 - num(bodyFatPct) / 100))
  const h = num(heightCm), a = num(age)
  if (!(h > 0) || !(a > 0) || (sex !== 'm' && sex !== 'f')) return null
  return Math.round(10 * w + 6.25 * h - 5 * a + (sex === 'm' ? 5 : -161))
}

/**
 * kcal burnt by one logged workout above resting. Minutes × an intensity that rises with the
 * tonnage lifted per minute and per kg of body weight (MET 3 for a light session, 7 for a very
 * dense one). Without both ends of the session, or under 5 minutes, it counts for nothing.
 */
export function workoutKcal(w, { weightKg, unit = 'kg' } = {}) {
  const kg = num(weightKg)
  const minutes = Math.min(workoutDuration(w) / 60000, 180)
  if (!(kg > 0) || !(minutes >= 5)) return 0
  const tonnage = workoutVolume(w) * (unit === 'lb' ? LB_TO_KG : 1)
  const met = clamp(3 + 1.2 * (tonnage / (minutes * kg)), 3, 7)
  return Math.round((met - 1) * 3.5 * kg / 200 * minutes)
}

/**
 * What one day costs. `health` is what the Shortcut sent for that day: { activeKcal?, steps? }.
 * @returns {{ total, source: 'health-active'|'health-steps'|'estimate', parts: object }|null}
 */
export function dayCost({ bmr, activity = 'mid', workouts = [], weightKg, unit = 'kg', health = {} } = {}) {
  if (!(num(bmr) > 0)) return null
  const training = workouts.reduce((n, w) => n + workoutKcal(w, { weightKg, unit }), 0)
  const active = num(health.activeKcal), steps = num(health.steps)
  if (active > 0 && active <= 3000) {
    const base = Math.round(bmr * 1.1)
    return { total: base + Math.round(active), source: 'health-active', parts: { base, active: Math.round(active) } }
  }
  if (steps > 0 && steps <= 100000) {
    const base = Math.round(bmr * ACTIVITY.low)
    const walking = Math.round(Math.max(0, steps - STEPS_FREE) * KCAL_PER_STEP_70KG * (num(weightKg) || 70) / 70)
    return { total: base + walking + training, source: 'health-steps', parts: { base, walking, training } }
  }
  const base = Math.round(bmr * (ACTIVITY[activity] || ACTIVITY.mid))
  return { total: base + training, source: 'estimate', parts: { base, training } }
}

/** The goal for a mode on a day that costs `tdee`: { kcal, delta }. null for the manual mode. */
export function targetOf({ mode, pace = 'steady', tdee, bmr } = {}) {
  if (!(num(tdee) > 0) || !['cut', 'maintain', 'bulk', 'recomp'].includes(mode)) return null
  let delta = 0
  if (mode === 'cut') delta = -Math.min(Math.round((PACE_KG_WEEK.cut[pace] || PACE_KG_WEEK.cut.steady) * KCAL_PER_KG / 7), tdee * 0.25)
  if (mode === 'bulk') delta = Math.min(Math.round((PACE_KG_WEEK.bulk[pace] || PACE_KG_WEEK.bulk.steady) * KCAL_PER_KG / 7), tdee * 0.2)
  const floor = Math.max(num(bmr), KCAL_FLOOR)
  const kcal = Math.max(ten(tdee + delta), mode === 'cut' ? ten(floor) : 0)
  return { kcal, delta: kcal - Math.round(tdee) }
}

/** Grams a day: protein by body weight, fat at a quarter of the energy (0.8 g/kg at least), carbs the rest. */
export function macrosFor({ mode, kcal, weightKg } = {}) {
  const w = num(weightKg), k = num(kcal)
  if (!(w > 0) || !(k > 0) || !PROTEIN_PER_KG[mode]) return null
  const protein = Math.round(PROTEIN_PER_KG[mode] * w)
  const fat = Math.round(Math.max(0.8 * w, k * 0.25 / 9))
  return { protein, fat, carbs: Math.max(0, Math.round((k - 4 * protein - 9 * fat) / 4)) }
}

export const STEP_GOAL_DEFAULT = 10000
/** The daily steps goal: the one set in Body & goals, else 10,000. */
export const stepGoalOf = profile => (num(profile?.stepGoal) >= 1000 ? Math.round(num(profile.stepGoal)) : STEP_GOAL_DEFAULT)

/** What the Shortcut sent for one day, from the health-sample rows: { activeKcal?, steps? }. */
export function healthOf(samples) {
  const out = {}
  for (const s of samples || []) {
    if (s?.type === 'activeKcal') out.activeKcal = s.value
    if (s?.type === 'steps') out.steps = s.value
  }
  return out
}

/** Everything the body screen and the nutrition ring show, from the profile and the day. */
export function planFor({ profile = {}, weightKg, unit = 'kg', workouts = [], health = {}, year } = {}) {
  const age = ageOf(profile.birthYear, year)
  const bmr = bmrOf({ sex: profile.sex, age, heightCm: profile.heightCm, weightKg, bodyFatPct: profile.bodyFatPct })
  const bmiV = num(profile.heightCm) > 50 && num(weightKg) > 0 ? Math.round(num(weightKg) / (num(profile.heightCm) / 100) ** 2 * 10) / 10 : null
  const missing = []
  if (!(num(weightKg) > 0)) missing.push('weight')
  if (!(num(profile.bodyFatPct) > 0)) {
    if (!(num(profile.heightCm) > 0)) missing.push('height')
    if (!(age > 0)) missing.push('age')
    if (profile.sex !== 'm' && profile.sex !== 'f') missing.push('sex')
  }
  const cost = dayCost({ bmr, activity: profile.activity, workouts, weightKg, unit, health })
  // The shift toward what the body really did (observedTdee), only when the person turned it on.
  const tdee = cost ? cost.total + (profile.calibrate ? clamp(num(profile.calibration), -500, 500) : 0) : null
  const target = tdee ? targetOf({ mode: profile.goalMode, pace: profile.pace, tdee, bmr }) : null
  const macros = target ? macrosFor({ mode: profile.goalMode, kcal: target.kcal, weightKg }) : null
  return { age, bmi: bmiV, bmr, tdee, cost, target, macros, missing }
}

/**
 * The goals a day is held against: calculated from what the day costs when a goal is chosen in
 * Body & goals, else the ones typed by hand in Nutrition. `plan` is returned too, for the screens
 * that show where the number comes from.
 */
export function goalsFor({ profile = {}, goals = null, weightKg, unit, workouts, health, year } = {}) {
  const plan = planFor({ profile, weightKg, unit, workouts, health, year })
  const auto = !!plan.target && !!profile.goalMode && profile.goalMode !== 'manual'
  return { auto, plan, goals: auto ? { kcal: plan.target.kcal, ...(plan.macros || {}) } : goals || {} }
}

/**
 * What the body has really done over the last weeks: the average intake minus what the weight
 * trend says was stored (7,700 kcal a kg). Needs 4 weigh-ins over 14 days and 10 logged days.
 * @param weighIns [{ d, kg }]   @param intake [{ d, kcal }] one per logged day
 * @returns {{ observed, kgPerWeek, weighIns, loggedDays }|null}
 */
export function observedTdee({ weighIns = [], intake = [] } = {}) {
  const pts = weighIns.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && num(p.kg) > 0).sort((a, b) => (a.d < b.d ? -1 : 1))
  const days = intake.filter(p => num(p.kcal) >= 800)
  if (pts.length < 4 || days.length < 10) return null
  const t = d => Date.parse(d + 'T12:00:00Z') / 86400000
  const t0 = t(pts[0].d)
  if (t(pts[pts.length - 1].d) - t0 < 14) return null
  const n = pts.length
  const xs = pts.map(p => t(p.d) - t0), ys = pts.map(p => num(p.kg))
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (!(sxx > 0)) return null
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx          // kg a day
  const avg = days.reduce((a, p) => a + num(p.kcal), 0) / days.length
  return { observed: Math.round(avg - slope * KCAL_PER_KG), kgPerWeek: Math.round(slope * 7 * 100) / 100, weighIns: n, loggedDays: days.length }
}

/** How far to shift the estimate toward what was observed: the gap, within ±500 kcal. */
export const calibrationOf = (observed, estimated) => (num(observed) > 0 && num(estimated) > 0 ? clamp(Math.round(num(observed) - num(estimated)), -500, 500) : 0)

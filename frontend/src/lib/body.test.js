import { describe, expect, it } from 'vitest'
import { ageOf, healthOf, stepGoalOf, goalsFor, bmrOf, workoutKcal, dayCost, targetOf, macrosFor, planFor, observedTdee, calibrationOf } from './body.js'

const at = (d, h) => new Date(d + `T${String(h).padStart(2, '0')}:00:00`).getTime()
const session = (min, w = 100, r = 10, sets = 20) => ({ id: 'w', d: '2026-10-05', start: at('2026-10-05', 18), end: at('2026-10-05', 18) + min * 60000,
  entries: [{ id: 'bench', sets: Array.from({ length: sets }, () => ({ w, r, done: true })) }] })

describe('bmrOf', () => {
  it('Mifflin-St Jeor for a man and a woman', () => {
    expect(bmrOf({ sex: 'm', age: 27, heightCm: 180, weightKg: 80 })).toBe(1795)   // 800 + 1125 − 135 + 5
    expect(bmrOf({ sex: 'f', age: 27, heightCm: 165, weightKg: 60 })).toBe(1335)   // 600 + 1031.25 − 135 − 161
  })
  it('Katch-McArdle from the body-fat share, whatever the rest', () => {
    expect(bmrOf({ weightKg: 80, bodyFatPct: 15 })).toBe(1839)                      // 370 + 21.6 × 68
  })
  it('null when a number is missing', () => {
    expect(bmrOf({ sex: 'm', age: 27, weightKg: 80 })).toBe(null)
    expect(bmrOf({ sex: 'x', age: 27, heightCm: 180, weightKg: 80 })).toBe(null)
    expect(bmrOf({})).toBe(null)
  })
  it('the age from the birth year', () => {
    expect(ageOf(1999, 2026)).toBe(27)
    expect(ageOf(null, 2026)).toBe(null)
  })
})

describe('workoutKcal', () => {
  it('rises with the time and with how dense the session is', () => {
    const light = workoutKcal(session(60, 40, 10, 10), { weightKg: 80 })
    const dense = workoutKcal(session(60, 100, 10, 24), { weightKg: 80 })
    expect(light).toBeGreaterThan(200)
    expect(dense).toBeGreaterThan(light)
    expect(workoutKcal(session(120, 100, 10, 24), { weightKg: 80 })).toBeGreaterThan(dense)
  })
  it('a 60 min session of 12 × 60 kg × 10 at 80 kg is about 320 kcal', () => {
    expect(workoutKcal(session(60, 60, 10, 12), { weightKg: 80 })).toBe(319)
  })
  it('pounds count as pounds; no end, under 5 minutes or no weight is nothing', () => {
    const kg = workoutKcal(session(60, 100, 10, 20), { weightKg: 80, unit: 'kg' })
    expect(workoutKcal(session(60, 100, 10, 20), { weightKg: 80, unit: 'lb' })).toBeLessThan(kg)
    expect(workoutKcal({ ...session(60), end: undefined }, { weightKg: 80 })).toBe(0)
    expect(workoutKcal(session(4), { weightKg: 80 })).toBe(0)
    expect(workoutKcal(session(60), {})).toBe(0)
  })
})

describe('dayCost', () => {
  const base = { bmr: 1800, activity: 'mid', weightKg: 70, workouts: [] }
  it('estimate: BMR × activity, plus the workouts', () => {
    expect(dayCost(base)).toMatchObject({ total: 2430, source: 'estimate' })
    const w = workoutKcal(session(60), { weightKg: 70 })
    expect(dayCost({ ...base, workouts: [session(60)] }).total).toBe(2430 + w)
  })
  it('steps: BMR × 1.2, the steps above 3,000, the workouts', () => {
    const c = dayCost({ ...base, health: { steps: 11000 } })
    expect(c).toMatchObject({ source: 'health-steps', parts: { base: 2160, walking: 320, training: 0 }, total: 2480 })
  })
  it('active energy wins over steps, and replaces the workouts', () => {
    const c = dayCost({ ...base, workouts: [session(60)], health: { activeKcal: 650, steps: 11000 } })
    expect(c).toMatchObject({ source: 'health-active', total: 1980 + 650 })
  })
  it('an absurd value from the Shortcut is ignored', () => {
    expect(dayCost({ ...base, health: { activeKcal: 90000 } }).source).toBe('estimate')
    expect(dayCost({ ...base, health: { steps: 9e6 } }).source).toBe('estimate')
  })
  it('null without a BMR', () => expect(dayCost({ ...base, bmr: null })).toBe(null))
})

describe('targetOf and macrosFor', () => {
  it('cut and bulk follow the pace, within a quarter and a fifth of the day', () => {
    expect(targetOf({ mode: 'cut', pace: 'steady', tdee: 2600, bmr: 1800 })).toEqual({ kcal: 2050, delta: -550 })   // 0.5 kg a week = 550 a day
    expect(targetOf({ mode: 'bulk', pace: 'steady', tdee: 2600, bmr: 1800 }).delta).toBe(280)
    expect(targetOf({ mode: 'cut', pace: 'fast', tdee: 2000, bmr: 1500 }).kcal).toBe(1500)                        // −25 % at most
  })
  it('never under the floor when cutting', () => {
    expect(targetOf({ mode: 'cut', pace: 'fast', tdee: 1500, bmr: 1400 }).kcal).toBe(1400)   // the BMR, above the 1,200 floor
  })
  it('maintain and recomp eat what the day costs; manual has no target', () => {
    expect(targetOf({ mode: 'maintain', tdee: 2433, bmr: 1800 })).toEqual({ kcal: 2430, delta: -3 })
    expect(targetOf({ mode: 'recomp', tdee: 2500, bmr: 1800 }).delta).toBe(0)
    expect(targetOf({ mode: 'manual', tdee: 2500 })).toBe(null)
    expect(targetOf({ mode: 'cut', tdee: 0 })).toBe(null)
  })
  it('macros: protein by weight, a quarter of the energy in fat, carbs the rest', () => {
    expect(macrosFor({ mode: 'cut', kcal: 2000, weightKg: 80 })).toEqual({ protein: 176, fat: 64, carbs: 180 })
    expect(macrosFor({ mode: 'bulk', kcal: 3000, weightKg: 80 })).toEqual({ protein: 144, fat: 83, carbs: 419 })
    expect(macrosFor({ mode: 'cut', kcal: 600, weightKg: 80 }).carbs).toBe(0)
    expect(macrosFor({ mode: 'manual', kcal: 2000, weightKg: 80 })).toBe(null)
  })
})

describe('planFor', () => {
  const profile = { heightCm: 180, birthYear: 1999, sex: 'm', activity: 'mid', goalMode: 'cut', pace: 'steady' }
  it('puts the chain together', () => {
    const p = planFor({ profile, weightKg: 80, year: 2026 })
    expect(p).toMatchObject({ age: 27, bmi: 24.7, bmr: 1795, tdee: 2423, missing: [] })
    expect(p.target.kcal).toBe(1870)
    expect(p.macros.protein).toBe(176)
  })
  it('says what is missing and still answers with what it can', () => {
    const p = planFor({ profile: { heightCm: 180 }, weightKg: 80, year: 2026 })
    expect(p.missing).toEqual(['age', 'sex'])
    expect(p.bmr).toBe(null)
    expect(p.bmi).toBe(24.7)
    expect(planFor({ profile, year: 2026 }).missing).toEqual(['weight'])
    expect(planFor({ profile: { bodyFatPct: 15 }, weightKg: 80 }).missing).toEqual([])
  })
  it('the calibration only counts when the profile asks for it', () => {
    expect(planFor({ profile: { ...profile, calibration: 150 }, weightKg: 80, year: 2026 }).tdee).toBe(2423)
    expect(planFor({ profile: { ...profile, calibrate: true, calibration: 150 }, weightKg: 80, year: 2026 }).tdee).toBe(2573)
  })
  it('manual mode computes the cost but sets no goal', () => {
    const p = planFor({ profile: { ...profile, goalMode: 'manual' }, weightKg: 80, year: 2026 })
    expect(p.tdee).toBe(2423)
    expect(p.target).toBe(null)
  })
})

describe('observedTdee', () => {
  const days = n => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10))
  it('intake minus what the weight trend stored', () => {
    // 28 days at 2,500 kcal while the weight falls 0.5 kg a week: the body burnt 2,500 + 550
    const weighIns = days(29).filter((_, i) => i % 7 === 0).map((d, i) => ({ d, kg: 80 - 0.5 * i }))
    const o = observedTdee({ weighIns, intake: days(28).map(d => ({ d, kcal: 2500 })) })
    expect(o.kgPerWeek).toBe(-0.5)
    expect(o.observed).toBe(3050)
  })
  it('needs enough weigh-ins, enough span and enough logged days', () => {
    const intake = days(28).map(d => ({ d, kcal: 2500 }))
    const w = days(29).filter((_, i) => i % 7 === 0).map((d, i) => ({ d, kg: 80 - i }))
    expect(observedTdee({ weighIns: w.slice(0, 3), intake })).toBe(null)
    expect(observedTdee({ weighIns: [{ d: days(1)[0], kg: 80 }, ...days(10).slice(1, 4).map(d => ({ d, kg: 80 }))], intake })).toBe(null)
    expect(observedTdee({ weighIns: w, intake: intake.slice(0, 9) })).toBe(null)
    expect(observedTdee({ weighIns: w, intake: intake.map(p => ({ ...p, kcal: 300 })) })).toBe(null)   // a day of 300 kcal is a day not logged
  })
  it('the calibration is the gap, kept within 500', () => {
    expect(calibrationOf(2700, 2500)).toBe(200)
    expect(calibrationOf(4000, 2500)).toBe(500)
    expect(calibrationOf(1500, 2500)).toBe(-500)
    expect(calibrationOf(null, 2500)).toBe(0)
  })
})

describe('stepGoalOf and goalsFor', () => {
  it('10,000 steps unless the profile says otherwise', () => {
    expect(stepGoalOf({})).toBe(10000)
    expect(stepGoalOf(null)).toBe(10000)
    expect(stepGoalOf({ stepGoal: 7500 })).toBe(7500)
    expect(stepGoalOf({ stepGoal: 12 })).toBe(10000)
  })
  const profile = { heightCm: 180, birthYear: 1999, sex: 'm', activity: 'mid', goalMode: 'cut', pace: 'steady' }
  it('the calculated goal when one is chosen, the typed one for Manual or a profile too short to compute', () => {
    const typed = { kcal: 2000, protein: 150 }
    expect(goalsFor({ profile, goals: typed, weightKg: 80, year: 2026 })).toMatchObject({ auto: true, goals: { kcal: 1870, protein: 176 } })
    expect(goalsFor({ profile: { ...profile, goalMode: 'manual' }, goals: typed, weightKg: 80, year: 2026 })).toMatchObject({ auto: false, goals: typed })
    expect(goalsFor({ profile: { goalMode: 'cut' }, goals: typed, weightKg: 80 })).toMatchObject({ auto: false, goals: typed })
    expect(goalsFor({}).goals).toEqual({})
  })
})

describe('healthOf', () => {
  it('keeps the active energy and the steps of a day', () => {
    expect(healthOf([{ type: 'steps', value: 9120 }, { type: 'activeKcal', value: 640 }, { type: 'weight', value: 80 }])).toEqual({ steps: 9120, activeKcal: 640 })
    expect(healthOf(null)).toEqual({})
  })
})

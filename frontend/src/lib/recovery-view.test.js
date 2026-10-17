import { describe, expect, it } from 'vitest'
import { FATIGUE_STATES, fatigueOf, strengthOf } from './recovery.js'
import { fatigueStateOf, readinessOf, profileBodyweightKg } from './recovery-view.js'
import { MUSCLES, levelsOf } from './muscles.js'

const FATIGUE_BANDS = [
  { at: 0, level: 4 },
  { at: 0.25, level: 2 },
  { at: 0.5, level: 0, exclusive: true },
]
const STRENGTH_BANDS = [
  { at: 0.5, level: 0 },
  { at: 0.625, level: 1 },
  { at: 0.75, level: 2 },
  { at: 0.875, level: 3 },
  { at: 1, level: 4 },
]

describe('production recovery view selectors', () => {
  it('preserves the relative balance scale when no thresholds are supplied', () => {
    const levels = levelsOf({ chest: 10, biceps: 5 })
    expect(levels.chest).toBe(4)
    expect(levels.biceps).toBe(2)
  })

  it('uses the production fatigue selector at both approved boundaries', () => {
    expect(fatigueStateOf(0.2499)).toBe(FATIGUE_STATES.READY)
    expect(fatigueStateOf(0.25)).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(0.5)).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(0.5001)).toBe(FATIGUE_STATES.FATIGUED)
  })

  it('renders fatigue bands on a fixed absolute scale rather than relative to the map maximum', () => {
    const levels = levelsOf({
      chest: 0.25,
      biceps: 0.6,
      triceps: 0.1,
    }, FATIGUE_BANDS)
    expect(levels.chest).toBe(2)
    expect(levels.biceps).toBe(0)
    expect(levels.triceps).toBe(4)
  })

  it('renders strength on fixed .5-to-1 bands with full retention at l4', () => {
    const levels = levelsOf({ chest: 0.9, biceps: 1, triceps: 0.5 }, STRENGTH_BANDS)
    expect(levels.chest).toBe(3)
    expect(levels.biceps).toBe(4)
    expect(levels.triceps).toBe(0)
  })

  it('keeps selectors tied to the same render-time clock', () => {
    const now = Date.UTC(2026, 0, 22)
    const workout = { start: now - 15 * 86400000, d: '2026-01-07', entries: [] }
    expect(strengthOf([workout], now).chest).toBe(0.5)
    expect(fatigueOf([workout], now).chest).toBe(0)
    expect(strengthOf([workout], now + 7 * 86400000).chest).toBe(0.5)
  })
})

describe('readinessOf', () => {
  it('is fully fresh with nothing trained, and says so', () => {
    expect(readinessOf({ chest: 0, quadriceps: 0 })).toEqual({ score: 100, state: FATIGUE_STATES.READY, tired: [] })
    expect(readinessOf({})).toEqual({ score: 100, state: FATIGUE_STATES.READY, tired: [] })
    expect(readinessOf(undefined).score).toBe(100)
  })

  it('averages the four most fatigued muscles: one tired muscle does not sink the day', () => {
    const one = readinessOf({ quadriceps: 0.9, chest: 0, biceps: 0, triceps: 0, abs: 0 })
    expect(one.score).toBe(78)                       // mean of (.9, 0, 0, 0) = .225
    expect(one.state).toBe(FATIGUE_STATES.READY)
    expect(one.tired).toEqual(['quadriceps'])        // still named, so the person can go easy on it
    const all = readinessOf({ quadriceps: 0.9, gluteal: 0.8, hamstring: 0.7, chest: 0.6, abs: 0.1 })
    expect(all.score).toBe(25)                       // mean of (.9, .8, .7, .6) = .75
    expect(all.state).toBe(FATIGUE_STATES.FATIGUED)
    expect(all.tired).toEqual(['quadriceps', 'gluteal', 'hamstring'])   // three at most, most tired first
  })

  it('uses the state boundaries of the fatigue view and clamps odd values', () => {
    expect(readinessOf({ a: 0.3, b: 0.3, c: 0.3, d: 0.3 }).state).toBe(FATIGUE_STATES.RECOVERING)
    expect(readinessOf({ a: 5 }).score).toBe(0)
    expect(readinessOf({ a: -2 }).score).toBe(100)
    expect(readinessOf({ a: NaN, b: 0.5 }).score).toBe(50)
  })
})

describe('profileBodyweightKg', () => {
  it('is the latest weigh-in in kg, converting pounds, and null without one', () => {
    expect(profileBodyweightKg({ unit: 'kg', bodyweight: [{ d: '2026-03-02', w: 80 }, { d: '2026-03-01', w: 90 }] })).toBe(80)
    expect(profileBodyweightKg({ unit: 'lb', bodyweight: [{ d: '2026-03-01', w: 100 }] })).toBeCloseTo(45.359237, 5)
    expect(profileBodyweightKg({ bodyweight: [] })).toBeNull()
    expect(profileBodyweightKg({ bodyweight: [{ d: '2026-03-01', w: 0 }] })).toBeNull()
    expect(profileBodyweightKg(undefined)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { wrappedOf, wrappedYears } from './wrapped.js'

let n = 0
const at = (d, h) => new Date(d + `T${String(h).padStart(2, '0')}:00:00`).getTime()
const wk = (d, entries, { h = 18, min = 60 } = {}) => ({ id: 'w' + (++n), d, start: at(d, h), end: at(d, h) + min * 60000, entries })
const ex = (id, ...sets) => ({ id, sets: sets.map(([w, r, extra]) => ({ w, r, done: true, ...extra })) })

const S = { unit: 'kg', workouts: [
  wk('2025-12-29', [ex('bench', [80, 5])]),                                  // last year: the bar to beat
  wk('2026-01-05', [ex('bench', [80, 5]), ex('squat', [100, 5])], { h: 7 }), // Monday
  wk('2026-01-12', [ex('bench', [85, 5]), ex('squat', [100, 5, { warmup: true }])], { h: 8, min: 45 }),
  wk('2026-01-14', [ex('bench', [90, 5])], { h: 7 }),
  wk('2026-03-02', [ex('squat', [120, 5])], { min: 30 }),
  wk('2027-01-04', [ex('bench', [200, 5])]),                                 // next year: never counted
] }

describe('wrappedOf', () => {
  const y = wrappedOf(S, 2026)
  it('counts the year only', () => {
    expect(y.sessions).toBe(4)
    expect(y.days).toBe(4)
    expect(y.minutes).toBe(60 + 45 + 60 + 30)
    expect(y.sets).toBe(5)                     // the warm-up is not a set
    expect(y.volume).toBe(400 + 500 + 425 + 450 + 600)
  })
  it('top exercises, records against all history, the biggest gain', () => {
    expect(y.topExercises).toEqual([{ id: 'bench', sessions: 3 }, { id: 'squat', sessions: 2 }])
    expect(y.records).toBe(3)                  // bench 85, bench 90, squat 120 (bench 80 ties last year)
    expect(y.progress.id).toBe('squat')
    expect(y.progress.pct).toBe(20)          // squat 100 → 120 beats bench 80 → 90
  })
  it('the streak, the busiest month, the favourite day and time', () => {
    expect(y.longestStreak).toBe(2)            // the weeks of Jan 5 and Jan 12
    expect(y.busiestMonth).toBe(0)
    expect(y.favoriteWeekday).toBe(1)          // Monday
    expect(y.timeOfDay).toBe('morning')
  })
  it('null for a year without workouts; the years, newest first', () => {
    expect(wrappedOf(S, 2024)).toBe(null)
    expect(wrappedYears(S)).toEqual([2027, 2026, 2025])
    expect(wrappedYears({ workouts: [] })).toEqual([])
  })
})

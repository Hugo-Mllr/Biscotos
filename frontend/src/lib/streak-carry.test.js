import { describe, expect, it } from 'vitest'
import { cleanCarry, carriedWeekKeys, carryFor, CARRY_MAX_WEEKS } from './streak-carry.js'
import { streakWeeks } from './history.js'
import { weekKey } from './format.js'

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return iso(d) }
const wk = d => ({ id: 'w' + d, d, start: Date.parse(d + 'T18:00:00'), end: Date.parse(d + 'T19:00:00'), entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] }] })
const S = (extra = {}) => ({ workouts: [], ...extra })

describe('cleanCarry', () => {
  it('a whole number of weeks from 1 to 520 and a real day, or nothing', () => {
    expect(cleanCarry({ weeks: '12.7', through: '2026-10-14' })).toEqual({ weeks: 12, through: '2026-10-14' })
    expect(cleanCarry({ weeks: 9000, through: '2026-10-14' }).weeks).toBe(CARRY_MAX_WEEKS)
    for (const bad of [null, {}, { weeks: 0, through: '2026-10-14' }, { weeks: 5, through: 'yesterday' }, { weeks: 5, through: '2026-13-45' }, { weeks: 'x', through: '2026-10-14' }, 'x']) expect(cleanCarry(bad)).toBe(null)
  })
  it('carryFor: the weeks end with last week', () => {
    expect(carryFor(8, '2026-10-22')).toEqual({ weeks: 8, through: '2026-10-15' })
    expect(carryFor(0, '2026-10-22')).toBe(null)
  })
  it('carriedWeekKeys: one key per week, going back from the week of `through`', () => {
    const keys = carriedWeekKeys({ weeks: 3, through: '2026-10-15' }, 1)
    expect(keys).toEqual(['2026-10-12', '2026-10-05', '2026-09-28'])
    expect(carriedWeekKeys(null, 1)).toEqual([])
  })
})

describe('streakWeeks with a carried streak', () => {
  it('a carried streak alone is the streak, until a week goes by without training', () => {
    expect(streakWeeks(S({ streakCarry: carryFor(12) }))).toBe(12)
    expect(streakWeeks(S({ streakCarry: { weeks: 12, through: daysAgo(21) } }))).toBe(0)   // two empty weeks since: broken
  })
  it('a workout this week continues it', () => {
    expect(streakWeeks(S({ streakCarry: carryFor(12), workouts: [wk(daysAgo(0))] }))).toBe(13)
  })
  it('weeks logged here and carried ones are not counted twice', () => {
    expect(streakWeeks(S({ streakCarry: carryFor(5), workouts: [wk(daysAgo(7)), wk(daysAgo(14))] }))).toBe(5)
  })
  it('none without it, as before', () => {
    expect(streakWeeks(S())).toBe(0)
    expect(streakWeeks(S({ workouts: [wk(daysAgo(0)), wk(daysAgo(7))] }))).toBe(2)
    expect(weekKey(daysAgo(0), 1)).toBeTruthy()
  })
})

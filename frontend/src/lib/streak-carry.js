// Biscotos: carrying over a streak started in another app (Basic-Fit…): "I did N weeks in a row, up
// to last week". The profile keeps { weeks: N, through: 'YYYY-MM-DD' } — through is a day of the last
// week counted — and those N weeks count as trained weeks in the streak, next to the ones logged here,
// so this week's workout continues the run. Nothing else counts them: no points, no workouts.
// api/social/score.js reads the same field for the league, the badges and the widget.
import { weekKey, isoOf, todayISO } from './format.js'

export const CARRY_MAX_WEEKS = 520
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A clean { weeks, through } or null: a whole number of weeks from 1 to 520 and a real day. */
export function cleanCarry(c) {
  if (!c || typeof c !== 'object') return null
  const weeks = Math.floor(Number(c.weeks))
  if (!(weeks >= 1) || !DAY.test(String(c.through)) || Number.isNaN(Date.parse(c.through + 'T12:00:00'))) return null
  return { weeks: Math.min(weeks, CARRY_MAX_WEEKS), through: c.through }
}

/** The carried weeks as week keys (`weekKey(·, ws)`), the newest `through`'s week first. */
export function carriedWeekKeys(carry, ws) {
  const c = cleanCarry(carry)
  if (!c) return []
  const d = new Date(c.through + 'T12:00:00')
  const out = []
  for (let i = 0; i < c.weeks; i++) { out.push(weekKey(isoOf(d), ws)); d.setDate(d.getDate() - 7) }
  return out
}

/** The carry to save for "N weeks up to last week", entered today: through = a day of last week. */
export function carryFor(weeks, today = todayISO()) {
  const d = new Date(today + 'T12:00:00')
  d.setDate(d.getDate() - 7)
  return cleanCarry({ weeks, through: isoOf(d) })
}

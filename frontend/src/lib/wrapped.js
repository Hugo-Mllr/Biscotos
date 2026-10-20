// Biscotos Wrapped: a profile's year at the gym, in a handful of numbers (views/Wrapped.jsx).
// Pure: everything comes from the profile's own workouts, nothing leaves the device.
import { workoutDay, workoutDuration, workoutVolume } from './history.js'
import { hasCompletedWork, isWarmupRow, isSideSet } from './workout-model.js'
import { bestSetOf, formulaOf } from './onerm.js'

const at = w => Date.parse(workoutDay(w) + 'T12:00:00')
// Monday of the week of `day`, as a day number since the epoch (weeks are Monday-based here).
const weekNo = day => { const t = Date.parse(day + 'T12:00:00Z') / 86400000; return Math.floor((t + 3) / 7) }

const doneWorkSets = e => (Array.isArray(e?.sets) ? e.sets : []).filter(s => !isWarmupRow(s))
  .reduce((n, s) => n + (isSideSet(s) ? (s.sides.L?.done ? 1 : 0) + (s.sides.R?.done ? 1 : 0) : (s.done ? 1 : 0)), 0)

/** The years with at least one workout, newest first. */
export function wrappedYears(S) {
  const ys = new Set()
  for (const w of S?.workouts || []) { const d = workoutDay(w); if (d) ys.add(Number(d.slice(0, 4))) }
  return [...ys].sort((a, b) => b - a)
}

const argmax = counts => {
  let best = null
  counts.forEach((n, i) => { if (n > 0 && (best === null || n > counts[best])) best = i })
  return best
}

/**
 * The year `year` of profile `S`. null when it holds no workout.
 * @returns {{ year, sessions, minutes, volume, sets, days, topExercises: {id, sessions}[], records,
 *   progress: {id, from, to, pct}|null, longestStreak, busiestMonth, favoriteWeekday, timeOfDay }}
 */
export function wrappedOf(S, year) {
  const formula = formulaOf(S)
  const all = (S?.workouts || []).filter(w => workoutDay(w)).sort((a, b) => at(a) - at(b) || (a.start || 0) - (b.start || 0))
  const ws = all.filter(w => workoutDay(w).startsWith(year + '-'))
  if (!ws.length) return null

  let minutes = 0, volume = 0, sets = 0, records = 0
  const days = new Set(), perEx = new Map(), months = Array(12).fill(0), weekdays = Array(7).fill(0), hours = []
  const firstOfYear = new Map(), bestOfYear = new Map(), bestBefore = new Map()

  for (const w of all) {
    const d = workoutDay(w), inYear = d.startsWith(year + '-')
    if (d > `${year}-12-31`) break
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e?.id) continue
      const b = bestSetOf(e, formula)
      if (b) {
        const prev = bestBefore.get(e.id)
        if (inYear && prev !== undefined && b.est > prev) records++
        if (prev === undefined || b.est > prev) bestBefore.set(e.id, b.est)
        if (inYear) {
          if (!firstOfYear.has(e.id)) firstOfYear.set(e.id, b.est)
          if (!(bestOfYear.get(e.id) >= b.est)) bestOfYear.set(e.id, b.est)
        }
      }
      if (inYear && (e.sets || []).some(s => !isWarmupRow(s) && hasCompletedWork(s))) perEx.set(e.id, (perEx.get(e.id) || 0) + 1)
      if (inYear) sets += doneWorkSets(e)
    }
    if (!inYear) continue
    days.add(d)
    minutes += workoutDuration(w) / 60000
    volume += workoutVolume(w)
    const date = new Date(d + 'T12:00:00')
    months[date.getMonth()]++
    weekdays[date.getDay()]++
    if (typeof w.start === 'number' && Number.isFinite(w.start)) hours.push(new Date(w.start).getHours())
  }

  // The biggest gain of the year among exercises trained at least twice: first best → year's best.
  let progress = null
  for (const [id, from] of firstOfYear) {
    const to = bestOfYear.get(id)
    if ((perEx.get(id) || 0) < 2 || !(from > 0) || !(to > from)) continue
    const pct = Math.round((to / from - 1) * 1000) / 10
    if (!progress || pct > progress.pct) progress = { id, from, to, pct }
  }

  // Longest run of consecutive weeks with at least one workout.
  const weeks = [...new Set([...days].map(weekNo))].sort((a, b) => a - b)
  let longestStreak = 0, run = 0
  weeks.forEach((n, i) => { run = i && n === weeks[i - 1] + 1 ? run + 1 : 1; longestStreak = Math.max(longestStreak, run) })

  hours.sort((a, b) => a - b)
  const mid = hours.length ? hours[Math.floor(hours.length / 2)] : null
  const timeOfDay = mid === null ? null : mid < 12 ? 'morning' : mid < 17 ? 'afternoon' : 'evening'

  return {
    year, sessions: ws.length, minutes: Math.round(minutes), volume: Math.round(volume), sets, days: days.size,
    topExercises: [...perEx].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([id, sessions]) => ({ id, sessions })),
    records, progress, longestStreak,
    busiestMonth: argmax(months), favoriteWeekday: argmax(weekdays), timeOfDay,
  }
}

// Biscotos league: the client side of the points (the server computes them, api/social/score.js).
// Pure helpers for the League screen: the rules as shown, a member's line, a share text.

// Mirrors api/social/score.js POINTS: the screen explains the rules the server applies.
export const RULES = Object.freeze([
  { key: 'sessions', pts: 10, icon: 'dumbbell', title: 'Workout logged', note: 'At most two a day.' },
  { key: 'records', pts: 25, icon: 'trophy', title: 'Personal record', note: 'Best estimated 1RM ever on an exercise, up to five a week.' },
  { key: 'progress', pts: 30, icon: 'chartLine', title: 'Progress', note: 'Up to 30: your week against your own last four, +1 % = 10 points.' },
  { key: 'plan', pts: 40, icon: 'checkCircle', title: 'Plan completed', note: 'As many workouts as your weekly plan has training days.' },
  { key: 'nutrition', pts: 5, icon: 'flame', title: 'Day on target', note: 'Calories within 10 % of your goal, if you share nutrition.' },
])

/** The rows of a board in podium order for the top three: 2nd, 1st, 3rd (fewer when fewer). */
export function podium(rows) {
  const ranked = (rows || []).filter(r => r.points != null && r.points > 0).slice(0, 3)
  if (ranked.length < 3) return ranked
  return [ranked[1], ranked[0], ranked[2]]
}

/** A member's own row in a board, or null. */
export const myRow = board => (board?.rows || []).find(r => r.me) || null

/** How far behind the member above (0 for the leader, null when not ranked). */
export function gapToNext(rows, row) {
  if (!row || row.points == null) return null
  const above = (rows || []).filter(r => r.points != null && r.points > row.points)
  if (!above.length) return 0
  return Math.min(...above.map(r => r.points)) - row.points
}

/** Initials for an avatar: 'Alex Demo' → 'AD', 'sam' → 'S'. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
}

/** A stable hue (0–359) per name, so a friend keeps one avatar colour everywhere. */
export function hueOf(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360
  return h
}

/** '2 h ago' style, in the app's language: seconds → minutes → hours → days. */
export function ago(at, now = Date.now(), locale = 'en') {
  const s = Math.round((at - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const a = Math.abs(s)
  if (a < 60) return rtf.format(0, 'minute')
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

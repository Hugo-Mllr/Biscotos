// Apple Health weights → the openGym weigh-in curve, on the person's say-so (docs/QUESTIONS.md Q7).
// The server keeps what the Shortcut sends apart (health-<uid>.json); only the app writes
// S.bodyweight, through the same update() every weigh-in uses, so the multi-device merge of the
// state document (lib/sync-merge.js: one entry per day, the later `t` wins) stays the only writer.
// Pure: no React, no network.

const LB = 0.45359237
const r1 = n => Math.round(n * 10) / 10

/** A kg value in the profile's unit, to one decimal like every weigh-in. */
export const kgToUnit = (kg, unit) => r1(unit === 'lb' ? kg / LB : kg)

/** How a suggestion is remembered once dismissed (day and value: a new value asks again). */
export const suggestionKey = s => `${s.d}|${s.kg}`

/**
 * Days Apple Health sent a weight for and the curve has none: newest first, at most `max`.
 * A day the curve already has is left alone — the person's own weigh-in wins over the import.
 */
export function weightSuggestions(samples, bodyweight, unit, dismissed = [], max = 3) {
  const have = new Set((bodyweight || []).map(b => b && b.d))
  const gone = new Set(dismissed)
  const byDay = new Map()
  for (const s of samples || []) {
    if (!s || s.type !== 'weight' || s.source !== 'apple-health' || !(s.value > 0)) continue
    byDay.set(s.d, s.value)          // one weight per day server-side already; the last wins anyway
  }
  return [...byDay]
    .filter(([d]) => !have.has(d))
    .map(([d, kg]) => ({ d, kg, w: kgToUnit(kg, unit) }))
    .filter(s => !gone.has(suggestionKey(s)))
    .sort((a, b) => (a.d < b.d ? 1 : -1))
    .slice(0, max)
}

/** Adds (or replaces) the weigh-in of day `d` in a state draft — what BwSheet does for today. */
export function addWeighIn(S, d, w, now = Date.now()) {
  const ex = S.bodyweight.find(b => b.d === d)
  if (ex) { ex.w = w; ex.t = now } else S.bodyweight.push({ d, w, t: now })
  S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return S
}

// Dismissed suggestions are a per-device convenience: kept in localStorage, never synced.
const STORE_KEY = 'bx_dismissed_weights'
export function loadDismissed(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v.slice(-200) : [] } catch { return [] }
}
export function saveDismissed(list, storage = globalThis.localStorage) {
  try { storage.setItem(STORE_KEY, JSON.stringify(list.slice(-200))) } catch { /* private mode: it just asks again */ }
}

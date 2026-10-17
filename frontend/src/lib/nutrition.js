// Biscotos nutrition: pure helpers (no React, no network). The server stores grams and the
// nutrients per 100 g of each entry (api/nutrition/store.js); every total shown in the app is
// computed here, so there is one rule for "how much did I eat" and it has a test beside it.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
export const MACROS = ['protein', 'carbs', 'fat']
// kcal per gram, for the share of energy each macro brings
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 }

const r1 = n => Math.round(n * 10) / 10
const num = v => (Number.isFinite(+v) ? +v : 0)

/** kcal and macros of one entry (or of a food at `grams`). */
export function macrosOf({ grams, per100 } = {}) {
  const f = num(grams) / 100
  const p = per100 || {}
  return { kcal: Math.round(num(p.kcal) * f), protein: r1(num(p.protein) * f), carbs: r1(num(p.carbs) * f), fat: r1(num(p.fat) * f) }
}

/** Sum of entries. */
export function totalsOf(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  for (const e of entries || []) {
    const m = macrosOf(e)
    t.kcal += m.kcal; t.protein += m.protein; t.carbs += m.carbs; t.fat += m.fat
  }
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) }
}

/** Entries of one day, by meal, in MEALS order; meals with nothing are still present. */
export function byMeal(entries, day) {
  const out = Object.fromEntries(MEALS.map(m => [m, []]))
  for (const e of entries || []) if (e.d === day && out[e.meal]) out[e.meal].push(e)
  return out
}

/**
 * Progress of `value` against `goal`: fraction (may exceed 1), remaining (negative when over),
 * and whether it is over. No goal → fraction null.
 */
export function progress(value, goal) {
  const g = num(goal)
  if (!(g > 0)) return { fraction: null, remaining: null, over: false }
  const v = num(value)
  return { fraction: v / g, remaining: r1(g - v), over: v > g }
}

/** Share of energy from each macro, in % (rounded, may not sum to exactly 100). */
export function energySplit(t) {
  const k = MACROS.reduce((s, m) => s + num(t?.[m]) * KCAL_PER_G[m], 0)
  if (!(k > 0)) return { protein: 0, carbs: 0, fat: 0 }
  return Object.fromEntries(MACROS.map(m => [m, Math.round((num(t[m]) * KCAL_PER_G[m] * 100) / k)]))
}

/** The meal someone is probably logging at local hour `h`. */
export function mealForHour(h) {
  if (h >= 4 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 18 && h < 23) return 'dinner'
  return 'snack'
}

/** YYYY-MM-DD of `iso` shifted by `days` (calendar days, DST-safe). */
export function shiftDay(iso, days) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The 7 days ending on `day`, oldest first. */
export const weekEnding = day => Array.from({ length: 7 }, (_, i) => shiftDay(day, i - 6))

/** kcal per day over `days`, for a bar chart. */
export function kcalByDay(entries, days) {
  const m = new Map(days.map(d => [d, 0]))
  for (const e of entries || []) if (m.has(e.d)) m.set(e.d, m.get(e.d) + macrosOf(e).kcal)
  return days.map(d => ({ d, kcal: Math.round(m.get(d)) }))
}

/** Body weight in kg from an openGym weigh-in ({ w } in the profile's unit). */
export const toKg = (w, unit) => (unit === 'lb' ? num(w) * 0.45359237 : num(w))

/** Body-mass index, one decimal, or null without both numbers. */
export function bmi(heightCm, weightKg) {
  const h = num(heightCm) / 100, w = num(weightKg)
  if (!(h > 0.5) || !(w > 0)) return null
  return r1(w / (h * h))
}

/** WHO adult bands. Only a rough indicator — the UI says so. */
export function bmiBand(v) {
  if (v == null) return null
  if (v < 18.5) return 'under'
  if (v < 25) return 'normal'
  if (v < 30) return 'over'
  return 'obese'
}

/** Parses what someone types in a number field ("45,5", " 60 ") → number or null. */
export function parseAmount(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const t = String(s ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return +t
}

/** A food picked from search, a scan or the person's list → the body of POST /api/nutrition/log. */
export function entryFromFood(food, { d, meal, grams }) {
  const e = { d, meal, grams, name: food.name, per100: food.per100, source: food.source === 'off' ? 'off' : 'manual' }
  if (food.brand) e.brand = food.brand
  if (food.barcode) e.barcode = food.barcode
  return e
}

/**
 * The most recent day before `day` on which `meal` has entries: { d, entries } (entries in log
 * order), or null. Only looks inside the log it is given, so a week's log means "this week".
 */
export function lastMeal(log, day, meal) {
  let best = null
  for (const e of log || []) {
    if (e.meal !== meal || !(e.d < day)) continue
    if (!best || e.d > best.d) best = { d: e.d, entries: [] }
    if (e.d === best.d) best.entries.push(e)
  }
  return best
}

/** The entries of a past meal as bodies of POST /api/nutrition/log, on `day` in `meal`. */
export const repeatEntries = (entries, { d, meal }) =>
  (entries || []).map(e => entryFromFood(e, { d, meal, grams: e.grams }))

/**
 * Foods from the person's own log that would close the day's protein gap without blowing the
 * calorie goal: [{ food, grams, macros }], best first, at most `limit`. Each food is offered at the
 * portion last eaten. Empty when there is no protein goal, the gap is under 10 g, or nothing fits.
 * A food counts for the protein it adds up to the gap (no credit for overshooting), per kcal.
 */
export function fillSuggestions(log, goals, day, limit = 3) {
  const target = num(goals?.protein)
  if (!target) return []
  const today = (log || []).filter(e => e.d === day)
  const eaten = totalsOf(today)
  const gap = target - eaten.protein
  if (gap < 10) return []
  const room = num(goals?.kcal) ? goals.kcal - eaten.kcal : Infinity
  const seen = new Map()
  for (const e of [...(log || [])].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))) {
    const key = [e.name, e.brand || '', e.barcode || ''].join('|')
    if (!seen.has(key) && num(e.grams) > 0) seen.set(key, e)   // newest entry of each food
  }
  const out = []
  for (const e of seen.values()) {
    const macros = macrosOf(e)
    if (macros.protein < 5 || macros.kcal > room) continue
    out.push({ food: e, grams: e.grams, macros, score: Math.min(macros.protein, gap) / Math.max(macros.kcal, 1) })
  }
  return out.sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, limit).map(({ score, ...r }) => r)
}

/** The barcode formats a food package carries (EAN/UPC), as BarcodeDetector names them. */
export const FOOD_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

/** Digits of a scanned code if it can be a food barcode (UPC-E/EAN-8 to GTIN-14), else null. */
export function foodBarcode(value) {
  const v = String(value ?? '').replace(/\s/g, '')
  return /^\d{8,14}$/.test(v) ? v : null
}

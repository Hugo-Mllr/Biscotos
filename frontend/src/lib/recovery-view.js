import { FATIGUE_STATES, LB_TO_KG } from './recovery.js'

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Values below .25 are ready, .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return value < 0.25
    ? FATIGUE_STATES.READY
    : value <= 0.5
      ? FATIGUE_STATES.RECOVERING
      : FATIGUE_STATES.FATIGUED
}

/**
 * The profile's own last registered bodyweight, in kg (null when there is none): the body-mass part
 * of a bodyweight exercise's load for fatigue and for estimated effort, so every screen reads the
 * same set the same way.
 */
export function profileBodyweightKg(S) {
  const entries = S?.bodyweight || []
  if (!entries.length) return null
  const last = entries.slice().sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
  if (!last || !(last.w > 0)) return null
  return S.unit === 'lb' ? last.w * LB_TO_KG : last.w
}

/**
 * Today's form from a fatigue map (fatigueOf): the mean of the four most fatigued muscles, as a
 * score out of 100 (100 = fully fresh), its state, and up to three muscles over the fatigued line,
 * most tired first. One tired muscle does not sink the day, a tired body does.
 *
 * @param {Record<string, number>} fatigue Fatigue values 0..1 keyed by muscle slug.
 * @returns {{ score: number, state: 'ready'|'recovering'|'fatigued', tired: string[] }}
 */
export function readinessOf(fatigue) {
  const rows = Object.entries(fatigue || {}).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])
  const top = rows.slice(0, 4)
  const mean = top.length ? top.reduce((a, [, v]) => a + v, 0) / top.length : 0
  return {
    score: Math.round(100 * (1 - Math.min(1, Math.max(0, mean)))),
    state: fatigueStateOf(mean),
    tired: rows.filter(([, v]) => v > 0.5).slice(0, 3).map(([slug]) => slug),
  }
}

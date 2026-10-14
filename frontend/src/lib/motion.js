// Biscotos motion system — the JS half of the --bx-dur-* / --bx-ease-* tokens in
// styles/biscotos.css. Anything that animates from script (count-ups, chart draws) reads its
// timing here so CSS and JS never drift apart, and every helper honours
// prefers-reduced-motion: with it set, an animation jumps straight to its end state.
//
// Pure and framework-free (see docs/DESIGN.md § Motion); the React hooks live in
// components/bx/motion-hooks.js.

export const DURATION = Object.freeze({ instant: 90, fast: 160, base: 240, slow: 420, draw: 900 })

// cubic-bezier control points, identical to the CSS tokens
export const EASING = Object.freeze({
  out: [0.2, 0.8, 0.2, 1],
  inOut: [0.65, 0, 0.35, 1],
  spring: [0.3, 1.5, 0.5, 1],
})
export const cssEasing = name => `cubic-bezier(${EASING[name].join(',')})`

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

/** Whether the person asked the OS for less motion. Never throws (old WebViews, tests, SSR). */
export function prefersReducedMotion(win = globalThis.window) {
  try { return !!win?.matchMedia?.(REDUCE_QUERY).matches } catch { return false }
}

/** A duration token in ms, 0 when motion is reduced. */
export function duration(name, win) {
  if (prefersReducedMotion(win)) return 0
  return DURATION[name] ?? DURATION.base
}

/**
 * Cubic-bezier timing function (same maths as CSS): progress 0..1 → eased 0..1.
 * Solved by bisection on x, which is exact enough for animation and has no failure mode.
 */
export function bezier([x1, y1, x2, y2]) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  return p => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    let lo = 0, hi = 1, t = p
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2
      if (at(x1, x2, t) < p) lo = t; else hi = t
    }
    return at(y1, y2, t)
  }
}

/** The value of a tween from `from` to `to` after `elapsed` ms of `total`. */
export function tween(from, to, elapsed, total, ease = bezier(EASING.out)) {
  if (!(total > 0) || elapsed >= total) return to
  if (elapsed <= 0) return from
  return from + (to - from) * ease(elapsed / total)
}

/** stroke-dashoffset that shows `fraction` (0..1, clamped) of a circle of radius r. */
export function ringOffset(r, fraction) {
  const c = 2 * Math.PI * r
  const f = Math.min(1, Math.max(0, Number(fraction) || 0))
  return c * (1 - f)
}

import { describe, expect, it } from 'vitest'
import { DURATION, EASING, bezier, cssEasing, duration, prefersReducedMotion, ringOffset, tween } from './motion.js'

const win = reduce => ({ matchMedia: q => ({ matches: reduce && q.includes('reduce') }) })

describe('motion tokens', () => {
  it('mirror the CSS tokens of styles/biscotos.css', async () => {
    const fs = await import('node:fs')
    const css = fs.readFileSync(new URL('../styles/biscotos.css', import.meta.url), 'utf8')
    for (const [name, ms] of Object.entries(DURATION)) expect(css).toMatch(new RegExp(`--bx-dur-${name}:\\s*${ms}ms`))
    const cssCurve = token => css.match(new RegExp(`--bx-ease-${token}:\\s*cubic-bezier\\(([^)]*)\\)`))[1].split(',').map(Number)
    expect(cssCurve('out')).toEqual(EASING.out)
    expect(cssCurve('in-out')).toEqual(EASING.inOut)
    expect(cssCurve('spring')).toEqual(EASING.spring)
    expect(cssEasing('out')).toBe('cubic-bezier(0.2,0.8,0.2,1)')
  })
})

describe('reduced motion', () => {
  it('reads the media query and never throws', () => {
    expect(prefersReducedMotion(win(true))).toBe(true)
    expect(prefersReducedMotion(win(false))).toBe(false)
    expect(prefersReducedMotion({})).toBe(false)
    expect(prefersReducedMotion(undefined)).toBe(false)
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error('old webview') } })).toBe(false)
  })

  it('collapses every duration to zero', () => {
    expect(duration('slow', win(true))).toBe(0)
    expect(duration('slow', win(false))).toBe(DURATION.slow)
    expect(duration('nope', win(false))).toBe(DURATION.base)
  })
})

describe('bezier', () => {
  it('pins the end points and is monotonic for the out curve', () => {
    const f = bezier(EASING.out)
    expect(f(0)).toBe(0)
    expect(f(1)).toBe(1)
    let prev = 0
    for (let p = 0.05; p < 1; p += 0.05) { const v = f(p); expect(v).toBeGreaterThanOrEqual(prev); prev = v }
    expect(f(0.5)).toBeGreaterThan(0.5)   // ease-out: front-loaded
  })

  it('is linear for the linear control points', () => {
    const f = bezier([0, 0, 1, 1])
    for (const p of [0.1, 0.33, 0.5, 0.9]) expect(f(p)).toBeCloseTo(p, 3)
  })

  it('lets the spring overshoot before settling', () => {
    const f = bezier(EASING.spring)
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => f(i / 50)))
    expect(peak).toBeGreaterThan(1)
    expect(f(1)).toBe(1)
  })
})

describe('tween', () => {
  it('starts at from, ends at to, and clamps outside the window', () => {
    expect(tween(0, 100, 0, 500)).toBe(0)
    expect(tween(0, 100, 500, 500)).toBe(100)
    expect(tween(0, 100, 900, 500)).toBe(100)
    expect(tween(0, 100, -5, 500)).toBe(0)
    const mid = tween(0, 100, 250, 500)
    expect(mid).toBeGreaterThan(50)
    expect(mid).toBeLessThan(100)
  })

  it('jumps to the end with no duration (reduced motion)', () => {
    expect(tween(10, 20, 0, 0)).toBe(20)
  })
})

describe('ringOffset', () => {
  it('maps a fraction to a dash offset, clamped to the circle', () => {
    const c = 2 * Math.PI * 10
    expect(ringOffset(10, 0)).toBeCloseTo(c)
    expect(ringOffset(10, 1)).toBeCloseTo(0)
    expect(ringOffset(10, 0.25)).toBeCloseTo(c * 0.75)
    expect(ringOffset(10, 3)).toBeCloseTo(0)
    expect(ringOffset(10, -1)).toBeCloseTo(c)
    expect(ringOffset(10, NaN)).toBeCloseTo(c)
  })
})

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyTint, tintVars, accentHex, BASES } from './tint.js'
import { contrast } from './accent.js'

describe('tinted background', () => {
  it('mixes a little of a preset or an own colour into each fill', () => {
    const v = tintVars('violet', 'dark')
    expect(v['--bg']).toMatch(/^#[0-9a-f]{6}$/)
    expect(v['--bg']).not.toBe('#000000')
    expect(tintVars('#123456', 'light')['--surface']).toMatch(/^#[0-9a-f]{6}$/)
    expect(accentHex('violet')).toBe('#bf5af2')
    expect(tintVars('nope', 'dark')).toBe(null)
    expect(tintVars('url(x)', 'dark')).toBe(null)
  })

  it('keeps body text readable on every fill, for every hue', () => {
    for (const hex of ['#bf5af2', '#ff0000', '#ffff00', '#00ff00', '#0000ff', '#ffffff', '#000000']) {
      for (const theme of ['dark', 'light']) {
        const ink = theme === 'dark' ? '#ffffff' : '#000000'
        for (const [k, fill] of Object.entries(tintVars(hex, theme))) {
          // AAA (7:1) for body text on every fill, as on the neutral greys.
          expect(contrast(ink, fill), `${hex} ${theme} ${k}`).toBeGreaterThan(7)
        }
      }
    }
  })

  it('puts the fills on the root and takes them off again', () => {
    const el = document.createElement('div')
    const bg = applyTint(el, 'violet', 'light', true)
    expect(el.style.getPropertyValue('--bg')).toBe(bg)
    expect(el.dataset.tint).toBe('on')
    expect(applyTint(el, 'violet', 'light', false)).toBe(BASES.light['--bg'][0])
    expect(el.style.getPropertyValue('--bg')).toBe('')
    expect(el.dataset.tint).toBe('off')
  })
})

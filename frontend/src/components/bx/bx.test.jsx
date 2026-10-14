// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Bar, CountUp, Ring, Sheet } from './index.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const setReduced = reduce => {
  window.matchMedia = q => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('with reduced motion', () => {
  beforeEach(() => setReduced(true))

  it('CountUp shows the final value straight away', () => {
    act(() => root.render(<CountUp value={1840} />))
    expect(host.textContent.replace(/\D/g, '')).toBe('1840')
    act(() => root.render(<CountUp value={2100} />))
    expect(host.textContent.replace(/\D/g, '')).toBe('2100')
  })

  it('Ring is drawn at its value on the first render', () => {
    act(() => root.render(<Ring fraction={0.5} size={100} stroke={10} label="half" />))
    const val = host.querySelector('.bx-ring-val')
    const c = 2 * Math.PI * 45
    expect(+val.getAttribute('stroke-dashoffset')).toBeCloseTo(c / 2)
    expect(host.querySelector('svg').getAttribute('aria-label')).toBe('half')
  })

  it('Bar fills to its value and caps at 100 %', () => {
    act(() => root.render(<Bar fraction={1.4} label="protein" />))
    const bar = host.querySelector('.bx-bar')
    expect(bar.className).toContain('is-over')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(host.querySelector('.bx-bar > i').style.width).toBe('100%')
  })
})

describe('with motion', () => {
  beforeEach(() => setReduced(false))

  it('Ring starts empty and draws itself after the first frame', async () => {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', cb => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    act(() => root.render(<Ring fraction={0.25} size={100} stroke={10} />))
    const c = 2 * Math.PI * 45
    expect(+host.querySelector('.bx-ring-val').getAttribute('stroke-dashoffset')).toBeCloseTo(c)
    act(() => { frames.splice(0).forEach(f => f(16)) })
    expect(+host.querySelector('.bx-ring-val').getAttribute('stroke-dashoffset')).toBeCloseTo(c * 0.75)
    vi.unstubAllGlobals()
  })

  it('Ring over its target turns to the over state', () => {
    act(() => root.render(<Ring fraction={1.2} />))
    expect(host.querySelector('svg').getAttribute('class')).toContain('is-over')
  })
})

describe('Sheet', () => {
  it('closes on Escape and on a backdrop tap, not on a tap inside', () => {
    const onClose = vi.fn()
    act(() => root.render(<Sheet title="Add" onClose={onClose}><button>inside</button></Sheet>))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-label')).toBe('Add')
    // portalled to <body>, out of any transformed page that would trap a fixed element
    expect(host.contains(dialog)).toBe(false)
    expect(dialog.closest('.bx-sheet-bg').parentElement).toBe(document.body)
    act(() => { dialog.querySelector('button').click() })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { document.querySelector('.bx-sheet-bg').click() })
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

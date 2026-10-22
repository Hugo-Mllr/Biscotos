// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Confetti, { piecesOf, CONFETTI_MS } from './Confetti.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const reduced = on => { window.matchMedia = q => ({ matches: on && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }) }
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); reduced(false) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('piecesOf', () => {
  it('lays the same burst out every time, within bounds', () => {
    expect(piecesOf(36)).toEqual(piecesOf(36))
    expect(piecesOf(36)).toHaveLength(36)
    for (const p of piecesOf(60)) {
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(170)
      expect(p.dy).toBeGreaterThanOrEqual(260)
      expect(p.ms).toBeGreaterThanOrEqual(1300)
      expect(p.ms).toBeLessThanOrEqual(2200)
    }
    expect(new Set(piecesOf(36).map(p => p.color)).size).toBeGreaterThan(3)
  })
})

describe('Confetti', () => {
  it('bursts, hides from screen readers, and removes itself when it is over', () => {
    act(() => root.render(<Confetti count={20} />))
    const layer = host.querySelector('.confetti')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.querySelectorAll('i')).toHaveLength(20)
    act(() => { vi.advanceTimersByTime(CONFETTI_MS + 10) })
    expect(host.querySelector('.confetti')).toBe(null)
  })

  it('shows nothing to someone who asked for reduced motion', () => {
    reduced(true)
    act(() => root.render(<Confetti />))
    expect(host.querySelector('.confetti')).toBe(null)
  })
})

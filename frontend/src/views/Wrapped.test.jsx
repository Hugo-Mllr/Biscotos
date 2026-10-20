// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import Wrapped, { wrappedText } from './Wrapped.jsx'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
afterEach(() => { act(() => root.unmount()); host.remove() })
const at = (d, h) => new Date(d + `T${h}:00:00`).getTime()
const wk = (id, d) => ({ id, d, start: at(d, 18), end: at(d, 19), entries: [{ id: 'bench', sets: [{ w: 80, r: 5, done: true }] }] })

describe('Wrapped', () => {
  it('shows the year and switches between years', () => {
    useStore.setState(st => ({ S: { ...st.S, unit: 'kg', workouts: [wk('a', '2025-03-03'), wk('b', '2026-01-05'), wk('c', '2026-01-07')] } }))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<MemoryRouter><Wrapped /></MemoryRouter>))
    const v = () => [...host.querySelectorAll('.wrapped-v')].map(e => e.textContent)
    expect(v()[0]).toBe('2')
    expect(host.textContent).toContain('Share my year')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '2025').click())
    expect(v()[0]).toBe('1')
  })

  it('the shared text carries the headline numbers', () => {
    const text = wrappedText({ year: 2026, sessions: 120, minutes: 7200, volume: 250000, records: 14, topExercises: [] }, 'kg')
    expect(text).toContain('2026')
    expect(text).toContain('120')
    expect(text).toContain('250,000 kg')
    expect(text).toContain('Biscotos')
  })
})

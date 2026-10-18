// @vitest-environment happy-dom
// Biscotos: the exercise library is Plan's third view, under Plan's own title (no Exercises tab).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = q => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.removeItem('gym_plan_view') })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('Plan → Exercises', () => {
  it('offers the library as a third view and remembers it', () => {
    act(() => root.render(<Plan />))
    expect(button('Exercises')).toBeTruthy()
    act(() => { button('Exercises').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(localStorage.getItem('gym_plan_view')).toBe('library')
    expect(host.querySelector('.lib-hdr')).not.toBeNull()
    expect(button('By muscle')).toBeTruthy()
  })

  it('shows the library under Plan’s title, without a title of its own', () => {
    localStorage.setItem('gym_plan_view', 'library')
    act(() => root.render(<Plan />))
    const titles = [...host.querySelectorAll('h1')].map(h => h.textContent)
    expect(titles).toEqual(['Plan'])
    expect(host.querySelector('.search input, input[type="search"], .search-row input')).not.toBeNull()
  })

  it('falls back to the schedule for an unknown stored view', () => {
    localStorage.setItem('gym_plan_view', 'nonsense')
    act(() => root.render(<Plan />))
    expect(host.querySelector('.lib-hdr')).toBeNull()
  })
})

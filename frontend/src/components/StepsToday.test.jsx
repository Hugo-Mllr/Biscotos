// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
const api = vi.hoisted(() => ({ loadNutrition: vi.fn(), loadHealthSamples: vi.fn() }))
vi.mock('../lib/nutrition-api.js', () => api)

import StepsToday, { latestSteps } from './StepsToday.jsx'
import { todayISO } from '../lib/format.js'
import { shiftDay } from '../lib/nutrition.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })
let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); nav.mockReset(); Object.values(api).forEach(f => f.mockReset()) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => { act(() => root.render(<StepsToday />)); await flush() }

describe('latestSteps', () => {
  it('the newest steps row, ignoring other types', () => {
    expect(latestSteps([{ type: 'steps', d: '2026-10-01', value: 100 }, { type: 'weight', d: '2026-10-09', value: 80 }, { type: 'steps', d: '2026-10-03', value: 8123.4 }]))
      .toEqual({ d: '2026-10-03', value: 8123 })
    expect(latestSteps([])).toBe(null)
    expect(latestSteps(null)).toBe(null)
  })
})

describe("Home's steps card", () => {
  it('shows today’s steps against 10,000 by default, with the ring and what is left', async () => {
    api.loadHealthSamples.mockResolvedValue([{ type: 'steps', d: todayISO(), value: 7500 }])
    api.loadNutrition.mockResolvedValue({ profile: {}, goals: null, log: [] })
    await mount()
    expect(host.textContent).toContain('7,500 / 10,000')
    expect(host.textContent).toContain('75%')
    expect(host.textContent).toContain('Steps today')
    expect(host.textContent).toContain('To go: 2,500')
    expect(host.querySelector('svg[role="img"]').getAttribute('aria-label')).toBe('7500 of 10000 steps')
    act(() => host.querySelector('.steps-card').click())
    expect(nav).toHaveBeenCalledWith('/body')
  })

  it('follows the goal of the profile, and says so when it is reached', async () => {
    api.loadHealthSamples.mockResolvedValue([{ type: 'steps', d: todayISO(), value: 8200 }])
    api.loadNutrition.mockResolvedValue({ profile: { stepGoal: 8000 }, goals: null, log: [] })
    await mount()
    expect(host.textContent).toContain('8,200 / 8,000')
    expect(host.textContent).toContain('Goal reached!')
    expect(host.textContent).toContain('102%')
  })

  it('shows the last day received when today’s have not arrived yet', async () => {
    api.loadHealthSamples.mockResolvedValue([{ type: 'steps', d: shiftDay(todayISO(), -1), value: 9120 }])
    api.loadNutrition.mockResolvedValue({ profile: {}, goals: null, log: [] })
    await mount()
    expect(host.textContent).toContain('9,120 / 10,000')
    expect(host.textContent).not.toContain('Steps today')
    expect(host.textContent).toContain('Steps ·')
  })

  it('does not exist without any steps, nor when the server cannot be read', async () => {
    api.loadHealthSamples.mockResolvedValue([{ type: 'weight', d: todayISO(), value: 80 }])
    api.loadNutrition.mockResolvedValue({ profile: {}, goals: null, log: [] })
    await mount()
    expect(host.textContent).toBe('')
    api.loadHealthSamples.mockRejectedValue(new Error('offline'))
    act(() => root.unmount()); root = createRoot(host)
    await mount()
    expect(host.textContent).toBe('')
  })
})

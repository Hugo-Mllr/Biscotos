// @vitest-environment happy-dom
// Home's nutrition card against a stubbed lib/nutrition-api.js. Synthetic data only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
const api = vi.hoisted(() => ({ loadNutrition: vi.fn(), loadHealthSamples: vi.fn(), saveSettings: vi.fn() }))
vi.mock('../lib/nutrition-api.js', () => api)

import NutritionToday from './NutritionToday.jsx'
import { todayISO } from '../lib/format.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
beforeEach(() => { api.loadHealthSamples.mockReset(); api.loadHealthSamples.mockResolvedValue([]); api.saveSettings.mockReset(); api.saveSettings.mockResolvedValue({}); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); nav.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe("Home's nutrition card", () => {
  it("reads today only and shows its calories against the goal, with the macros", async () => {
    const d = todayISO()
    api.loadNutrition.mockResolvedValue({
      goals: { kcal: 2200, protein: 150 },
      log: [{ id: 'a', d, meal: 'breakfast', name: 'Demo oats', grams: 100, per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 } }],
    })
    act(() => root.render(<NutritionToday />))
    await flush()
    expect(api.loadNutrition).toHaveBeenCalledWith(d, d)
    expect(host.textContent).toContain('372')
    expect(host.textContent).toContain('2,200')
    expect(host.querySelectorAll('.bx-bar')).toHaveLength(3)
    act(() => host.querySelector('.nt-card').click())
    expect(nav).toHaveBeenCalledWith('/nutrition')
  })

  it('keeps the plain link when the log cannot be read', async () => {
    api.loadNutrition.mockRejectedValue(new Error('offline'))
    act(() => root.render(<NutritionToday />))
    await flush()
    expect(host.textContent).toContain('Nutrition')
    expect(host.querySelector('.bx-ring')).toBe(null)
  })

  it('shows the calculated goal, as the Nutrition screen does, when one is chosen in Body & goals', async () => {
    const year = new Date().getFullYear()
    api.loadNutrition.mockResolvedValue({
      profile: { heightCm: 180, birthYear: year - 27, sex: 'm', activity: 'mid', goalMode: 'cut', pace: 'steady' },
      goals: { kcal: 2200, protein: 150 }, log: [],
    })
    useStore.setState(st => ({ S: { ...st.S, unit: 'kg', workouts: [], bodyweight: [{ d: todayISO(), w: 80 }] } }))
    act(() => root.render(<NutritionToday />))
    await flush()
    expect(host.textContent).toContain('1,870')
    expect(host.textContent).not.toContain('2,200')
    // today's calculated goal is kept on the server, once, for the iPhone widget
    expect(api.saveSettings).toHaveBeenCalledTimes(1)
    expect(api.saveSettings).toHaveBeenCalledWith({ profile: { goalToday: { d: todayISO(), kcal: 1870, protein: 176, carbs: expect.any(Number), fat: expect.any(Number) } } })
  })
})

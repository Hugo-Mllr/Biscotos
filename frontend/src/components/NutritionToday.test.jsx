// @vitest-environment happy-dom
// Home's nutrition card against a stubbed lib/nutrition-api.js. Synthetic data only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
const api = vi.hoisted(() => ({ loadNutrition: vi.fn() }))
vi.mock('../lib/nutrition-api.js', () => api)

import NutritionToday from './NutritionToday.jsx'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); nav.mockReset() })
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
})

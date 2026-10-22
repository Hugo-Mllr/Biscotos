// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ loadNutrition: vi.fn(), loadHealthSamples: vi.fn(), saveSettings: vi.fn() }))
vi.mock('../lib/nutrition-api.js', () => api)
vi.mock('../sheets.jsx', () => ({ bwSheet: vi.fn() }))

import BodyGoals from './BodyGoals.jsx'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const chip = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const year = new Date().getFullYear()

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  api.loadNutrition.mockResolvedValue({ profile: { heightCm: 180, birthYear: year - 27, sex: 'm', activity: 'mid', goalMode: 'cut', pace: 'steady' }, goals: null, foods: [], log: [] })
  api.loadHealthSamples.mockResolvedValue([])
  api.saveSettings.mockImplementation(async body => ({ profile: { heightCm: 180, birthYear: year - 27, sex: 'm', activity: 'mid', goalMode: 'cut', pace: 'steady', ...body.profile } }))
  useStore.setState(st => ({ user: { id: 'u1', name: 'Me' }, S: { ...st.S, unit: 'kg', workouts: [], bodyweight: [{ d: '2026-01-01', w: 80 }] } }))
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ user: null }) })
const mount = () => act(() => root.render(<MemoryRouter><BodyGoals /></MemoryRouter>))

describe('BodyGoals', () => {
  it('works out the metabolism, the need and the goal from the profile', async () => {
    mount(); await flush()
    expect(host.textContent).toContain('Goal for today')
    expect(host.textContent).toContain('1,795')            // BMR of a 27-year-old, 180 cm, 80 kg man
    expect(host.textContent).toContain('2,423')            // × 1.35 on a day without a workout
    expect(host.textContent).toContain('1,870')            // −0.5 kg a week
    expect(host.textContent).toContain('Protein 176 g')
    expect(host.textContent).toContain('24.7')             // BMI
  })

  it('saves what is chosen, one key at a time', async () => {
    mount(); await flush()
    await act(async () => chip('Gain muscle').click()); await flush()
    expect(api.saveSettings).toHaveBeenLastCalledWith({ profile: { goalMode: 'bulk' } })
    await act(async () => chip('Gentle').click()); await flush()
    expect(api.saveSettings).toHaveBeenLastCalledWith({ profile: { pace: 'gentle' } })
    await act(async () => chip('Female').click()); await flush()
    expect(api.saveSettings).toHaveBeenLastCalledWith({ profile: { sex: 'f' } })
  })

  it('Manual keeps the goals typed by hand: no calculated goal', async () => {
    mount(); await flush()
    await act(async () => chip('Manual').click()); await flush()
    expect(api.saveSettings).toHaveBeenLastCalledWith({ profile: { goalMode: 'manual' } })
    expect(host.textContent).not.toContain('Goal for today')
    expect(host.textContent).toContain('You set your daily goals yourself in Nutrition.')
  })

  it('the steps from Apple Health correct the day', async () => {
    api.loadHealthSamples.mockResolvedValue([{ type: 'steps', value: 11000 }])
    mount(); await flush()
    expect(host.textContent).toContain('Adjusted with the steps from Apple Health.')
    expect(host.textContent).toContain('2,520')   // 1,795 × 1.2 + 8,000 steps × 0.04 × 80 / 70
  })

  it('asks what is missing instead of guessing', async () => {
    api.loadNutrition.mockResolvedValue({ profile: { heightCm: 180 }, goals: null, foods: [], log: [] })
    mount(); await flush()
    expect(host.textContent).toContain('Fill in your height, birth year, sex and weight')
    expect(host.textContent).not.toContain('Goal for today')
  })

  it('needs an account', () => {
    useStore.setState({ user: null })
    mount()
    expect(host.textContent).toContain('needs an account')
    expect(api.loadNutrition).not.toHaveBeenCalled()
  })
})

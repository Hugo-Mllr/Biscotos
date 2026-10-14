// @vitest-environment happy-dom
// The Nutrition screen against a stubbed lib/nutrition-api.js: what it shows for a day, and what
// it sends when someone logs, edits or deletes a food or sets goals. Synthetic data only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

const api = vi.hoisted(() => ({
  loadNutrition: vi.fn(), saveSettings: vi.fn(), addEntry: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn(),
  addFood: vi.fn(), deleteFood: vi.fn(), searchFoods: vi.fn(), foodByBarcode: vi.fn(),
  lookupProblem: e => (e?.status === 404 ? 'not-found' : 'unavailable'),
}))
vi.mock('../lib/nutrition-api.js', () => api)

import Nutrition from './Nutrition.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Reduced motion: counters and rings render their final values at once.
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

const oats = { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }
const today = todayISO()
let host, root, saved

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const byText = (sel, text) => [...host.ownerDocument.querySelectorAll(sel)].find(el => el.textContent.includes(text))
const type = (input, value) => act(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => {
  saved = { S: useStore.getState().S, user: useStore.getState().user }
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', bodyweight: [{ d: today, w: 75, t: 1 }] }, user: { id: 'u1', name: 'Alex Demo' } })
  Object.values(api).forEach(f => f.mockReset?.())
  api.loadNutrition.mockResolvedValue({
    profile: { heightCm: 178 }, goals: { kcal: 2000, protein: 150 }, foods: [],
    log: [{ id: 'e1', d: today, meal: 'breakfast', grams: 100, name: 'Flocons démo', per100: oats }]
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  useStore.setState(saved)
  vi.useRealTimers()
})

describe('Nutrition', () => {
  it('asks a guest to sign in and never calls the server', async () => {
    useStore.setState({ user: null })
    act(() => root.render(<Nutrition />))
    await flush()
    expect(host.textContent).toContain('needs an account')
    expect(api.loadNutrition).not.toHaveBeenCalled()
  })

  it('loads the week ending today and shows the day’s score, remaining kcal and BMI', async () => {
    act(() => root.render(<Nutrition />))
    await flush()
    const [from, to] = api.loadNutrition.mock.calls[0]
    expect(to).toBe(today)
    expect(Math.round((Date.parse(to) - Date.parse(from)) / 86400000)).toBe(6)
    expect(host.textContent).toContain('Flocons démo')
    expect(host.textContent).toContain('372')
    expect(host.textContent).toContain('1,628 kcal left')   // fmtNum formats in en-GB here
    expect(host.textContent).toContain('23.7')   // 75 kg / 1.78 m²
    expect(host.querySelector('[role="progressbar"]')).not.toBe(null)
  })

  it('searches, picks a food, sets the portion and logs it to the chosen meal', async () => {
    api.searchFoods.mockResolvedValue([{ name: 'Skyr démo', source: 'off', barcode: '3000000000017', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, serving: { label: '1 pot', grams: 150 } }])
    api.addEntry.mockImplementation(async e => ({ id: 'e2', ...e }))
    act(() => root.render(<Nutrition />))
    await flush()
    act(() => byText('button', 'Add food').click())
    vi.useFakeTimers()
    type(document.querySelector('input[type="search"]'), 'skyr')
    await act(async () => { vi.advanceTimersByTime(450) })
    vi.useRealTimers()
    await flush()
    expect(api.searchFoods).toHaveBeenCalledWith('skyr', expect.any(String))
    act(() => byText('.bx-item button', 'Skyr démo').click())
    // the serving is the default portion; pick the snack
    act(() => byText('button', 'Snack').click())
    act(() => byText('[role="dialog"] button[class*="bx-btn-primary"]', 'Add').click())
    await flush()
    expect(api.addEntry).toHaveBeenCalledWith({
      d: today, meal: 'snack', grams: 150, name: 'Skyr démo', barcode: '3000000000017', source: 'off',
      per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }
    })
    expect(api.addFood).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    expect(host.textContent).toContain('Skyr démo')
  })

  it('refuses a portion that is not a number and never sends it', async () => {
    act(() => root.render(<Nutrition />))
    await flush()
    act(() => byText('button', 'Add food').click())
    act(() => byText('button', 'By hand').click())
    const inputs = () => [...document.querySelectorAll('[role="dialog"] input')]
    type(inputs()[0], 'Pain démo')
    ;['265', '9', '49', '3.2'].forEach((v, i) => type(inputs()[2 + i], v))
    act(() => byText('[role="dialog"] button', 'Next').click())
    type(document.querySelector('[role="dialog"] input[inputmode="decimal"]'), 'beaucoup')
    const add = byText('[role="dialog"] button[class*="bx-btn-primary"]', 'Add')
    expect(add.disabled).toBe(true)
  })

  it('deletes an entry from its sheet', async () => {
    api.deleteEntry.mockResolvedValue({ ok: true })
    act(() => root.render(<Nutrition />))
    await flush()
    act(() => byText('.bx-item button', 'Flocons démo').click())
    act(() => byText('[role="dialog"] button', 'Delete').click())
    await flush()
    expect(api.deleteEntry).toHaveBeenCalledWith('e1')
    expect(host.textContent).not.toContain('Flocons démo')
  })

  it('saves goals and height, sending null for empty fields', async () => {
    api.saveSettings.mockImplementation(async b => ({ profile: b.profile, goals: b.goals }))
    act(() => root.render(<Nutrition />))
    await flush()
    act(() => host.querySelector('button[aria-label="Daily goals"]').click())
    const inputs = [...document.querySelectorAll('[role="dialog"] input')]
    type(inputs[0], '2200')
    type(inputs[1], '')
    act(() => byText('[role="dialog"] button', 'Save').click())
    await flush()
    expect(api.saveSettings).toHaveBeenCalledWith({ goals: { kcal: 2200 }, profile: { heightCm: 178 } })
  })

  it('looks up a typed barcode, and offers manual entry when the product is unknown', async () => {
    api.foodByBarcode.mockRejectedValue(Object.assign(new Error('unknown'), { status: 404 }))
    act(() => root.render(<Nutrition />))
    await flush()
    act(() => byText('button', 'Add food').click())
    act(() => byText('button', 'Scan a barcode').click())
    type(document.querySelector('input[inputmode="numeric"]'), '3000000000024')
    act(() => byText('[role="dialog"] button', 'Look up').click())
    await flush()
    expect(api.foodByBarcode).toHaveBeenCalledWith('3000000000024', expect.any(String))
    expect(document.body.textContent).toContain('not in Open Food Facts yet')
    expect(document.body.textContent).toContain('Per 100 g')
  })
})

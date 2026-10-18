// @vitest-environment happy-dom
// The menu import sheet against a stubbed nutrition API. Synthetic foods only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ searchFoods: vi.fn(), addEntry: vi.fn() }))
vi.mock('../../lib/nutrition-api.js', () => api)

import MenuImportSheet from './MenuImportSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

let host, root, onLogged, onClose
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }
const byText = (sel, text) => [...document.querySelectorAll(sel)].find(el => el.textContent.includes(text))
const typeInto = (el, value) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const per100 = (kcal, protein = 5, carbs = 10, fat = 2) => ({ kcal, protein, carbs, fat })
const foods = [{ id: 'f1', name: 'Riz basmati', per100: per100(130) }]
const log = [
  { id: 'e1', d: '2026-03-10', meal: 'lunch', grams: 150, name: 'Skyr', per100: per100(63, 11, 4, 0.2), source: 'manual' },
  { id: 'e2', d: '2026-03-10', meal: 'breakfast', grams: 60, name: 'Oeufs durs', per100: per100(155, 13, 1, 11), source: 'manual', serving: { grams: 60 } },
]

beforeEach(() => {
  api.searchFoods.mockReset(); api.addEntry.mockReset()
  api.addEntry.mockImplementation(async body => ({ id: 'n' + Math.random(), ...body }))
  onLogged = vi.fn(); onClose = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MenuImportSheet day="2026-03-12" foods={foods} log={log} onLogged={onLogged} onClose={onClose} />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const read = async text => {
  typeInto(document.querySelector('textarea'), text)
  act(() => byText('button', 'Read my menu').click())
  await flush()
}

describe('MenuImportSheet', () => {
  it('cannot read an empty menu', () => {
    expect(byText('button', 'Read my menu').disabled).toBe(true)
  })

  it('matches the person\'s own foods without asking online, and logs them under the meal title', async () => {
    await read('Lunch:\nRiz 200g\nSkyr 150g')
    expect(api.searchFoods).not.toHaveBeenCalled()
    expect(byText('button', 'Add 2 foods')).toBeTruthy()
    await act(async () => { byText('button', 'Add 2 foods').click() })
    await flush()
    expect(api.addEntry).toHaveBeenCalledTimes(2)
    expect(api.addEntry.mock.calls[0][0]).toMatchObject({ d: '2026-03-12', meal: 'lunch', grams: 200, name: 'Riz basmati' })
    expect(api.addEntry.mock.calls[1][0]).toMatchObject({ meal: 'lunch', grams: 150, name: 'Skyr' })
    expect(onLogged).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalled()
  })

  it('searches online only for a food the person never logged, and offers what comes back', async () => {
    api.searchFoods.mockResolvedValue([{ name: 'Chocolat noir', brand: 'Demo', per100: per100(550, 6, 40, 35), source: 'off' }])
    await read('Chocolat 20g')
    expect(api.searchFoods).toHaveBeenCalledTimes(1)
    expect(api.searchFoods.mock.calls[0][0]).toBe('Chocolat')
    expect(host.textContent + document.body.textContent).toContain('Chocolat noir')
    await act(async () => { byText('button', 'Add 1 food').click() })
    await flush()
    expect(api.addEntry.mock.calls[0][0]).toMatchObject({ name: 'Chocolat noir', grams: 20, source: 'off' })
  })

  it('shows "No match" when the online search fails, and adds nothing for that line', async () => {
    api.searchFoods.mockRejectedValue(new Error('busy'))
    await read('Truc inconnu 50g')
    expect(document.body.textContent).toContain('No match')
    expect(byText('button', 'Add 0 foods').disabled).toBe(true)
  })

  it('keeps a line with no amount out until one is typed (a count needs a serving size)', async () => {
    await read('Lunch:\n2 skyr')
    expect(document.body.textContent).toContain('Needs an amount')
    expect(byText('button', 'Add 0 foods').disabled).toBe(true)
    typeInto(document.querySelector('input[aria-label="Amount (g)"]'), '250')
    expect(byText('button', 'Add 1 food').disabled).toBe(false)
    await act(async () => { byText('button', 'Add 1 food').click() })
    await flush()
    expect(api.addEntry.mock.calls[0][0]).toMatchObject({ name: 'Skyr', grams: 250 })
  })

  it('works a count out from the food\'s serving size when it has one', async () => {
    await read('2 oeufs')
    await act(async () => { byText('button', 'Add 1 food').click() })
    await flush()
    expect(api.addEntry.mock.calls[0][0]).toMatchObject({ name: 'Oeufs durs', grams: 120 })
  })

  it('logs nothing for a line that is skipped', async () => {
    await read('Riz 200g\nSkyr 150g')
    const select = document.querySelector('select[aria-label="Riz"]')
    act(() => { select.value = '-1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { byText('button', 'Add 1 food').click() })
    await flush()
    expect(api.addEntry).toHaveBeenCalledTimes(1)
    expect(api.addEntry.mock.calls[0][0].name).toBe('Skyr')
  })

  it('still shows online answers under React\'s development double mount', async () => {
    act(() => root.unmount())
    root = createRoot(host)
    api.searchFoods.mockResolvedValue([{ name: 'Chocolat noir', per100: per100(550), source: 'off' }])
    act(() => root.render(<React.StrictMode><MenuImportSheet day="2026-03-12" foods={foods} log={log} onLogged={onLogged} onClose={onClose} /></React.StrictMode>))
    await read('Chocolat 20g')
    expect(document.body.textContent).toContain('Chocolat noir')
    expect(document.body.textContent).not.toContain('Searching…')
  })

  it('says so when nothing can be read, and goes back', async () => {
    await read('200g\n---')
    expect(document.body.textContent).toContain('Nothing recognised in this menu.')
    act(() => byText('button', 'Back').click())
    expect(document.querySelector('textarea').value).toBe('200g\n---')
  })
})

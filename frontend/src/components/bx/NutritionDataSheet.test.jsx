// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ exportNutrition: vi.fn(), importNutrition: vi.fn(), eraseNutrition: vi.fn() }))
vi.mock('../../lib/nutrition-api.js', () => api)
vi.mock('../../lib/mobile.js', () => ({ MOBILE: false, shareExport: vi.fn() }))

import NutritionDataSheet from './NutritionDataSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

let host, root, onChanged
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const btn = text => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === text)
const pick = async content => {
  const input = document.querySelector('[role="dialog"] input[type="file"]')
  const file = new File([content], 'export.json', { type: 'application/json' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
}

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  onChanged = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<NutritionDataSheet onClose={() => {}} onChanged={onChanged} />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('NutritionDataSheet', () => {
  it('downloads the server export as a dated JSON file', async () => {
    api.exportNutrition.mockResolvedValue({ format: 'biscotos-nutrition', version: 1 })
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    act(() => btn('Export as a file').click())
    await flush()
    expect(click).toHaveBeenCalled()
    expect(click.mock.contexts[0].download).toMatch(/^biscotos-nutrition-\d{4}-\d{2}-\d{2}\.json$/)
    click.mockRestore()
  })

  it('imports a picked file and reports what came in', async () => {
    api.importNutrition.mockResolvedValue({ mode: 'merge', added: { foods: 1, log: 3, samples: 2 }, skipped: 1 })
    await pick(JSON.stringify({ format: 'biscotos-nutrition', version: 1 }))
    expect(api.importNutrition).toHaveBeenCalledWith({ format: 'biscotos-nutrition', version: 1 })
    expect(document.body.textContent).toContain('6 entries added, 1 skipped.')
    expect(onChanged).toHaveBeenCalled()
  })

  it('refuses a file that is not JSON without calling the server', async () => {
    await pick('not json at all')
    expect(api.importNutrition).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('not a Biscotos nutrition export')
  })

  it('erases only after an explicit second confirmation', async () => {
    api.eraseNutrition.mockResolvedValue({ ok: true })
    act(() => btn('Erase my nutrition data').click())
    expect(api.eraseNutrition).not.toHaveBeenCalled()
    act(() => btn('Cancel').click())
    expect(btn('Erase')).toBeUndefined()
    act(() => btn('Erase my nutrition data').click())
    act(() => btn('Erase').click())
    await flush()
    expect(api.eraseNutrition).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalled()
  })
})

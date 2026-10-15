// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ loadHealthSamples: vi.fn() }))
vi.mock('../lib/nutrition-api.js', () => api)

import HealthWeightPrompt from './HealthWeightPrompt.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const today = todayISO()
let host, root, saved
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

beforeEach(() => {
  saved = { S: useStore.getState().S, user: useStore.getState().user }
  localStorage.clear()
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', bodyweight: [] }, user: { id: 'u1', name: 'Alex Demo' } })
  api.loadHealthSamples.mockReset().mockResolvedValue([{ type: 'weight', d: today, value: 74.6, source: 'apple-health' }])
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState(saved) })

describe('HealthWeightPrompt', () => {
  it('adds the Apple Health weight to the curve on Add, then has nothing left to offer', async () => {
    act(() => root.render(<HealthWeightPrompt />))
    await flush()
    expect(host.textContent).toContain('74.6 kg')
    act(() => btn('Add').click())
    expect(useStore.getState().S.bodyweight).toEqual([expect.objectContaining({ d: today, w: 74.6 })])
    expect(useStore.getState().S.bodyweight[0].t).toBeGreaterThan(0)
    expect(host.textContent).toBe('')
  })

  it('Dismiss leaves the curve alone and is remembered on this device', async () => {
    act(() => root.render(<HealthWeightPrompt />))
    await flush()
    act(() => btn('Dismiss').click())
    expect(useStore.getState().S.bodyweight).toEqual([])
    expect(host.textContent).toBe('')
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<HealthWeightPrompt />))
    await flush()
    expect(host.textContent).toBe('')
  })

  it('asks the server nothing for a guest', async () => {
    useStore.setState({ user: null })
    act(() => root.render(<HealthWeightPrompt />))
    await flush()
    expect(api.loadHealthSamples).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })
})

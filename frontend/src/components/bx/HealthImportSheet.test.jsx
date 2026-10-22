// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listHookTokens: vi.fn(), createHookToken: vi.fn(), revokeHookToken: vi.fn(), loadHealthSamples: vi.fn(),
}))
vi.mock('../../lib/nutrition-api.js', () => api)
vi.mock('../../lib/api.js', () => ({ apiUrl: p => 'https://biscotos.example' + p }))

import HealthImportSheet from './HealthImportSheet.jsx'
import { useStore } from '../../store/useStore.js'
import { SHORTCUT_JSON } from '../../lib/health-guide.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

const TOKEN = 'bxh_' + 'D'.repeat(43)   // synthetic
let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const btn = text => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes(text))

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  api.listHookTokens.mockResolvedValue({ hooks: [{ id: 'h1', label: 'Old phone', createdAt: 1, lastUsedAt: null, revokedAt: null }] })
  api.loadHealthSamples.mockResolvedValue([{ type: 'steps', d: '2026-10-14', value: 9120, source: 'apple-health' }, { type: 'steps', d: '2026-10-12', value: 100, source: 'apple-health' }])
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('HealthImportSheet', () => {
  it('lists the Shortcut’s tokens only: the widget’s keys have their own sheet', async () => {
    api.listHookTokens.mockResolvedValue({ hooks: [
      { id: 'h1', label: 'Old phone', createdAt: 1, lastUsedAt: null, revokedAt: null },
      { id: 'w1', kind: 'widget', label: 'My widget key', createdAt: 1, lastUsedAt: null, revokedAt: null },
    ] })
    act(() => root.render(<HealthImportSheet onClose={() => {}} />))
    await flush()
    expect(document.body.textContent).toContain('Old phone')
    expect(document.body.textContent).not.toContain('My widget key')
  })

  it('lists tokens and the newest value of each received type', async () => {
    act(() => root.render(<HealthImportSheet onClose={() => {}} />))
    await flush()
    expect(document.body.textContent).toContain('Old phone')
    expect(document.body.textContent).toContain('9,120')
    expect(document.body.textContent).not.toContain('100 ')
  })

  it('shows a new token once with the webhook address, and forgets it on revoke', async () => {
    api.createHookToken.mockResolvedValue({ hook: { id: 'h2', label: 'iPhone', createdAt: 2 }, token: TOKEN })
    api.revokeHookToken.mockResolvedValue({ id: 'h2', label: 'iPhone', createdAt: 2, revokedAt: 3 })
    act(() => root.render(<HealthImportSheet onClose={() => {}} />))
    await flush()
    act(() => btn('Create a token').click())
    await flush()
    expect(api.createHookToken).toHaveBeenCalledWith('Apple Health')
    const values = [...document.querySelectorAll('input[readonly]')].map(i => i.value)
    expect(values).toEqual(['https://biscotos.example/api/hooks/apple-health', TOKEN])
    // revoke the fresh one: it disappears from the screen
    const revokeButtons = [...document.querySelectorAll('[role="dialog"] button')].filter(b => b.textContent === 'Revoke')
    act(() => revokeButtons[1].click())
    await flush()
    expect(api.revokeHookToken).toHaveBeenCalledWith('h2')
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(document.querySelectorAll('input[readonly]').length).toBe(0)
  })

  it('says so when five tokens are live', async () => {
    api.createHookToken.mockRejectedValue(Object.assign(new Error('full'), { status: 409 }))
    act(() => root.render(<HealthImportSheet onClose={() => {}} />))
    await flush()
    act(() => btn('Create a token').click())
    await flush()
    expect(document.body.textContent).toContain('Five tokens at most')
  })
  it('walks through building the Shortcut, with the text and the address to copy', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    act(() => root.render(<HealthImportSheet onClose={() => {}} />))
    await flush()
    expect(document.querySelector('summary').textContent).toBe('How to set up the Shortcut')
    expect(document.querySelectorAll('details ol > li').length).toBe(7)
    expect(document.querySelector('a[href*="icloud"]')).toBe(null)
    await act(async () => btn('Copy the text').click())
    expect(writeText).toHaveBeenLastCalledWith(SHORTCUT_JSON)
    await act(async () => btn('Copy the address').click())
    expect(writeText).toHaveBeenLastCalledWith('https://biscotos.example/api/hooks/apple-health')

    api.createHookToken.mockResolvedValue({ hook: { id: 'h2', label: 'iPhone', createdAt: 2 }, token: TOKEN })
    act(() => btn('Create a token').click())
    await flush()
    await act(async () => btn('Bearer').click())
    expect(writeText).toHaveBeenLastCalledWith('Bearer ' + TOKEN)
  })

  it('offers the shared Shortcut when the instance has one', async () => {
    const link = 'https://www.icloud.com/shortcuts/0123456789abcdef'
    useStore.setState({ config: { health_shortcut: link } })
    act(() => root.render(<HealthImportSheet onClose={() => {}} />))
    await flush()
    expect(document.querySelector('a[href*="icloud"]').getAttribute('href')).toBe(link)
    expect(document.querySelector('summary').textContent).toBe('Or build it yourself')
    useStore.setState({ config: null })
  })
})

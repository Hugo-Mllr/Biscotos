// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ listHookTokens: vi.fn(), createHookToken: vi.fn(), revokeHookToken: vi.fn() }))
vi.mock('../../lib/nutrition-api.js', () => api)
vi.mock('../../lib/api.js', () => ({ apiUrl: p => 'https://biscotos.example' + p }))

import WidgetSheet from './WidgetSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

const KEY = 'bxh_' + 'W'.repeat(43)   // synthetic
let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const btn = text => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes(text))

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  api.listHookTokens.mockResolvedValue({ hooks: [
    { id: 'h1', kind: 'apple-health', label: 'Shortcut', createdAt: 1, lastUsedAt: null, revokedAt: null },
    { id: 'w1', kind: 'widget', label: 'Old phone widget', createdAt: 1, lastUsedAt: null, revokedAt: null },
  ] })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('WidgetSheet', () => {
  it('lists the widget keys only, never the Shortcut’s', async () => {
    act(() => root.render(<WidgetSheet onClose={() => {}} />))
    await flush()
    expect(document.body.textContent).toContain('Old phone widget')
    expect(document.body.textContent).not.toContain('Shortcut')
  })

  it('makes a widget key and copies the whole script with it, without ever showing the key', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    api.createHookToken.mockResolvedValue({ hook: { id: 'w2', kind: 'widget', label: 'iPhone widget', createdAt: 2 }, token: KEY })
    act(() => root.render(<WidgetSheet onClose={() => {}} />))
    await flush()
    act(() => btn('Create a widget key').click())
    await flush()
    expect(api.createHookToken).toHaveBeenCalledWith('iPhone widget', 'widget')
    expect(document.body.textContent).not.toContain(KEY)
    await act(async () => btn('Copy the script').click())
    const script = writeText.mock.calls[0][0]
    expect(script).toContain('const BASE = "https://biscotos.example"')
    expect(script).toContain(`const KEY = "${KEY}"`)
    expect(script).toContain('api/hooks/widget')
    expect(document.body.textContent).toContain('Copied')
    expect(document.body.textContent).not.toContain(KEY)
  })

  it('revokes a key, and says so when five are live', async () => {
    api.revokeHookToken.mockResolvedValue({ id: 'w1', kind: 'widget', label: 'Old phone widget', createdAt: 1, revokedAt: 5 })
    act(() => root.render(<WidgetSheet onClose={() => {}} />))
    await flush()
    act(() => btn('Revoke').click())
    await flush()
    expect(api.revokeHookToken).toHaveBeenCalledWith('w1')
    expect(document.body.textContent).toContain('Revoked')
    api.createHookToken.mockRejectedValue(Object.assign(new Error('full'), { status: 409 }))
    act(() => btn('Create a widget key').click())
    await flush()
    expect(document.body.textContent).toContain('Five tokens at most')
  })
})

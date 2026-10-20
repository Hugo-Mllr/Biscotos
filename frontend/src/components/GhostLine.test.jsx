// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sapi = vi.hoisted(() => ({ loadGhosts: vi.fn() }))
vi.mock('../lib/social-api.js', () => sapi)

import GhostLine from './GhostLine.jsx'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 40)) }) }
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ user: null }) })
const mount = el => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(el)) }

describe('GhostLine', () => {
  it('shows the strongest friend for a signed-in profile, asking once for the screen', async () => {
    sapi.loadGhosts.mockResolvedValue({ ghosts: { bench: [{ name: 'Sam', kg: 100, reps: 5, e1rm: 116.7 }, { name: 'Lou', kg: 90, reps: 5, e1rm: 105 }] } })
    useStore.setState({ user: { id: 'u1', name: 'Me' } })
    mount(<><GhostLine id="bench" /><GhostLine id="squat" /></>)
    await settle()
    expect(sapi.loadGhosts).toHaveBeenCalledTimes(1)
    expect(sapi.loadGhosts.mock.calls[0][0].sort()).toEqual(['bench', 'squat'])
    expect(host.textContent).toContain('Sam: 100 kg × 5')
    expect(host.textContent).toContain('+1 friend')
    expect(host.querySelectorAll('.ghostline').length).toBe(1)
  })

  it('asks nothing when nobody is signed in', async () => {
    sapi.loadGhosts.mockClear()
    mount(<GhostLine id="row" />)
    await settle()
    expect(sapi.loadGhosts).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })
})

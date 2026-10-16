// @vitest-environment happy-dom
// Home's league card against a stubbed lib/social-api.js. Synthetic data only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
const api = vi.hoisted(() => ({ loadSocial: vi.fn(), loadLeaderboard: vi.fn() }))
vi.mock('../lib/social-api.js', () => api)
import LeagueToday from './LeagueToday.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); nav.mockReset(); api.loadSocial.mockReset(); api.loadLeaderboard.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe("Home's league card", () => {
  it('shows my place, points, gap and streak', async () => {
    api.loadSocial.mockResolvedValue({ circles: [{ id: 'c1', name: 'Les Démos' }] })
    api.loadLeaderboard.mockResolvedValue({ week: { rows: [{ points: 50, rank: 1 }, { me: true, points: 35, rank: 2, streak: { weeks: 4 } }] } })
    act(() => root.render(<LeagueToday />))
    await flush()
    expect(host.textContent).toContain('Les Démos')
    expect(host.textContent).toContain('#2 · 35 pts')
    expect(host.textContent).toContain('15 points to the next place.')
    expect(host.querySelector('.tag').textContent).toContain('4')
    act(() => host.querySelector('.lg-card').click())
    expect(nav).toHaveBeenCalledWith('/league')
  })
  it('invites to start without a circle', async () => {
    api.loadSocial.mockResolvedValue({ circles: [] })
    act(() => root.render(<LeagueToday />))
    await flush()
    expect(host.textContent).toContain('Challenge your friends')
    expect(api.loadLeaderboard).not.toHaveBeenCalled()
  })
})

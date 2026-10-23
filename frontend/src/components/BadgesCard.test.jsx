// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/social-api.js', () => ({ loadBadges: vi.fn() }))
import { loadBadges } from '../lib/social-api.js'
import BadgesCard from './BadgesCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const TIERS = { sessions: [10, 50], streak: [4, 12], records: [10] }
let host, root
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('BadgesCard', () => {
  it('shows the badges and the next tier, and celebrates nothing the first time', async () => {
    loadBadges.mockResolvedValue({ badges: [{ id: 'sessions', tier: 10 }], tiers: TIERS })
    act(() => root.render(<BadgesCard />)); await settle()
    expect(host.textContent).toContain('10 sessions')
    expect(host.textContent).toContain('50 sessions')
    expect(host.querySelector('.confetti')).toBeNull()
  })

  it('celebrates a badge gained since the last visit', async () => {
    localStorage.setItem('gym_badges_seen', JSON.stringify(['sessions:10']))
    loadBadges.mockResolvedValue({ badges: [{ id: 'sessions', tier: 50 }], tiers: TIERS })
    act(() => root.render(<BadgesCard />)); await settle()
    expect(host.querySelector('.confetti')).not.toBeNull()
  })

  it('renders nothing when the request fails', async () => {
    loadBadges.mockRejectedValue(new Error('x'))
    act(() => root.render(<BadgesCard />)); await settle()
    expect(host.firstChild).toBeNull()
  })
})

// @vitest-environment happy-dom
// The League screen against a stubbed lib/social-api.js. Synthetic data only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
const api = vi.hoisted(() => ({
  loadSocial: vi.fn(), savePrefs: vi.fn(), createCircle: vi.fn(), joinCircle: vi.fn(), leaveCircle: vi.fn(),
  renameCircle: vi.fn(), rotateCode: vi.fn(), removeMember: vi.fn(), deleteCircle: vi.fn(), loadLeaderboard: vi.fn(),
  loadFeed: vi.fn(), react: vi.fn(), setShame: vi.fn(),
  loadChallenge: vi.fn(() => Promise.resolve({ challenge: null, members: [] })),
  loadGym: vi.fn(() => Promise.resolve({ here: [], mine: false })), setGym: vi.fn(),
  socialProblem: e => (e?.data?.code === 'bad-code' ? 'bad-code' : 'unavailable'),
}))
vi.mock('../lib/social-api.js', () => api)

import League from './League.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

let host, root, saved
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const byText = (sel, text) => [...document.querySelectorAll(sel)].find(el => el.textContent.includes(text))
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const prefs = { training: true, prs: true, nutrition: false, notify: true }
const circle = { id: 'c1', name: 'Les Démos', code: 'ABCD-EFGH', owner: true, members: [
  { member: 'm1', name: 'Alex Demo', me: true, owner: true }, { member: 'm2', name: 'Sam Demo', me: false }, { member: 'm3', name: 'Lou Demo', me: false }] }
const row = (member, name, points, rank, extra = {}) => ({ member, name, points, rank, workouts: 2, breakdown: { sessions: 20, records: 25, progress: 0, plan: 0, nutrition: null }, streak: { weeks: 3, jokerAvailable: true }, ...extra })
const board = {
  circle: { id: 'c1', name: 'Les Démos' },
  week: { start: '2026-10-12', rows: [row('m2', 'Sam Demo', 120, 1), row('m1', 'Alex Demo', 90, 2, { me: true }), row('m3', 'Lou Demo', null, null, { breakdown: undefined, streak: undefined })] },
  lastWeek: { start: '2026-10-05', rows: [row('m1', 'Alex Demo', 40, 1, { me: true })] },
  season: { rows: [row('m1', 'Alex Demo', 400, 1, { me: true, weeks: 6 })] },
}

beforeEach(() => {
  saved = { S: useStore.getState().S, user: useStore.getState().user }
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1', name: 'Alex Demo' } })
  for (const f of Object.values(api)) if (f.mockReset) f.mockReset()
  api.loadFeed.mockResolvedValue({ events: [], choices: ['💪', '🔥'] })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState(saved); document.body.innerHTML = '' })

describe('League', () => {
  it('invites to start a circle when there is none, and joins one with a code and the sharing choices', async () => {
    api.loadSocial.mockResolvedValue({ prefs, circles: [] })
    api.joinCircle.mockResolvedValue(circle)
    api.loadLeaderboard.mockResolvedValue(board)
    act(() => root.render(<League />))
    await flush()
    expect(host.textContent).toContain('Train with your friends')
    act(() => byText('button', 'Create or join a circle').click())
    type(document.querySelector('.bx-input-code'), 'abcd efgh')
    const nutrition = [...document.querySelectorAll('.bx-toggle')].find(l => l.textContent.includes('calorie')).querySelector('input')
    act(() => nutrition.click())
    await act(async () => { document.querySelector('.bx-sheet form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(api.joinCircle).toHaveBeenCalledWith('abcd efgh', { training: true, prs: true, nutrition: true, notify: true })
    expect(host.textContent).toContain('Les Démos')
  })

  it('shows the podium, the ranking, my week and who does not share', async () => {
    api.loadSocial.mockResolvedValue({ prefs, circles: [circle] })
    api.loadLeaderboard.mockResolvedValue(board)
    act(() => root.render(<League />))
    await flush()
    expect(api.loadLeaderboard).toHaveBeenCalledWith('c1')
    expect(host.querySelectorAll('.bx-step')).toHaveLength(2)
    expect(host.querySelector('.bx-step-1').textContent).toContain('Sam Demo')
    expect(host.querySelector('.bx-lrow.is-me').textContent).toContain('You')
    expect(host.textContent).toContain('Does not share training')
    expect(host.textContent).toContain('30 points to the next place.')
    expect(host.querySelector('.bx-code').textContent).toBe('ABCD-EFGH')
    // a row opens on its breakdown
    act(() => host.querySelector('.bx-lrow.is-me .bx-item-main').click())
    expect(host.querySelector('.bx-breakdown').textContent).toContain('Personal record')
    expect(host.querySelector('.bx-breakdown').textContent).not.toContain('Day on target')
    // the season board
    act(() => byText('.bx-chip', 'Season').click())
    expect(host.textContent).toContain('6 weeks')
  })

  it('shows the feed and reacts in one tap', async () => {
    const ev = { id: 'e1', kind: 'workout', member: 'm2', name: 'Sam Demo', at: Date.now() - 3600e3, d: '2026-10-16', title: 'Push', minutes: 52, exercises: 5, records: 2, reactions: { counts: { '💪': 1 }, mine: null } }
    api.loadSocial.mockResolvedValue({ prefs, circles: [circle] })
    api.loadLeaderboard.mockResolvedValue(board)
    api.loadFeed.mockResolvedValue({ events: [ev, { id: 'e2', kind: 'joined', name: 'Lou Demo', at: Date.now() - 86400e3, reactions: { counts: {}, mine: null } }], choices: ['💪', '🔥'] })
    api.react.mockResolvedValue({ reactions: { counts: { '💪': 1, '🔥': 1 }, mine: '🔥' } })
    act(() => root.render(<League />))
    await flush()
    const item = host.querySelector('.bx-feed-item')
    expect(item.textContent).toContain('Sam Demo finished “Push”')
    expect(item.textContent).toContain('52 min')
    expect(item.textContent).toContain('2 records')
    expect(host.textContent).toContain('Lou Demo joined the circle')
    const fire = [...item.querySelectorAll('.bx-react')].find(b => b.textContent.startsWith('🔥'))
    await act(async () => { fire.click() })
    await flush()
    expect(api.react).toHaveBeenCalledWith('c1', 'e1', '🔥')
    expect(host.querySelector('.bx-react.is-mine').textContent).toBe('🔥1')
  })

  it('says why a code did not work', async () => {
    api.loadSocial.mockResolvedValue({ prefs, circles: [] })
    api.joinCircle.mockRejectedValue({ status: 404, data: { code: 'bad-code' } })
    act(() => root.render(<League />))
    await flush()
    act(() => byText('button', 'Create or join a circle').click())
    type(document.querySelector('.bx-input-code'), 'ZZZZ-ZZZZ')
    await act(async () => { document.querySelector('.bx-sheet form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(document.querySelector('.bx-sheet .bx-alert').textContent).toContain('No circle has this code')
  })

  it('asks for an account when signed out', async () => {
    useStore.setState({ user: null })
    act(() => root.render(<League />))
    await flush()
    expect(api.loadSocial).not.toHaveBeenCalled()
    expect(host.textContent).toContain('needs an account')
  })
})

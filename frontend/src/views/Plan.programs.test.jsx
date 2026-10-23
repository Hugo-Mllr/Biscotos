// @vitest-environment happy-dom
// Routines that share a program (lib/programs.js) are listed together under its name.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {},
    routines: [
      { id: 'r1', name: 'Mine', emoji: null, ex: [] },
      { id: 'r2', name: 'Push', emoji: null, ex: [], program: 'PPL' },
      { id: 'r3', name: 'Pull', emoji: null, ex: [], program: 'PPL' },
    ],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Plan />))

describe('Plan — programs', () => {
  it('lists the routines of a program under its name, the others first as they were', () => {
    mount()
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Routines').click())
    const groups = [...host.querySelectorAll('.plan-prog-g')]
    expect(groups.map(g => g.querySelector('.plan-prog')?.textContent || '')).toEqual(['', 'PPL2'])
    expect([...groups[1].querySelectorAll('.tt')].map(e => e.textContent)).toEqual(['Push', 'Pull'])
    expect(groups[0].querySelector('.tt').textContent).toBe('Mine')
  })
})

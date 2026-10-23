// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StreakCarrySheet from './StreakCarrySheet.jsx'
import { useStore } from '../../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })
let host, root
const btn = text => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes(text))
const type = v => act(() => {
  const input = document.querySelector('[role="dialog"] input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => { useStore.setState(st => ({ S: { ...st.S, workouts: [], streakCarry: null } })); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('StreakCarrySheet', () => {
  it('takes the weeks in a row of the other app, shows what the streak becomes, and saves it on the profile', () => {
    const onClose = vi.fn()
    act(() => root.render(<StreakCarrySheet onClose={onClose} />))
    expect(btn('Save').disabled).toBe(true)
    type('12')
    expect(document.body.textContent).toContain('12 week streak')
    expect(btn('Save').disabled).toBe(false)
    act(() => btn('Save').click())
    expect(useStore.getState().S.streakCarry.weeks).toBe(12)
    expect(useStore.getState().S.streakCarry.through).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses what is not a number of weeks', () => {
    act(() => root.render(<StreakCarrySheet onClose={() => {}} />))
    for (const v of ['0', 'abc', '12.5', '1000', '-3']) { type(v); expect(btn('Save').disabled, v).toBe(true) }
    type('520'); expect(btn('Save').disabled).toBe(false)
  })

  it('shows the saved number and removes it', () => {
    useStore.setState(st => ({ S: { ...st.S, streakCarry: { weeks: 30, through: '2026-10-08' } } }))
    act(() => root.render(<StreakCarrySheet onClose={() => {}} />))
    expect(document.querySelector('[role="dialog"] input').value).toBe('30')
    act(() => btn('Remove').click())
    expect(useStore.getState().S.streakCarry).toBe(null)
  })
})

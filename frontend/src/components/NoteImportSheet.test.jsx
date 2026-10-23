// @vitest-environment happy-dom
// The import sheet end to end: paste, read, change a match, add, undo. Synthetic notes only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteImportSheet } from './NoteImportSheet.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })

let host, root, saved, close
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve() }) }
const typeInput = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const byText = (sel, text) => [...document.querySelectorAll(sel)].find(el => el.textContent.includes(text))
const typeText = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => {
  saved = { S: useStore.getState().S }
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), routines: [{ id: 'keep', name: 'Mine', emoji: 'dumbbell', ex: [] }], unit: 'kg' } })
  close = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<NoteImportSheet close={close} />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState(saved); document.body.innerHTML = '' })

const NOTE = 'Push:\nBench press 4x8 80kg\nDips 3x10\n\nPull:\nPull up 3x8\nzzzzqqqq 3x5'

describe('NoteImportSheet', () => {
  it('cannot read an empty note', () => {
    expect(byText('button', 'Read my note').disabled).toBe(true)
  })

  it('shows what it understood, leaves what it could not match skipped, and adds only routines', async () => {
    typeText(host.querySelector('textarea'), NOTE)
    act(() => byText('button', 'Read my note').click())
    await flush()
    const names = [...host.querySelectorAll('input.input:not([data-search]):not([data-program])')].map(i => i.value)
    expect(names).toEqual(['Push', 'Pull'])
    expect(host.textContent).toContain('Bench press 4x8 80kg')
    expect(host.textContent).toContain('4 × 8 · 80 kg')                         // what the routine will ask for, load included
    expect(host.textContent).toContain('No match in the library')
    expect(byText('button', 'Add 2 routines')).toBeTruthy()

    typeInput(host.querySelector('input[data-program]'), 'PPL')                // one program for the whole import
    act(() => byText('button', 'Add 2 routines').click())
    const routines = useStore.getState().S.routines
    expect(routines.map(r => r.program)).toEqual([undefined, 'PPL', 'PPL'])
    expect(routines.map(r => r.name)).toEqual(['Mine', 'Push', 'Pull'])      // never replaces or reorders what exists
    expect(routines[1].ex.length).toBeGreaterThan(0)
    expect(routines[1].ex[0]).toMatchObject({ sets: 4, reps: 8, weight: 80 })
    expect(routines[2].ex).toHaveLength(1)                                    // the unmatched line was not added
    expect(close).toHaveBeenCalled()
  })

  it('skips a line the person chooses to skip, and the toast Undo takes the routines back out', async () => {
    typeText(host.querySelector('textarea'), 'Push:\nBench press 4x8 80kg\nDips 3x10')
    act(() => byText('button', 'Read my note').click())
    await flush()
    const select = host.querySelectorAll('select')[1]
    act(() => { select.value = '-1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    act(() => byText('button', 'Add 1 routine').click())
    const added = useStore.getState().S.routines.find(r => r.name === 'Push')
    expect(added.ex).toHaveLength(1)

    expect(useUI.getState().toastMsg).toContain('Push')
    expect(useUI.getState().toastAction?.label).toBe('Undo')
    act(() => useUI.getState().runToastAction())
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Mine'])   // only what was imported goes
  })

  it('says so when nothing in the note can be read, and goes back to edit', async () => {
    typeText(host.querySelector('textarea'), '80kg\n---\n42')
    act(() => byText('button', 'Read my note').click())
    await flush()
    expect(host.textContent).toContain('Nothing recognised in this note.')
    act(() => byText('button', 'Back').click())
    expect(host.querySelector('textarea').value).toBe('80kg\n---\n42')
  })
})

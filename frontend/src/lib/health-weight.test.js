import { describe, expect, it } from 'vitest'
import { weightSuggestions, addWeighIn, kgToUnit, suggestionKey, loadDismissed, saveDismissed } from './health-weight.js'

// Synthetic weights only.
const w = (d, value, extra = {}) => ({ type: 'weight', d, value, source: 'apple-health', ...extra })

describe('weightSuggestions', () => {
  it('offers the days the curve does not have, newest first, at most three', () => {
    const s = weightSuggestions([w('2026-10-10', 75.4), w('2026-10-12', 75.1), w('2026-10-13', 74.9), w('2026-10-14', 74.8), w('2026-10-15', 74.6)],
      [{ d: '2026-10-14', w: 75, t: 1 }], 'kg')
    expect(s).toEqual([{ d: '2026-10-15', kg: 74.6, w: 74.6 }, { d: '2026-10-13', kg: 74.9, w: 74.9 }, { d: '2026-10-12', kg: 75.1, w: 75.1 }])
  })

  it('never overrides a weigh-in the person logged, and ignores other types and sources', () => {
    expect(weightSuggestions([w('2026-10-14', 80)], [{ d: '2026-10-14', w: 75 }], 'kg')).toEqual([])
    expect(weightSuggestions([{ type: 'steps', d: '2026-10-14', value: 9000, source: 'apple-health' }, w('2026-10-14', 80, { source: 'strava' }), w('2026-10-14', 0)], [], 'kg')).toEqual([])
  })

  it('converts to the profile unit', () => {
    expect(weightSuggestions([w('2026-10-15', 80)], [], 'lb')[0].w).toBe(176.4)
    expect(kgToUnit(75.44, 'kg')).toBe(75.4)
  })

  it('leaves out a dismissed suggestion, but asks again when the value changes', () => {
    const first = weightSuggestions([w('2026-10-15', 74.6)], [], 'kg')
    const dismissed = [suggestionKey(first[0])]
    expect(weightSuggestions([w('2026-10-15', 74.6)], [], 'kg', dismissed)).toEqual([])
    expect(weightSuggestions([w('2026-10-15', 74.2)], [], 'kg', dismissed)).toHaveLength(1)
  })
})

describe('addWeighIn', () => {
  it('adds a dated entry in order, stamped for the sync merge', () => {
    const S = { bodyweight: [{ d: '2026-10-10', w: 76, t: 1 }, { d: '2026-10-20', w: 74, t: 1 }] }
    addWeighIn(S, '2026-10-15', 74.6, 99)
    expect(S.bodyweight.map(b => b.d)).toEqual(['2026-10-10', '2026-10-15', '2026-10-20'])
    expect(S.bodyweight[1]).toEqual({ d: '2026-10-15', w: 74.6, t: 99 })
  })
  it('replaces the value of a day that has one', () => {
    const S = { bodyweight: [{ d: '2026-10-15', w: 76, t: 1 }] }
    addWeighIn(S, '2026-10-15', 74.6, 99)
    expect(S.bodyweight).toEqual([{ d: '2026-10-15', w: 74.6, t: 99 }])
  })
})

describe('dismissed list', () => {
  it('round-trips and survives a broken or missing storage', () => {
    const mem = new Map()
    const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
    saveDismissed(['a', 'b'], storage)
    expect(loadDismissed(storage)).toEqual(['a', 'b'])
    expect(loadDismissed({ getItem: () => '{bad' })).toEqual([])
    expect(loadDismissed({ getItem: () => { throw new Error('denied') } })).toEqual([])
    expect(() => saveDismissed(['x'], { setItem: () => { throw new Error('quota') } })).not.toThrow()
  })
})

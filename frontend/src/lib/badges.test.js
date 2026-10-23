import { describe, it, expect } from 'vitest'
import { badgeKey, newBadges, nextBadges } from './badges.js'

const TIERS = { sessions: [10, 50], streak: [4, 12], records: [10] }

describe('badges', () => {
  it('names a badge by kind and tier', () => expect(badgeKey({ id: 'streak', tier: 12 })).toBe('streak:12'))
  it('never celebrates the first look', () => {
    expect(newBadges(null, [{ id: 'sessions', tier: 50 }])).toEqual([])
  })
  it('finds only the badges not seen yet', () => {
    const now = [{ id: 'sessions', tier: 50 }, { id: 'streak', tier: 4 }]
    expect(newBadges(['sessions:10', 'streak:4'], now)).toEqual([{ id: 'sessions', tier: 50 }])
    expect(newBadges(['sessions:50', 'streak:4'], now)).toEqual([])
  })
  it('gives the next tier of each kind, none for a finished kind', () => {
    expect(nextBadges([{ id: 'sessions', tier: 10 }, { id: 'records', tier: 10 }], TIERS))
      .toEqual([{ id: 'sessions', tier: 50 }, { id: 'streak', tier: 4 }])
  })
})

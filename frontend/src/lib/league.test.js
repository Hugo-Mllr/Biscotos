import { describe, expect, it } from 'vitest'
import { podium, myRow, gapToNext, initials, hueOf, RULES, ago } from './league.js'

const rows = [
  { name: 'A', points: 120, me: false }, { name: 'B', points: 90, me: true },
  { name: 'C', points: 90 }, { name: 'D', points: 0 }, { name: 'E', points: null },
]

describe('league helpers', () => {
  it('puts the top three in podium order, without zero or hidden scores', () => {
    expect(podium(rows).map(r => r.name)).toEqual(['B', 'A', 'C'])
    expect(podium(rows.slice(0, 2)).map(r => r.name)).toEqual(['A', 'B'])
    expect(podium([{ name: 'D', points: 0 }])).toEqual([])
  })
  it('finds my row and the gap to the next place', () => {
    expect(myRow({ rows }).name).toBe('B')
    expect(gapToNext(rows, rows[1])).toBe(30)
    expect(gapToNext(rows, rows[0])).toBe(0)
    expect(gapToNext(rows, rows[4])).toBe(null)
  })
  it('makes avatars', () => {
    expect(initials('Alex Demo')).toBe('AD')
    expect(initials('sam')).toBe('S')
    expect(initials('')).toBe('?')
    expect(hueOf('Alex')).toBe(hueOf('Alex'))
    expect(hueOf('Alex')).toBeGreaterThanOrEqual(0)
  })
  it('lists the same rules as the server', () => {
    expect(RULES.map(r => r.pts)).toEqual([10, 25, 30, 40, 5])
  })
})

describe('ago', () => {
  it('says how long ago, in the language asked', () => {
    const now = Date.parse('2026-10-16T12:00:00Z')
    expect(ago(now - 10e3, now, 'en')).toBe('this minute')
    expect(ago(now - 5 * 60e3, now, 'en')).toBe('5 min. ago')
    expect(ago(now - 3 * 3600e3, now, 'fr').replace(/\s/g, ' ')).toBe('il y a 3 h')
    expect(ago(now - 2 * 86400e3, now, 'en')).toBe('2 days ago')
  })
})

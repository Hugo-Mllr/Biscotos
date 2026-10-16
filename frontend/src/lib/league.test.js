import { describe, expect, it } from 'vitest'
import { podium, myRow, gapToNext, initials, hueOf, RULES } from './league.js'

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

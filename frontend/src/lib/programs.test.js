import { describe, expect, it } from 'vitest'
import { cleanProgram, programOf, groupRoutines, programNames, PROGRAM_MAX } from './programs.js'

const R = (id, program) => ({ id, name: id, program, ex: [] })

describe('programs', () => {
  it('cleans a name: one line, trimmed, short, text only', () => {
    expect(cleanProgram('  PPL \n 3 jours ')).toBe('PPL 3 jours')
    expect(cleanProgram('x'.repeat(100))).toHaveLength(PROGRAM_MAX)
    expect(cleanProgram(42)).toBe('')
    expect(cleanProgram(undefined)).toBe('')
    expect(programOf({})).toBe('')
  })

  it('groups routines by program where the first of each sits, and keeps the order inside', () => {
    const list = [R('a'), R('push', 'PPL'), R('b'), R('pull', 'PPL'), R('x', 'Haut/Bas'), R('legs', ' PPL ')]
    expect(groupRoutines(list).map(g => [g.name, g.routines.map(r => r.id)])).toEqual([
      ['', ['a', 'b']], ['PPL', ['push', 'pull', 'legs']], ['Haut/Bas', ['x']],
    ])
  })

  it('lists the names in use, without the empty one', () => {
    expect(programNames([R('a'), R('p', 'PPL'), R('q', 'PPL')])).toEqual(['PPL'])
    expect(groupRoutines(null)).toEqual([])
  })
})

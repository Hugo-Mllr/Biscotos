import { describe, expect, it } from 'vitest'
import { parseLine, parseNote, rankMatches, isExactMatch, buildRoutine, MAX_ROUTINES, MAX_ITEMS, NOTE_MAX_CHARS } from './note-import.js'
import { CATALOGUE } from './exercises.js'
import { modeOf } from './history.js'

describe('parseLine', () => {
  it('reads sets, reps and a load next to a name, in French or English', () => {
    expect(parseLine('Développé couché 4x8 80kg')).toMatchObject({ name: 'Développé couché', sets: 4, reps: 8, weight: 80, weightUnit: 'kg' })
    expect(parseLine('- Squat 5 x 5 @100')).toMatchObject({ name: 'Squat', sets: 5, reps: 5, weight: 100, weightUnit: null })
    expect(parseLine('1. Row 4×6')).toMatchObject({ name: 'Row', sets: 4, reps: 6 })
    expect(parseLine('Pompes 4 séries de 15')).toMatchObject({ name: 'Pompes', sets: 4, reps: 15 })
    expect(parseLine('Dips 3 sets of 10 reps')).toMatchObject({ name: 'Dips', sets: 3, reps: 10 })
    expect(parseLine('Tractions 10 reps')).toMatchObject({ name: 'Tractions', sets: null, reps: 10 })
  })

  it('keeps a rep range as its two ends, wherever the numbers are', () => {
    expect(parseLine('3x8-12 Rowing haltère')).toMatchObject({ name: 'Rowing haltère', sets: 3, repsMin: 8, reps: 12 })
    expect(parseLine('Curl 3x12-8')).toMatchObject({ sets: 3, repsMin: 8, reps: 12 })
  })

  it('reads decimals with a comma, pounds, and a load before the sets', () => {
    expect(parseLine('Curl 12,5kg 3x10')).toMatchObject({ name: 'Curl', weight: 12.5, sets: 3, reps: 10 })
    expect(parseLine('Bench 225 lbs 3x5')).toMatchObject({ weight: 225, weightUnit: 'lb' })
  })

  it('reads holds and cardio as time', () => {
    expect(parseLine('Gainage 3x45s')).toMatchObject({ name: 'Gainage', sets: 3, sec: 45, reps: null })
    expect(parseLine('Gainage 3x1min')).toMatchObject({ sets: 3, sec: 60 })
    expect(parseLine('Course 20 min')).toMatchObject({ name: 'Course', min: 20 })
    expect(parseLine('Planche 45s')).toMatchObject({ name: 'Planche', sec: 45 })
  })

  it('keeps a bare name, and drops what has no name or nothing at all', () => {
    expect(parseLine('Squat')).toMatchObject({ name: 'Squat', sets: null, reps: null, weight: null })
    expect(parseLine('80kg')).toBeNull()
    expect(parseLine('   ')).toBeNull()
    expect(parseLine('')).toBeNull()
    expect(parseLine(undefined)).toBeNull()
  })
})

describe('parseNote', () => {
  it('starts a routine at each titled block', () => {
    const r = parseNote('Push:\nDéveloppé couché 4x8 80kg\nDips 3x10\n\nPull:\nRowing 4x10')
    expect(r.routines.map(x => x.name)).toEqual(['Push', 'Pull'])
    expect(r.routines[0].items.map(i => i.name)).toEqual(['Développé couché', 'Dips'])
    expect(r.routines[1].items).toHaveLength(1)
  })

  it('takes a day or split name as a title even without a colon', () => {
    const r = parseNote('Lundi\nSquat 4x8\nLeg press 3x12\n\nMercredi\nPull ups 3x8')
    expect(r.routines.map(x => x.name)).toEqual(['Lundi', 'Mercredi'])
  })

  it('takes a day name as a title even when the library has an exercise of that name, but not a longer exercise name', () => {
    const isKnown = () => true
    const a = parseNote('Push\nBench 4x8\nDips 3x10', { isKnown })
    expect(a.routines.map(x => x.name)).toEqual(['Push'])
    const b = parseNote('Chest press\nBench 4x8', { isKnown })
    expect(b.routines).toHaveLength(1)
    expect(b.routines[0].name).toBeNull()
    expect(b.routines[0].items.map(i => i.name)).toEqual(['Chest press', 'Bench'])
    expect(parseNote('Leg day\nSquat 4x8').routines[0].name).toBe('Leg day')
    expect(parseNote('Jour 2\nSquat 4x8').routines[0].name).toBe('Jour 2')
  })

  it('takes the first line of a block as its title when the block has several lines', () => {
    const r = parseNote('Ma séance du matin\nSquat 4x8\nCurl 3x12')
    expect(r.routines).toHaveLength(1)
    expect(r.routines[0].name).toBe('Ma séance du matin')
    expect(r.routines[0].items).toHaveLength(2)
  })

  it('without any title, each blank-line block is one routine, unnamed', () => {
    const r = parseNote('Squat 4x8\nBench 4x8\n\nDeadlift 3x5')
    expect(r.routines.map(x => [x.name, x.items.length])).toEqual([[null, 2], [null, 1]])
  })

  it('counts a bare name as an exercise only when the library knows it', () => {
    const isKnown = n => n === 'Squat'
    const r = parseNote('Squat\nBench 4x8', { isKnown })
    expect(r.routines).toHaveLength(1)
    expect(r.routines[0].name).toBeNull()
    expect(r.routines[0].items.map(i => i.name)).toEqual(['Squat', 'Bench'])
  })

  it('ignores lines with no name and drops a title with nothing under it', () => {
    const r = parseNote('Rest day:\n\nPush:\nBench 4x8\n---')
    expect(r.routines.map(x => x.name)).toEqual(['Push'])
    expect(r.ignored).toBeGreaterThanOrEqual(2)
  })

  it('caps routines, exercises and text length, and says so', () => {
    const many = Array.from({ length: MAX_ROUTINES + 3 }, (_, i) => `Jour ${i + 1}:\nSquat 3x5`).join('\n\n')
    const a = parseNote(many)
    expect(a.routines).toHaveLength(MAX_ROUTINES)
    expect(a.truncated).toBe(true)
    const long = 'Push:\n' + Array.from({ length: MAX_ITEMS + 5 }, (_, i) => `Exo${i} 3x5`).join('\n')
    const b = parseNote(long)
    expect(b.routines[0].items).toHaveLength(MAX_ITEMS)
    expect(b.truncated).toBe(true)
    expect(() => parseNote('x'.repeat(NOTE_MAX_CHARS * 2))).not.toThrow()
  })

  it('answers an empty or odd input with no routines', () => {
    expect(parseNote('').routines).toEqual([])
    expect(parseNote(undefined).routines).toEqual([])
    expect(parseNote('\n\n  \n').routines).toEqual([])
    expect(parseNote(42).routines).toEqual([])
  })
})

describe('rankMatches / isExactMatch', () => {
  it('proposes library exercises for a name, best first, and nothing for nothing', () => {
    const out = rankMatches('bench press', CATALOGUE)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(5)
    expect(out[0].n.toLowerCase()).toBe('barbell bench press')     // the plain barbell one, not a variant
    expect(rankMatches('', CATALOGUE)).toEqual([])
    expect(rankMatches('zzzzqqqq', CATALOGUE)).toEqual([])
  })

  it('puts the exercises whose own name carries every word ahead of one found through a muscle', () => {
    const list = [
      { id: 'a', n: 'Kneeling Glute Press', bp: 'upper legs', tg: 'quadriceps', eq: 'body weight' },
      { id: 'b', n: 'Lever Seated Leg Press', bp: 'upper legs', tg: 'quadriceps', eq: 'leverage machine' }
    ]
    expect(rankMatches('leg press', list).map(e => e.id)[0]).toBe('b')
    expect(rankMatches('quadriceps press', list).map(e => e.id).sort()).toEqual(['a', 'b'])   // neither name has it: both stay offered
  })

  it('knows an exact name from a near one', () => {
    const ex = CATALOGUE[0]
    expect(isExactMatch(ex.n, ex)).toBe(true)
    expect(isExactMatch(ex.n.toUpperCase(), ex)).toBe(true)
    expect(isExactMatch('something else entirely', ex)).toBe(false)
    expect(isExactMatch('x', null)).toBe(false)
  })
})

describe('buildRoutine', () => {
  const reps = CATALOGUE.find(e => modeOf({ id: e.id }) === 'reps' && /bench press/i.test(e.n))
  const ids = () => { let n = 0; return () => 'r' + ++n }

  it('makes the stored routine from the confirmed picks, with the requested numbers', () => {
    const r = buildRoutine('Push', [{ exercise: reps, item: { sets: 4, reps: 8, repsMin: 6, weight: 80, weightUnit: 'kg' } }], { newId: ids() })
    expect(r).toMatchObject({ id: 'r1', name: 'Push', emoji: 'dumbbell' })
    expect(r.ex).toHaveLength(1)
    expect(r.ex[0]).toMatchObject({ id: reps.id, sets: 4, reps: 8, repsMin: 6, weight: 80 })
  })

  it('converts a load into the profile unit', () => {
    const lb = buildRoutine('A', [{ exercise: reps, item: { weight: 225, weightUnit: 'lb' } }], { unit: 'kg' }).ex[0].weight
    expect(lb).toBe(102)
    const kg = buildRoutine('A', [{ exercise: reps, item: { weight: 100, weightUnit: 'kg' } }], { unit: 'lb' }).ex[0].weight
    expect(kg).toBe(220.5)
    expect(buildRoutine('A', [{ exercise: reps, item: { weight: 80 } }], { unit: 'lb' }).ex[0].weight).toBe(80)
  })

  it('keeps the exercise defaults where the note says nothing, and clamps absurd numbers', () => {
    const plain = buildRoutine('A', [{ exercise: reps, item: {} }]).ex[0]
    expect(plain).toMatchObject({ sets: 3, reps: 10, weight: 0 })
    const wild = buildRoutine('A', [{ exercise: reps, item: { sets: 99, reps: 9999, weight: -5 } }]).ex[0]
    expect(wild.sets).toBe(20)
    expect(wild.reps).toBe(200)
    expect(wild.weight).toBe(0)
  })

  it('skips a pick with no exercise, and names a nameless routine', () => {
    const r = buildRoutine('  ', [{ exercise: null, item: {} }, { exercise: reps, item: {} }])
    expect(r.ex).toHaveLength(1)
    expect(r.name).toBe('Imported')
    expect(buildRoutine('x'.repeat(200), []).name).toHaveLength(60)
  })

  it('turns a reps exercise into a timed one when the note gives seconds or minutes, but not when it gives reps', () => {
    const a = buildRoutine('A', [{ exercise: reps, item: { sets: 3, sec: 45 } }]).ex[0]
    expect(a).toMatchObject({ mode: 'time', sets: 3, sec: 45 })
    const b = buildRoutine('A', [{ exercise: reps, item: { min: 2 } }]).ex[0]
    expect(b).toMatchObject({ mode: 'time', sec: 120 })
    const c = buildRoutine('A', [{ exercise: reps, item: { sets: 3, reps: 10, sec: 45 } }]).ex[0]
    expect(c).toMatchObject({ mode: 'reps', reps: 10 })
  })

  it('follows the exercise mode: a timed hold takes seconds, a cardio exercise takes minutes', () => {
    const timed = CATALOGUE.find(e => modeOf({ id: e.id }) === 'time')
    const cardio = CATALOGUE.find(e => modeOf({ id: e.id }) === 'cardio')
    if (timed) expect(buildRoutine('A', [{ exercise: timed, item: { sets: 3, sec: 60, reps: 99 } }]).ex[0]).toMatchObject({ sets: 3, sec: 60, mode: 'time' })
    if (cardio) expect(buildRoutine('A', [{ exercise: cardio, item: { min: 25 } }]).ex[0].min).toBe(25)
    expect(timed || cardio).toBeTruthy()
  })
})

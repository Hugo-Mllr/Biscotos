import { describe, expect, it } from 'vitest'
import { mealOfTitle, parseFoodLine, parseMenu, knownFoods, rankFoods, mergeCandidates, amountFor, MAX_GROUPS, MAX_LINES, MENU_MAX_CHARS } from './menu-import.js'

describe('mealOfTitle', () => {
  it('knows the four meals, in French and English, with a time or a colon', () => {
    expect(mealOfTitle('Petit-déj')).toBe('breakfast')
    expect(mealOfTitle('petit déjeuner :')).toBe('breakfast')
    expect(mealOfTitle('Breakfast')).toBe('breakfast')
    expect(mealOfTitle('Déjeuner 12h30')).toBe('lunch')
    expect(mealOfTitle('- Lunch (12:00)')).toBe('lunch')
    expect(mealOfTitle('Goûter')).toBe('snack')
    expect(mealOfTitle('Collation')).toBe('snack')
    expect(mealOfTitle('Dîner')).toBe('dinner')
    expect(mealOfTitle('Dinner:')).toBe('dinner')
  })

  it('does not take a food for a title', () => {
    expect(mealOfTitle('Déjeuner de poulet 150g')).toBeNull()
    expect(mealOfTitle('Soupe du soir')).toBeNull()
    expect(mealOfTitle('')).toBeNull()
    expect(mealOfTitle(undefined)).toBeNull()
  })
})

describe('parseFoodLine', () => {
  it('reads a weight or a volume, wherever it is, in grams', () => {
    expect(parseFoodLine('Riz 200g')).toMatchObject({ name: 'Riz', grams: 200, qty: null })
    expect(parseFoodLine('200 g de riz')).toMatchObject({ name: 'riz', grams: 200 })
    expect(parseFoodLine('- Poulet (150 g)')).toMatchObject({ name: 'Poulet', grams: 150 })
    expect(parseFoodLine('Lait 25cl')).toMatchObject({ name: 'Lait', grams: 250 })
    expect(parseFoodLine('Eau 1,5 l')).toMatchObject({ name: 'Eau', grams: 1500 })
    expect(parseFoodLine('Farine 0.5kg')).toMatchObject({ grams: 500 })
    expect(parseFoodLine('Jus 250ml')).toMatchObject({ grams: 250 })
  })

  it('reads a count, in digits or words, without taking an article out of a name', () => {
    expect(parseFoodLine('2 œufs')).toMatchObject({ name: 'œufs', qty: 2, grams: null })
    expect(parseFoodLine('2x yaourts')).toMatchObject({ name: 'yaourts', qty: 2 })
    expect(parseFoodLine('une pomme')).toMatchObject({ name: 'pomme', qty: 1 })
    expect(parseFoodLine('a banana')).toMatchObject({ name: 'banana', qty: 1 })
    expect(parseFoodLine('Apple')).toMatchObject({ name: 'Apple', qty: null })
    expect(parseFoodLine('Avocat')).toMatchObject({ name: 'Avocat', qty: null })
    expect(parseFoodLine('3 tranches de pain 90g')).toMatchObject({ name: 'tranches de pain', qty: 3, grams: 90 })
  })

  it('keeps a bare name, and drops what has no name', () => {
    expect(parseFoodLine('Skyr')).toMatchObject({ name: 'Skyr', grams: null, qty: null })
    expect(parseFoodLine('200g')).toBeNull()
    expect(parseFoodLine('---')).toBeNull()
    expect(parseFoodLine('  ')).toBeNull()
    expect(parseFoodLine(undefined)).toBeNull()
  })
})

describe('parseMenu', () => {
  it('puts each line under the meal title above it', () => {
    const r = parseMenu('Petit-déj:\nYaourt grec 150g\n2 œufs\n\nDéjeuner\nRiz 200g\nPoulet 150g\nDîner\nSoupe')
    expect(r.groups.map(g => [g.meal, g.items.length])).toEqual([['breakfast', 2], ['lunch', 2], ['dinner', 1]])
    expect(r.groups[0].items[1]).toMatchObject({ name: 'œufs', qty: 2 })
  })

  it('keeps lines before any title together with no meal', () => {
    const r = parseMenu('Pomme\nSkyr 150g\n\nDîner\nPâtes 100g')
    expect(r.groups.map(g => [g.meal, g.items.length])).toEqual([[null, 2], ['dinner', 1]])
  })

  it('counts what it could not read, and drops a title with nothing under it', () => {
    const r = parseMenu('Déjeuner\n200g\nRiz 100g\nDîner')
    expect(r.groups.map(g => g.meal)).toEqual(['lunch'])
    expect(r.ignored).toBe(1)
  })

  it('caps meals, lines and text length, and says so', () => {
    const many = Array.from({ length: MAX_GROUPS + 2 }, () => 'Dîner\nRiz 100g').join('\n')
    const a = parseMenu(many)
    expect(a.groups).toHaveLength(MAX_GROUPS)
    expect(a.truncated).toBe(true)
    const long = Array.from({ length: MAX_LINES + 5 }, (_, i) => `Food${i} 10g`).join('\n')
    const b = parseMenu(long)
    expect(b.groups[0].items).toHaveLength(MAX_LINES)
    expect(b.truncated).toBe(true)
    expect(() => parseMenu('x'.repeat(MENU_MAX_CHARS * 2))).not.toThrow()
  })

  it('answers an empty or odd input with nothing', () => {
    expect(parseMenu('').groups).toEqual([])
    expect(parseMenu(undefined).groups).toEqual([])
    expect(parseMenu(42).groups).toEqual([])
  })
})

describe('knownFoods / rankFoods / mergeCandidates / amountFor', () => {
  const per100 = { kcal: 100, protein: 10, carbs: 5, fat: 2 }
  const saved = [{ name: 'Riz basmati', per100 }]
  const log = [
    { id: '1', d: '2026-03-10', name: 'Oeufs durs', per100 },
    { id: '2', d: '2026-03-12', name: 'Oeufs durs', per100: { ...per100, kcal: 150 } },
    { id: '3', d: '2026-03-11', name: 'Yaourt grec', brand: 'Demo', per100 },
    { id: '4', d: '2026-03-11', name: 'No numbers' },
  ]
  const foods = knownFoods(saved, log)

  it('lists each of the person\'s foods once, the newest entry winning, and skips one with no numbers', () => {
    expect(foods.map(f => f.name)).toEqual(['Riz basmati', 'Oeufs durs', 'Yaourt grec'])
    expect(foods.find(f => f.name === 'Oeufs durs').per100.kcal).toBe(150)
    expect(knownFoods(undefined, undefined)).toEqual([])
  })

  it('finds a food that carries every word, ignoring accents, case and a plural', () => {
    expect(rankFoods('œufs', foods).map(f => f.name)).toEqual(['Oeufs durs'])   // the ligature is read as "oe"
    expect(rankFoods('oeufs', foods).map(f => f.name)).toEqual(['Oeufs durs'])
    expect(rankFoods('OEUF', foods).map(f => f.name)).toEqual(['Oeufs durs'])
    expect(rankFoods('yaourt grec', foods).map(f => f.name)).toEqual(['Yaourt grec'])
    expect(rankFoods('riz', foods).map(f => f.name)).toEqual(['Riz basmati'])
    expect(rankFoods('', foods)).toEqual([])
    expect(rankFoods('chocolat', foods)).toEqual([])
  })

  it('puts the exact name, then the shorter one, first', () => {
    const list = [{ name: 'Riz au lait', per100 }, { name: 'Riz', per100 }, { name: 'Riz complet bio', per100 }]
    expect(rankFoods('riz', list).map(f => f.name)).toEqual(['Riz', 'Riz au lait', 'Riz complet bio'])
  })

  it('merges own and online candidates, own first, each once, ignoring ones with no numbers', () => {
    const online = [{ name: 'Riz basmati', per100 }, { name: 'Riz blanc', per100 }, { name: 'Broken' }]
    expect(mergeCandidates([foods[0]], online).map(f => f.name)).toEqual(['Riz basmati', 'Riz blanc'])
    expect(mergeCandidates(undefined, undefined)).toEqual([])
    expect(mergeCandidates([], Array.from({ length: 10 }, (_, i) => ({ name: 'F' + i, per100 })), 3)).toHaveLength(3)
  })

  it('works the grams out from the amount written, else count x serving, else says it cannot', () => {
    expect(amountFor({ grams: 200 }, { serving: { grams: 50 } })).toBe(200)
    expect(amountFor({ qty: 2 }, { serving: { grams: 60 } })).toBe(120)
    expect(amountFor({ qty: 2 }, { per100 })).toBeNull()
    expect(amountFor({}, { serving: { grams: 60 } })).toBeNull()
    expect(amountFor(undefined, undefined)).toBeNull()
  })
})

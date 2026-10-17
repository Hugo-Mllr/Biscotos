import { describe, expect, it } from 'vitest'
import {
  macrosOf, totalsOf, byMeal, progress, energySplit, mealForHour, shiftDay, weekEnding, kcalByDay,
  toKg, bmi, bmiBand, parseAmount, entryFromFood, foodBarcode, lastMeal, repeatEntries
} from './nutrition.js'

// Synthetic foods only.
const oats = { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }
const skyr = { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }

describe('macrosOf / totalsOf', () => {
  it('scales per-100 g nutrients by the grams eaten', () => {
    expect(macrosOf({ grams: 60, per100: oats })).toEqual({ kcal: 223, protein: 8.1, carbs: 35.2, fat: 4.2 })
    expect(macrosOf({ grams: 0, per100: oats })).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('treats missing or broken numbers as zero instead of NaN', () => {
    expect(macrosOf({})).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
    expect(macrosOf({ grams: '100', per100: { kcal: 'x', protein: null } }).kcal).toBe(0)
  })

  it('adds entries without drifting decimals', () => {
    const t = totalsOf([{ grams: 60, per100: oats }, { grams: 150, per100: skyr }])
    expect(t).toEqual({ kcal: 318, protein: 24.6, carbs: 41.2, fat: 4.5 })
    expect(totalsOf([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
    expect(totalsOf(undefined).kcal).toBe(0)
  })
})

describe('byMeal', () => {
  it('groups one day by meal in a fixed order, ignoring other days and unknown meals', () => {
    const m = byMeal([
      { id: 1, d: '2026-10-14', meal: 'dinner' }, { id: 2, d: '2026-10-14', meal: 'breakfast' },
      { id: 3, d: '2026-10-13', meal: 'breakfast' }, { id: 4, d: '2026-10-14', meal: 'brunch' }
    ], '2026-10-14')
    expect(Object.keys(m)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(m.breakfast.map(e => e.id)).toEqual([2])
    expect(m.dinner.map(e => e.id)).toEqual([1])
    expect(m.lunch).toEqual([])
  })
})

describe('progress', () => {
  it('reports fraction, remaining and over', () => {
    expect(progress(1800, 2400)).toEqual({ fraction: 0.75, remaining: 600, over: false })
    expect(progress(2520, 2400)).toEqual({ fraction: 1.05, remaining: -120, over: true })
    expect(progress(2400, 2400).over).toBe(false)
  })
  it('has no fraction without a goal', () => {
    expect(progress(1800, null)).toEqual({ fraction: null, remaining: null, over: false })
    expect(progress(1800, 0).fraction).toBe(null)
  })
})

describe('energySplit', () => {
  it('weights fat at 9 kcal/g', () => {
    expect(energySplit({ protein: 100, carbs: 100, fat: 100 })).toEqual({ protein: 24, carbs: 24, fat: 53 })
    expect(energySplit({ protein: 0, carbs: 0, fat: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 })
  })
})

describe('days', () => {
  it('picks a meal from the hour', () => {
    expect([7, 12, 16, 20, 2].map(mealForHour)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'snack'])
  })
  it('shifts calendar days across months, years and DST', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2026-10-25', 1)).toBe('2026-10-26')   // EU DST end
    expect(weekEnding('2026-10-14')).toEqual(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'])
  })
  it('sums kcal per day for the chart, zero for empty days', () => {
    const days = ['2026-10-13', '2026-10-14']
    expect(kcalByDay([{ d: '2026-10-14', grams: 100, per100: oats }, { d: '2026-10-01', grams: 100, per100: oats }], days))
      .toEqual([{ d: '2026-10-13', kcal: 0 }, { d: '2026-10-14', kcal: 372 }])
  })
})

describe('body', () => {
  it('converts a weigh-in to kg from the profile unit', () => {
    expect(toKg(80, 'kg')).toBe(80)
    expect(toKg(176.37, 'lb')).toBeCloseTo(80, 1)
  })
  it('computes BMI and its WHO band', () => {
    expect(bmi(178, 75)).toBe(23.7)
    expect(bmi(null, 75)).toBe(null)
    expect(bmi(178, 0)).toBe(null)
    expect([17, 22, 27, 31].map(bmiBand)).toEqual(['under', 'normal', 'over', 'obese'])
    expect(bmiBand(null)).toBe(null)
  })
})

describe('input', () => {
  it('parses amounts typed with a comma or spaces, refuses the rest', () => {
    expect(parseAmount(' 45,5 ')).toBe(45.5)
    expect(parseAmount('60')).toBe(60)
    for (const bad of ['', 'abc', '-5', '1e3', '4.5.6', null]) expect(parseAmount(bad)).toBe(null)
  })

  it('builds a log entry from a food, keeping only what the server accepts', () => {
    const food = { id: 'f1', name: 'Skyr démo', brand: 'Demo', barcode: '3000000000017', source: 'off', per100: skyr, serving: { label: 'pot', grams: 150 }, createdAt: 1 }
    expect(entryFromFood(food, { d: '2026-10-14', meal: 'snack', grams: 150 })).toEqual({
      d: '2026-10-14', meal: 'snack', grams: 150, name: 'Skyr démo', brand: 'Demo', barcode: '3000000000017', source: 'off', per100: skyr
    })
    expect(entryFromFood({ name: 'x', per100: skyr, source: 'weird' }, { d: '2026-10-14', meal: 'lunch', grams: 1 }).source).toBe('manual')
  })

  it('accepts only digit codes that can be a food barcode', () => {
    expect(foodBarcode('3000000000017')).toBe('3000000000017')
    expect(foodBarcode(' 1234 5678 ')).toBe('12345678')
    for (const bad of ['https://evil.example', '1234567', 'ABC12345', null]) expect(foodBarcode(bad)).toBe(null)
  })
})

describe('lastMeal / repeatEntries', () => {
  const e = (id, d, meal, grams = 100) => ({ id, d, meal, grams, name: 'Skyr ' + id, per100: skyr, source: 'off', brand: 'Demo', barcode: '3000000000017' })
  const log = [e(1, '2026-03-14', 'breakfast'), e(2, '2026-03-16', 'breakfast', 150), e(3, '2026-03-16', 'breakfast', 60), e(4, '2026-03-16', 'lunch'), e(5, '2026-03-18', 'breakfast')]

  it('finds the latest earlier day with that meal, every entry of it', () => {
    const m = lastMeal(log, '2026-03-18', 'breakfast')
    expect(m.d).toBe('2026-03-16')
    expect(m.entries.map(x => x.id)).toEqual([2, 3])
  })

  it('ignores today, the future and other meals; null when there is nothing', () => {
    expect(lastMeal(log, '2026-03-16', 'lunch')).toBeNull()
    expect(lastMeal(log, '2026-03-14', 'breakfast')).toBeNull()
    expect(lastMeal(log, '2026-03-18', 'dinner')).toBeNull()
    expect(lastMeal([], '2026-03-18', 'breakfast')).toBeNull()
    expect(lastMeal(undefined, '2026-03-18', 'breakfast')).toBeNull()
  })

  it('turns them into new entries for the day and meal, keeping grams and food, never the old id or day', () => {
    const out = repeatEntries(lastMeal(log, '2026-03-18', 'breakfast').entries, { d: '2026-03-18', meal: 'snack' })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ d: '2026-03-18', meal: 'snack', grams: 150, name: 'Skyr 2', per100: skyr, source: 'off', brand: 'Demo', barcode: '3000000000017' })
    expect(out.every(x => !('id' in x))).toBe(true)
    expect(repeatEntries(undefined, { d: '2026-03-18', meal: 'snack' })).toEqual([])
  })
})

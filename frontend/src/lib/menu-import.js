// Biscotos: turn a pasted menu ("Petit-déj:\nYaourt grec 150g\n2 œufs\n\nDéjeuner\nRiz 200g ...") into
// food log entries.
//
// Pure helpers (menu-import.test.js). parseMenu() reads the text into meals and lines,
// rankFoods() finds the person's own foods for a name, amountFor() works out the grams. What
// to add is always confirmed in the import sheet: a line with no amount the app can work out
// stays out until the person types one, nothing is ever guessed into the log.
import { normalizeStr } from './exercises.js'

// Accents are already folded; the ligatures of French and Danish names are not ("œufs" is "oeufs").
const norm = s => normalizeStr(s).replace(/œ/g, 'oe').replace(/æ/g, 'ae')

export const MENU_MAX_CHARS = 10000
export const MAX_GROUPS = 8
export const MAX_LINES = 60

const BULLET = /^\s*(?:[-–—•·▪◦*]+|\[\s?[xX✓]?\s?\]|\d{1,2}[.)])\s+/

// A line that is only a meal title, with an optional time ("Déjeuner 12h30", "Dîner :").
const MEAL_TITLES = [
  ['breakfast', 'petit[ -]?d[ée]j(?:euner)?|pt[ -]?d[ée]j|breakfast'],
  ['lunch', 'd[ée]jeuner|midi|lunch'],
  ['snack', 'go[uû]ter|collations?|snacks?|en-?cas'],
  ['dinner', 'd[iî]ner|souper|soir|dinner|supper'],
].map(([meal, words]) => [meal, new RegExp('^(?:' + words + ')\\s*(?:\\(?\\d{1,2}\\s*[h:]\\s*\\d{0,2}\\)?)?\\s*:?\\s*$', 'i')])

const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grammes?|ml|cl|dl|l)\b/i
const COUNT = /^(?:(\d+(?:[.,]\d+)?)\s*(?:x\s*)?|(une?|one|an?|deux|trois|quatre|cinq)\s+)(?=\p{L})/iu
const WORDS = { un: 1, une: 1, one: 1, a: 1, an: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 }
const PER_UNIT = { kg: 1000, g: 1, gr: 1, gramme: 1, grammes: 1, ml: 1, cl: 10, dl: 100, l: 1000 }

const num = s => Number(String(s).replace(',', '.'))

/** 'breakfast' | 'lunch' | 'snack' | 'dinner' when the whole line is a meal title, else null. */
export function mealOfTitle(line) {
  const s = String(line || '').replace(BULLET, '').trim()
  for (const [meal, re] of MEAL_TITLES) if (re.test(s)) return meal
  return null
}

/** One line: { raw, name, grams, qty }. grams is a total in g (ml count as g); qty is "2" in "2 œufs". */
export function parseFoodLine(raw) {
  let s = String(raw || '').replace(BULLET, '').trim()
  if (!s) return null
  const item = { raw: String(raw).trim(), name: '', grams: null, qty: null }
  const m = AMOUNT.exec(s)
  if (m) {
    item.grams = Math.round(num(m[1]) * PER_UNIT[m[2].toLowerCase()] * 10) / 10
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)
  }
  s = s.trim()
  const c = COUNT.exec(s)
  if (c) {
    const q = c[1] ? num(c[1]) : WORDS[c[2].toLowerCase()]
    if (q > 0) { item.qty = q; s = s.slice(c[0].length) }
  }
  item.name = s.replace(/[:;,()|@]+/g, ' ').replace(/^\s*(?:de|d'|du|des|of|la|le|les|l')\s+/i, '').replace(/\s+-\s+|^-+|-+$/g, ' ').replace(/\s+/g, ' ').trim()
  return /\p{L}/u.test(item.name) ? item : null
}

/**
 * The meals in a text, in order: [{ meal: 'breakfast'|…|null, items }]. A title line sets the meal of
 * the lines under it; lines before any title have no meal (the sheet picks one from the hour).
 * @returns {{ groups: Array<{ meal: string|null, items: object[] }>, ignored: number, truncated: boolean }}
 */
export function parseMenu(text) {
  const lines = String(text || '').slice(0, MENU_MAX_CHARS).split('\n').map(l => l.trim()).filter(Boolean)
  const groups = []
  let cur = null, ignored = 0, truncated = false, count = 0
  const open = meal => {
    if (groups.length >= MAX_GROUPS) { truncated = true; cur = { meal, items: [], dropped: true }; return }
    cur = { meal, items: [] }; groups.push(cur)
  }
  for (const line of lines) {
    const title = mealOfTitle(line)
    if (title) { open(title); continue }
    const item = parseFoodLine(line)
    if (!item) { ignored++; continue }
    if (!cur) open(null)
    if (cur.dropped || count >= MAX_LINES) { truncated = true; continue }
    cur.items.push(item); count++
  }
  const kept = groups.filter(g => g.items.length)
  return { groups: kept, ignored, truncated }
}

const variants = w => [w, w.replace(/(?:s|x)$/, '')].filter((v, i, a) => v.length >= 2 && a.indexOf(v) === i)
const keyOf = f => [norm(f.name), norm(f.brand || ''), f.barcode || ''].join('|')

/** The person's foods (saved list and log), newest wins, each once: [{ name, brand?, barcode?, per100, serving? }]. */
export function knownFoods(savedFoods, log) {
  const seen = new Map()
  const add = f => {
    if (!f || !f.name || !f.per100 || seen.has(keyOf(f))) return
    seen.set(keyOf(f), { name: f.name, brand: f.brand, barcode: f.barcode, per100: f.per100, serving: f.serving, source: f.source, mine: true })
  }
  for (const f of savedFoods || []) add(f)
  for (const e of [...(log || [])].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))) add(e)
  return [...seen.values()]
}

/** Up to `limit` of the person's foods whose name carries every word of `name`, the plainest first. */
export function rankFoods(name, foods, limit = 3) {
  const tokens = norm(name).split(/[^a-z0-9]+/).filter(w => w.length >= 2)
  if (!tokens.length) return []
  const nq = tokens.join(' ')
  return (foods || [])
    .map((f, i) => ({ f, i, hay: norm(f.name + ' ' + (f.brand || '')), own: norm(f.name) }))
    .filter(x => tokens.every(w => variants(w).some(v => x.hay.includes(v))))
    .sort((a, b) => ((b.own === nq) - (a.own === nq)) || (a.own.length - b.own.length) || a.i - b.i)
    .slice(0, limit).map(x => x.f)
}

/** The person's own candidates first, then the online ones, each food once. */
export function mergeCandidates(own, online, limit = 6) {
  const seen = new Set(), out = []
  for (const f of [...(own || []), ...(online || [])]) {
    if (!f || !f.per100 || seen.has(keyOf(f))) continue
    seen.add(keyOf(f)); out.push(f)
  }
  return out.slice(0, limit)
}

/** Grams for a line and the food chosen for it: the amount written, else count × serving, else null. */
export function amountFor(item, food) {
  if (item?.grams > 0) return item.grams
  if (item?.qty > 0 && food?.serving?.grams > 0) return Math.round(item.qty * food.serving.grams * 10) / 10
  return null
}

// Biscotos: turn a pasted note ("Push: Développé couché 4x8 80kg ...") into routines.
//
// Pure helpers, no store and no DOM (note-import.test.js). parseNote() reads the text, rankMatches()
// proposes library exercises for a name, buildRoutine() makes the routine the plan screen stores.
// Nothing here decides anything silently: the import sheet shows every match and lets the person
// change or skip one before a routine is added, and an import only ever adds routines.
import { defaultConfig } from './history.js'
import { searchExercises, normalizeStr } from './exercises.js'
import { exerciseNameText, uid } from './format.js'

export const NOTE_MAX_CHARS = 20000
export const MAX_ROUTINES = 12
export const MAX_ITEMS = 40
const LB_TO_KG = 0.45359237

const BULLET = /^\s*(?:[-–—•·▪◦*]+|\[\s?[xX✓]?\s?\]|\d{1,2}[.)])\s+/
const DASHES = /[–—]/g

// A line that is nothing but a day or a split ("Push", "Leg day", "Upper body", "Jour 1", "Lundi"),
// in French and English. A longer name that merely starts with one ("Chest press") is an exercise.
const HEADING_WORD = new RegExp('^(?:' + [
  'jour', 'day', 's[ée]ance', 'session', 'workout', 'entra[iî]nement', 'training',
  'push', 'pull', 'legs?', 'jambes', 'upper', 'lower', 'full[ -]?body', 'haut', 'bas',
  'dos', 'pecs', 'torse', 'chest', 'back', '[ée]paules', 'shoulders', 'bras', 'arms', 'abdos', 'abs', 'cardio',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'
].join('|') + ')(?:\\s*(?:day|body|jour|[a-c]|\\d{1,2}))?\\s*$', 'i')

const SETS_REPS = /(\d{1,2})\s*[x×✕*]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?(?:\s*(s|sec|secs|seconds?|secondes?|"|min|mn|minutes?)\b)?/i
const SETS_WORD = /(\d{1,2})\s*(?:s[ée]ries?|sets?)\s*(?:de|of|x|:)?\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*(?:reps?|r[ée]p[ée]titions?|r[ée]ps?)?\b/i
const REPS_ONLY = /(\d{1,3})\s*(?:reps?|r[ée]p[ée]titions?|r[ée]ps?)\b/i
const WEIGHT_UNIT = /(\d+(?:\.\d+)?)\s*(kgs?|lbs?)\b/i
const WEIGHT_AT = /@\s*(\d+(?:\.\d+)?)\b/
const TIME_ALONE = /(\d{1,3})\s*(min|mn|minutes?|s|sec|secs|secondes?|seconds?)\b/i

const cut = (s, m) => (m ? s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length) : s)
const num = v => (v == null || v === '' ? null : Number(v))

/** What one line asks for, and the words left over (the exercise's name). null when nothing is left. */
export function parseLine(raw) {
  let s = String(raw || '').replace(BULLET, '').replace(DASHES, '-').replace(/(\d),(\d)/g, '$1.$2').trim()
  if (!s) return null
  const item = { raw: String(raw).trim(), name: '', sets: null, reps: null, repsMin: null, weight: null, weightUnit: null, sec: null, min: null }

  let m = WEIGHT_UNIT.exec(s)
  if (m) { item.weight = num(m[1]); item.weightUnit = /^lb/i.test(m[2]) ? 'lb' : 'kg'; s = cut(s, m) }
  else if ((m = WEIGHT_AT.exec(s))) { item.weight = num(m[1]); s = cut(s, m) }

  if ((m = SETS_REPS.exec(s))) {
    item.sets = num(m[1])
    const unit = (m[4] || '').toLowerCase()
    if (unit) item.sec = Math.round(num(m[2]) * (/^(min|mn|minute)/.test(unit) ? 60 : 1))
    else { item.reps = num(m[3] || m[2]); if (m[3]) item.repsMin = num(m[2]) }
    s = cut(s, m)
  } else if ((m = SETS_WORD.exec(s))) {
    item.sets = num(m[1]); item.reps = num(m[3] || m[2]); if (m[3]) item.repsMin = num(m[2]); s = cut(s, m)
  } else if ((m = REPS_ONLY.exec(s))) {
    item.reps = num(m[1]); s = cut(s, m)
  } else if ((m = TIME_ALONE.exec(s))) {
    const v = num(m[1])
    if (/^(min|mn|minute)/i.test(m[2])) item.min = v; else item.sec = v
    s = cut(s, m)
  }
  if (item.repsMin != null && item.repsMin > item.reps) [item.repsMin, item.reps] = [item.reps, item.repsMin]

  item.name = s.replace(/[:;,()@|]+/g, ' ').replace(/(^|\s)(?:à|a|de|of|at|avec|with|x)(?=\s|$)/gi, ' ').replace(/\s+-\s+|^-+|-+$/g, ' ').replace(/\s+/g, ' ').trim()
  return /\p{L}/u.test(item.name) ? item : null     // a name has a letter: "42" or "---" is not an exercise
}

const hasNumbers = item => item && (item.sets != null || item.reps != null || item.weight != null || item.sec != null || item.min != null)

/**
 * The routines in a text. A heading line (ends with ":", names a day or a split, or opens a block of
 * several lines) starts a routine; without any heading each blank-line block is one. A line with
 * nothing but a name is an exercise when `isKnown(name)` says the library has it.
 *
 * @returns {{ routines: Array<{ name: string|null, items: object[] }>, ignored: number, truncated: boolean }}
 */
export function parseNote(text, { isKnown = () => false } = {}) {
  const src = String(text || '').slice(0, NOTE_MAX_CHARS)
  const blocks = src.split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(b => b.length)
  const routines = []
  let ignored = 0, truncated = false, sawHeading = false
  let cur = null
  const start = name => {
    if (routines.length >= MAX_ROUTINES) { truncated = true; cur = { name, items: [], dropped: true }; return }
    cur = { name, items: [] }
    routines.push(cur)
  }
  const add = item => {
    if (cur.dropped) return
    if (cur.items.length >= MAX_ITEMS) { truncated = true; return }
    cur.items.push(item)
  }

  for (const block of blocks) {
    let blockStarted = false
    block.forEach((line, i) => {
      const item = parseLine(line)
      const bare = line.replace(BULLET, '').replace(/:+\s*$/, '').trim()
      if (!item) { ignored += line.replace(BULLET, '').trim() ? 1 : 0; return }
      const numbered = hasNumbers(item)
      const heading = !numbered && (
        /:\s*$/.test(line) || HEADING_WORD.test(item.name) || (i === 0 && block.length > 1 && !isKnown(item.name))
      )
      if (heading) { sawHeading = true; start(bare); blockStarted = true; return }
      if (!cur || (!sawHeading && !blockStarted)) { start(null); blockStarted = true }
      add(item)
    })
  }
  const kept = routines.filter(r => r.items.length)
  ignored += routines.length - kept.length
  return { routines: kept, ignored, truncated }
}

// When a name does not say which equipment ("Bench press", "Squat"), a barbell is what a note means.
const EQUIPMENT_RANK = { barbell: 0, 'body weight': 1, dumbbell: 2, 'leverage machine': 3, cable: 4, 'smith machine': 5 }
const wordCount = e => String(e?.n || '').split(/\s+/).filter(Boolean).length

/**
 * Up to `limit` library exercises for a name, best first. The app's multilingual search finds them;
 * among the closest ones the order then favours an exact name, then the exercises whose own name
 * carries every word of the note's line (a match through a muscle or an equipment field does not),
 * then the plainer name ("Barbell Bench Press" before "… Knees At 90 Degrees"), then the barbell. So
 * the first one is the exercise a note most likely means; the sheet still lets the person pick another.
 */
export function rankMatches(name, list, limit = 5) {
  const q = String(name || '').trim()
  if (!q) return []
  const nq = normalizeStr(q)
  const tokens = nq.split(/[^a-z0-9]+/).filter(w => w.length >= 2)
  const exact = e => normalizeStr(exerciseNameText(e)) === nq || normalizeStr(e.n) === nq
  const cover = e => {
    const hay = normalizeStr(exerciseNameText(e) + ' ' + e.n)
    return tokens.length ? tokens.filter(w => hay.includes(w)).length / tokens.length : 0
  }
  return searchExercises(list, q).slice(0, 20)
    .map((e, i) => ({ e, i, exact: exact(e) ? 1 : 0, cover: cover(e) }))
    .sort((a, b) => (b.exact - a.exact) || (b.cover - a.cover)
      || (wordCount(a.e) - wordCount(b.e))
      || ((EQUIPMENT_RANK[a.e.eq] ?? 6) - (EQUIPMENT_RANK[b.e.eq] ?? 6))
      || a.i - b.i)
    .slice(0, limit)
    .map(x => x.e)
}

/** True when a name leaves no doubt: the first candidate carries exactly that name. */
export function isExactMatch(name, exercise) {
  return !!exercise && normalizeStr(exerciseNameText(exercise)) === normalizeStr(name)
}

const toUnit = (w, from, to) => {
  if (w == null || !from || from === to) return w
  const kg = from === 'lb' ? w * LB_TO_KG : w
  const out = to === 'lb' ? kg / LB_TO_KG : kg
  return Math.round(out * 2) / 2
}

/**
 * The routine to store from the picks the person confirmed: [{ exercise, item }], in order. The
 * exercise's own mode wins (a plank is timed, a run is cardio) and a load is converted into the
 * profile's unit. Pure: the id comes from `newId`.
 */
export function buildRoutine(name, picks, { unit = 'kg', glyph = 'dumbbell', newId = uid } = {}) {
  const ex = []
  for (const { exercise, item } of picks) {
    if (!exercise) continue
    let base = defaultConfig(exercise.id)
    // A duration in the note ("Gainage 3x45s") makes it a timed set even where the library lists the
    // exercise by reps: the person wrote seconds, so the routine asks for seconds.
    const wantsTime = item.reps == null && (item.sec != null || item.min != null)
    if (wantsTime && base.mode === 'reps') base = defaultConfig(exercise.id, 'time')
    const cfg = { ...base }
    if (item.sets != null) cfg.sets = Math.max(1, Math.min(20, item.sets))
    if (cfg.mode === 'time') {
      const sec = item.sec ?? (item.min != null ? item.min * 60 : null)
      if (sec != null) cfg.sec = Math.max(1, Math.min(3600, sec))
    } else if (cfg.min != null && cfg.mode == null) {            // cardio: minutes, no reps
      if (item.min != null) cfg.min = Math.max(1, Math.min(600, item.min))
      else if (item.sec != null) cfg.min = Math.max(1, Math.round(item.sec / 60))
    } else {
      if (item.reps != null) cfg.reps = Math.max(1, Math.min(200, item.reps))
      if (item.repsMin != null && item.repsMin < cfg.reps) cfg.repsMin = item.repsMin
      if (item.weight != null) cfg.weight = Math.max(0, toUnit(item.weight, item.weightUnit, unit))
    }
    ex.push({ id: exercise.id, ...cfg })
  }
  return { id: newId(), name: String(name || '').trim().slice(0, 60) || 'Imported', emoji: glyph, ex }
}

/* Biscotos nutrition: validation and per-user storage (docs/ARCHITECTURE.md § 3.1).
 *
 * One file per profile, nutrition-<uid>.json under DATA_DIR, beside the openGym state document
 * and never merged into it: the sync engine of that document is not touched. The uid always
 * comes from the caller's session; an entry id is only ever looked up inside that profile's own
 * file, so another profile's id is simply "not found" (no IDOR by construction).
 *
 * Every write goes through the validators below: unknown fields are dropped, numbers are bounded,
 * strings are trimmed and capped. Nothing here logs a value — food names and intake are health
 * data. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = Object.freeze({
  LOG_MAX: 20000,          // ~18 entries a day for three years
  FOODS_MAX: 500,
  NAME_MAX: 120,
  BRAND_MAX: 80,
  SERVING_LABEL_MAX: 40,
  GRAMS_MAX: 5000,
  RANGE_DAYS_MAX: 93,      // one GET reads at most a quarter
  KCAL_100G_MAX: 900,      // pure fat is ~900 kcal/100 g
  GOAL_KCAL_MAX: 10000,
  GOAL_MACRO_MAX: 1000,
  HEIGHT_MIN: 50, HEIGHT_MAX: 260,
});
export const MEALS = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack']);
export const SOURCES = Object.freeze(['manual', 'off']);
const NUTRIENTS_100G = ['protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt'];

export class ValidationError extends Error {
  constructor(field, message) { super(`${field}: ${message}`); this.field = field; }
}
const fail = (field, msg) => { throw new ValidationError(field, msg); };

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function num(v, field, { min = 0, max, optional = false, decimals = 1 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    fail(field, 'required');
  }
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(field, 'not a number');
  if (n < min || n > max) fail(field, `out of range ${min}–${max}`);
  return round(n, decimals);
}

function str(v, field, { max, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    fail(field, 'required');
  }
  if (typeof v !== 'string') fail(field, 'not a string');
  // Control characters out (they have no place in a food name and break logs/CSV exports).
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) { if (optional) return undefined; fail(field, 'required'); }
  return s.slice(0, max);
}

/** YYYY-MM-DD that is a real calendar day between 2000 and 2100. */
export function isDay(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(d + 'T00:00:00Z');
  if (!Number.isFinite(t)) return false;
  const y = +d.slice(0, 4);
  return y >= 2000 && y <= 2100 && new Date(t).toISOString().slice(0, 10) === d;
}
const day = (v, field) => (isDay(v) ? v : fail(field, 'not a YYYY-MM-DD day'));

export const isBarcode = v => typeof v === 'string' && /^\d{8,14}$/.test(v);

/** Nutrients per 100 g. kcal required; the macros required and physically plausible. */
export function validatePer100(p, field = 'per100') {
  if (!isObj(p)) fail(field, 'required');
  const out = { kcal: num(p.kcal, field + '.kcal', { max: LIMITS.KCAL_100G_MAX, decimals: 0 }) };
  for (const k of NUTRIENTS_100G) {
    const v = num(p[k], `${field}.${k}`, { max: 100, optional: !['protein', 'carbs', 'fat'].includes(k), decimals: k === 'salt' ? 2 : 1 });
    if (v !== undefined) out[k] = v;
  }
  // 100 g cannot hold more than 100 g of macronutrients (small slack for rounded labels).
  if (out.protein + out.carbs + out.fat > 105) fail(field, 'macros exceed 100 g');
  return out;
}

function validateServing(s) {
  if (s === undefined || s === null) return undefined;
  if (!isObj(s)) fail('serving', 'not an object');
  return {
    label: str(s.label, 'serving.label', { max: LIMITS.SERVING_LABEL_MAX }),
    grams: num(s.grams, 'serving.grams', { min: 0.1, max: LIMITS.GRAMS_MAX }),
  };
}

function source(v) {
  if (v === undefined) return 'manual';
  return SOURCES.includes(v) ? v : fail('source', 'unknown');
}
function barcode(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return isBarcode(v) ? v : fail('barcode', 'must be 8–14 digits');
}

/** A food the person keeps in their own list (or froze from Open Food Facts). */
export function validateFood(input) {
  if (!isObj(input)) fail('food', 'not an object');
  const out = {
    name: str(input.name, 'name', { max: LIMITS.NAME_MAX }),
    brand: str(input.brand, 'brand', { max: LIMITS.BRAND_MAX, optional: true }),
    barcode: barcode(input.barcode),
    source: source(input.source),
    per100: validatePer100(input.per100),
    serving: validateServing(input.serving),
  };
  return dropUndefined(out);
}

/**
 * One line of the food log. With `partial` (an update) only the fields present are validated
 * and returned; there, `brand` or `barcode` set to null or '' comes back as undefined, meaning
 * "clear it" (applyUpdate).
 */
export function validateLogEntry(input, { partial = false } = {}) {
  if (!isObj(input)) fail('entry', 'not an object');
  const want = k => !partial || input[k] !== undefined;
  const out = {};
  if (want('d')) out.d = day(input.d, 'd');
  if (want('meal')) out.meal = MEALS.includes(input.meal) ? input.meal : fail('meal', 'unknown');
  if (want('grams')) out.grams = num(input.grams, 'grams', { min: 0.1, max: LIMITS.GRAMS_MAX });
  if (want('name')) out.name = str(input.name, 'name', { max: LIMITS.NAME_MAX });
  if (want('per100')) out.per100 = validatePer100(input.per100);
  if (want('source')) out.source = source(input.source);
  if (want('brand')) out.brand = str(input.brand, 'brand', { max: LIMITS.BRAND_MAX, optional: true });
  if (want('barcode')) out.barcode = barcode(input.barcode);
  if (!partial) return dropUndefined(out);
  if (!Object.keys(out).length) fail('entry', 'nothing to update');
  return out;
}

/** `target` with the validated `changes` of an update applied (undefined clears a field). */
export function applyUpdate(target, changes, now = Date.now()) {
  const next = { ...target };
  for (const [k, v] of Object.entries(changes)) { if (v === undefined) delete next[k]; else next[k] = v; }
  next.updatedAt = now;
  return next;
}

/** Daily targets; every field optional, null clears it. */
export function validateGoals(input) {
  if (input === null) return null;
  if (!isObj(input)) fail('goals', 'not an object');
  const out = {
    kcal: num(input.kcal, 'goals.kcal', { min: 0, max: LIMITS.GOAL_KCAL_MAX, optional: true, decimals: 0 }),
    protein: num(input.protein, 'goals.protein', { max: LIMITS.GOAL_MACRO_MAX, optional: true, decimals: 0 }),
    carbs: num(input.carbs, 'goals.carbs', { max: LIMITS.GOAL_MACRO_MAX, optional: true, decimals: 0 }),
    fat: num(input.fat, 'goals.fat', { max: LIMITS.GOAL_MACRO_MAX, optional: true, decimals: 0 }),
  };
  const clean = dropUndefined(out);
  return Object.keys(clean).length ? clean : null;
}

// The body profile behind the calculated daily goal (frontend/src/lib/body.js). Everything is
// optional and only a key that is present is changed: a null clears it, an absent key stays.
export const SEXES = Object.freeze(['m', 'f']);
export const ACTIVITY_LEVELS = Object.freeze(['low', 'mid', 'high']);
export const GOAL_MODES = Object.freeze(['manual', 'cut', 'maintain', 'bulk', 'recomp']);
export const PACES = Object.freeze(['gentle', 'steady', 'fast']);

function pick(v, field, list) {
  if (v === null || v === '') return null;
  if (!list.includes(v)) fail(field, `one of ${list.join(', ')}`);
  return v;
}

export function validateProfile(input, { year = new Date().getFullYear() } = {}) {
  if (!isObj(input)) fail('profile', 'not an object');
  const out = {};
  const has = k => k in input && input[k] !== undefined;
  if (has('heightCm')) {
    out.heightCm = input.heightCm === null ? null
      : num(input.heightCm, 'profile.heightCm', { min: LIMITS.HEIGHT_MIN, max: LIMITS.HEIGHT_MAX, optional: true }) ?? null;
  }
  if (has('birthYear')) {
    out.birthYear = input.birthYear === null ? null
      : num(input.birthYear, 'profile.birthYear', { min: year - 110, max: year - 10, optional: true, decimals: 0 }) ?? null;
  }
  if (has('bodyFatPct')) {
    out.bodyFatPct = input.bodyFatPct === null ? null
      : num(input.bodyFatPct, 'profile.bodyFatPct', { min: 3, max: 60, optional: true }) ?? null;
  }
  if (has('sex')) out.sex = pick(input.sex, 'profile.sex', SEXES);
  if (has('activity')) out.activity = pick(input.activity, 'profile.activity', ACTIVITY_LEVELS);
  if (has('goalMode')) out.goalMode = pick(input.goalMode, 'profile.goalMode', GOAL_MODES);
  if (has('pace')) out.pace = pick(input.pace, 'profile.pace', PACES);
  if (has('calibration')) {
    out.calibration = input.calibration === null ? null
      : num(input.calibration, 'profile.calibration', { min: -500, max: 500, optional: true, decimals: 0 }) ?? null;
  }
  if (has('calibrate')) {
    if (input.calibrate !== null && typeof input.calibrate !== 'boolean') fail('profile.calibrate', 'a boolean');
    out.calibrate = input.calibrate === true;
  }
  return out;
}

function dropUndefined(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/* ------------------------------------------------------------- storage -- */

export const newId = () => crypto.randomBytes(9).toString('base64url');

export function emptyDoc() {
  return { v: 1, profile: { heightCm: null }, goals: null, foods: [], log: [] };
}

/** Only [A-Za-z0-9_-] of the uid, as server.js's stateFile does. */
export function nutritionFile(dataDir, uid) {
  const safe = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('empty uid');
  return path.join(dataDir, 'nutrition-' + safe + '.json');
}

export class UnreadableError extends Error {}

/** The profile's document; an empty one when there is none yet. A damaged file is never
 *  silently replaced by an empty one (the next write would erase the history). */
export function readDoc(dataDir, uid) {
  let raw;
  try { raw = fs.readFileSync(nutritionFile(dataDir, uid), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return emptyDoc(); throw e; }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new UnreadableError('nutrition file unreadable'); }
  if (!isObj(doc)) throw new UnreadableError('nutrition file unreadable');
  return {
    v: 1,
    profile: isObj(doc.profile) ? doc.profile : { heightCm: null },
    goals: isObj(doc.goals) ? doc.goals : null,
    foods: Array.isArray(doc.foods) ? doc.foods.filter(isObj) : [],
    log: Array.isArray(doc.log) ? doc.log.filter(isObj) : [],
  };
}

export function writeDoc(dataDir, uid, doc, atomicWrite) {
  atomicWrite(nutritionFile(dataDir, uid), JSON.stringify(doc), 0o600);
}

export function removeDoc(dataDir, uid) {
  try { fs.unlinkSync(nutritionFile(dataDir, uid)); } catch { /* none */ }
}

/** Log entries with lo <= d <= hi, newest day first then oldest-created first. */
export function entriesBetween(doc, lo, hi) {
  return doc.log
    .filter(e => typeof e.d === 'string' && e.d >= lo && e.d <= hi)
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (a.createdAt || 0) - (b.createdAt || 0)));
}

/** Days between two YYYY-MM-DD (inclusive count). */
export function spanDays(lo, hi) {
  return Math.round((Date.parse(hi + 'T00:00:00Z') - Date.parse(lo + 'T00:00:00Z')) / 86400000) + 1;
}

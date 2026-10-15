/* Biscotos data portability (docs/QUESTIONS.md Q6): a profile can take its nutrition and imported
 * health data away as one JSON file, bring such a file back, and erase it all.
 *
 *   GET  /api/nutrition/export   everything of the caller's: goals, height, foods, food log,
 *                                imported health samples. Never a token or its hash.
 *   POST /api/nutrition/import   a file from the export. Every entry goes through the same
 *                                validators as one typed by hand or sent by the webhook; what fails
 *                                is counted and skipped, never stored. Merges by default (an entry
 *                                whose id is already there is kept as it is); mode 'replace' swaps
 *                                the nutrition data whole.
 *   POST /api/nutrition/erase    deletes the caller's nutrition file, health samples and webhook
 *                                tokens. Needs { confirm: 'erase' } so no stray request does it.
 *
 * The profile is always the session's; nothing here takes a uid. */
import {
  LIMITS, ValidationError, UnreadableError, validateFood, validateLogEntry, validateGoals,
  validateProfile, readDoc, writeDoc, removeDoc, emptyDoc, newId
} from './store.js';
import { validateSample, mergeSamples, readHealth, writeHealth, removeHealth, SAMPLES_MAX } from '../health/store.js';
import { forgetHealthUser } from '../health/routes.js';

export const EXPORT_FORMAT = 'biscotos-nutrition';
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);

/** The export file of a profile. */
export function buildExport(nutrition, health, now = Date.now()) {
  return {
    format: EXPORT_FORMAT, version: 1, exportedAt: new Date(now).toISOString(),
    nutrition: { profile: nutrition.profile, goals: nutrition.goals, foods: nutrition.foods, log: nutrition.log },
    health: { samples: health.samples.map(({ at, ...s }) => s) },
  };
}

/**
 * Validates an export file into what may be stored. Pure: returns the clean pieces and counts,
 * throws ValidationError only when the file is not an export at all.
 */
export function parseImport(file, { now = Date.now() } = {}) {
  if (!isObj(file) || file.format !== EXPORT_FORMAT) throw new ValidationError('format', `not a ${EXPORT_FORMAT} file`);
  if (file.version !== 1) throw new ValidationError('version', 'unsupported version');
  const n = isObj(file.nutrition) ? file.nutrition : {};
  const out = { foods: [], log: [], samples: [], skipped: 0, goals: undefined, profile: undefined };
  const keep = (raw, validate) => {
    try {
      const v = validate(raw);
      const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : newId();
      const created = Number.isFinite(raw.createdAt) && raw.createdAt > 0 && raw.createdAt <= now ? raw.createdAt : now;
      return { id, ...v, createdAt: created, updatedAt: now };
    } catch (e) {
      if (e instanceof ValidationError) { out.skipped++; return null; }
      throw e;
    }
  };
  for (const f of list(n.foods).slice(0, LIMITS.FOODS_MAX)) { const v = isObj(f) && keep(f, validateFood); if (v) out.foods.push(v); else if (!isObj(f)) out.skipped++; }
  for (const e of list(n.log).slice(0, LIMITS.LOG_MAX)) { const v = isObj(e) && keep(e, validateLogEntry); if (v) out.log.push(v); else if (!isObj(e)) out.skipped++; }
  out.skipped += Math.max(0, list(n.foods).length - LIMITS.FOODS_MAX) + Math.max(0, list(n.log).length - LIMITS.LOG_MAX);
  try { if ('goals' in n) out.goals = validateGoals(n.goals); } catch { out.skipped++; }
  try { if (isObj(n.profile)) out.profile = validateProfile(n.profile); } catch { out.skipped++; }
  const h = isObj(file.health) ? file.health : {};
  for (const s of list(h.samples).slice(0, SAMPLES_MAX)) {
    // Provenance is never rewritten: only samples this importer can carry as what they are.
    // (Strava data, when it exists, must stay marked as Strava — docs/ARCHITECTURE.md.)
    if (!isObj(s) || (s.source !== undefined && s.source !== 'apple-health')) { out.skipped++; continue; }
    try { out.samples.push(validateSample({ type: s.type, date: s.d, value: s.value, id: s.extId })); }
    catch { out.skipped++; }
  }
  return out;
}

export function portabilityRoutes({ json, readBody, readSession, tooMany, createWindow, audit, dataDir, atomicWrite }) {
  const BUDGET = createWindow({ max: 10, windowMs: 60000 });
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    const wait = BUDGET.take(user.id);
    if (wait) { tooMany(res, wait); return null; }
    return user;
  };
  const unreadable = res => { console.error('portability: a nutrition or health file is unreadable'); json(res, 503, { error: 'data unreadable' }); };

  return {
    'GET /api/nutrition/export': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      let nutrition, health;
      try { nutrition = readDoc(dataDir, user.id); health = readHealth(dataDir, user.id); }
      catch (e) { if (e instanceof UnreadableError || /unreadable/.test(e.message)) return unreadable(res); throw e; }
      json(res, 200, buildExport(nutrition, health), { 'Content-Disposition': 'attachment; filename="biscotos-nutrition.json"' });
    },

    'POST /api/nutrition/import': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      const mode = body?.mode === 'replace' ? 'replace' : 'merge';
      let parsed;
      try { parsed = parseImport(body?.file); }
      catch (e) { if (e instanceof ValidationError) return json(res, 400, { error: e.message, field: e.field }); throw e; }
      let doc, health;
      try { doc = readDoc(dataDir, user.id); health = readHealth(dataDir, user.id); }
      catch (e) { if (e instanceof UnreadableError || /unreadable/.test(e.message)) return unreadable(res); throw e; }
      if (mode === 'replace') doc = { ...emptyDoc(), profile: doc.profile, goals: doc.goals };
      const add = (into, items, max) => {
        const have = new Set(into.map(x => x.id));
        let n = 0;
        for (const x of items) { if (have.has(x.id) || into.length >= max) continue; into.push(x); have.add(x.id); n++; }
        return n;
      };
      const added = { foods: add(doc.foods, parsed.foods, LIMITS.FOODS_MAX), log: add(doc.log, parsed.log, LIMITS.LOG_MAX) };
      if (parsed.goals !== undefined && (mode === 'replace' || doc.goals == null)) doc.goals = parsed.goals;
      if (parsed.profile && (mode === 'replace' || doc.profile?.heightCm == null)) doc.profile = { ...doc.profile, ...parsed.profile };
      added.samples = mergeSamples(health, parsed.samples);
      writeDoc(dataDir, user.id, doc, atomicWrite);
      if (added.samples) writeHealth(dataDir, user.id, health, atomicWrite);
      audit(req, 'nutrition.import', { user, msg: mode });
      json(res, 200, { mode, added, skipped: parsed.skipped });
    },

    'POST /api/nutrition/erase': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      if (body?.confirm !== 'erase') return json(res, 400, { error: 'send { "confirm": "erase" }', field: 'confirm' });
      removeDoc(dataDir, user.id);
      removeHealth(dataDir, user.id);
      try { forgetHealthUser(dataDir, user.id, atomicWrite); }
      catch { return unreadable(res); }
      audit(req, 'nutrition.erase', { user });
      json(res, 200, { ok: true });
    },
  };
}

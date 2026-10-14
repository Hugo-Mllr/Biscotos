/* Biscotos nutrition routes (docs/ARCHITECTURE.md § 3.1, § 4). Spread into server.js's route
 * table like coachRoutes; documented in openapi.yaml (test/openapi-routes.test.js).
 *
 * Authorization model, the same on every route:
 *   - the profile is the session's (readSession), never a parameter;
 *   - an entry or food id is looked up only inside that profile's own file, so an id belonging
 *     to someone else answers 404 exactly like one that never existed (nothing to enumerate);
 *   - every write is validated (store.js) — unknown fields dropped, numbers bounded.
 * Each route has its own "another profile gets 404/401" test (test/nutrition-routes.test.js).
 *
 * Read-modify-write of a profile's file is synchronous between the read and the atomic write,
 * so two requests of the same profile cannot interleave inside one process. */
import {
  LIMITS, ValidationError, UnreadableError, validateFood, validateLogEntry, validateGoals,
  validateProfile, applyUpdate, readDoc, writeDoc, entriesBetween, spanDays, isDay, newId
} from './store.js';
import { OffError } from './off.js';

const LANG_RE = /^[a-z]{2}$/;

export function nutritionRoutes({ json, readBody, readSession, tooMany, createWindow, dataDir, atomicWrite, off }) {
  // Per profile: food lookups (they cost an upstream call on a cache miss) and writes (disk).
  const LOOKUPS = createWindow({ max: 30, windowMs: 60000 });
  const WRITES = createWindow({ max: 120, windowMs: 60000 });

  const signedIn = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    return user;
  };
  const query = req => new URL(req.url, 'http://x').searchParams;

  /** Runs `fn(doc)` on the profile's document and saves it if `fn` returns { save: true }. */
  function withDoc(res, uid, fn) {
    let doc;
    try { doc = readDoc(dataDir, uid); }
    catch (e) {
      // Never the content, never the uid's data: just that a file could not be read.
      if (e instanceof UnreadableError) { console.error('nutrition: unreadable file for a profile'); return json(res, 503, { error: 'nutrition data unreadable' }); }
      throw e;
    }
    let out;
    try { out = fn(doc); }
    catch (e) {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message, field: e.field });
      throw e;
    }
    if (out.save) writeDoc(dataDir, uid, doc, atomicWrite);
    return json(res, out.status || 200, out.body);
  }

  /** Signed in and within the write budget; the parsed body otherwise null (already answered). */
  async function writer(req, res) {
    const user = signedIn(req, res); if (!user) return [null];
    const wait = WRITES.take(user.id);
    if (wait) { tooMany(res, wait); return [null]; }
    const body = await readBody(req);
    return [user, body && typeof body === 'object' && !Array.isArray(body) ? body : {}];
  }
  const idOf = body => (typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(body.id) ? body.id : null);

  async function lookup(req, res, fn) {
    const user = signedIn(req, res); if (!user) return;
    if (!off) return json(res, 503, { error: 'food search is turned off on this server', code: 'off' });
    const wait = LOOKUPS.take(user.id);
    if (wait) return tooMany(res, wait);
    const q = query(req);
    const lang = LANG_RE.test(q.get('lang') || '') ? q.get('lang') : 'fr';
    try { return await fn(q, lang); }
    catch (e) {
      if (!(e instanceof OffError)) throw e;
      if (e.code === 'not-found') return json(res, 404, { error: 'unknown product', code: 'not-found' });
      if (e.code === 'busy') return json(res, 503, { error: e.message, code: 'busy' }, { 'Retry-After': String(e.retryAfter || 10) });
      return json(res, 502, { error: 'food database unavailable', code: 'unavailable' });
    }
  }

  return {
    // The profile's goals, height, own foods, and the log between two days (at most a quarter).
    'GET /api/nutrition': async (req, res) => {
      const user = signedIn(req, res); if (!user) return;
      const q = query(req);
      const from = q.get('from'), to = q.get('to');
      if (!isDay(from) || !isDay(to) || from > to) return json(res, 400, { error: 'from and to must be YYYY-MM-DD days, from <= to' });
      if (spanDays(from, to) > LIMITS.RANGE_DAYS_MAX) return json(res, 400, { error: `at most ${LIMITS.RANGE_DAYS_MAX} days per request` });
      return withDoc(res, user.id, doc => ({
        body: { profile: doc.profile, goals: doc.goals, foods: doc.foods, log: entriesBetween(doc, from, to), from, to }
      }));
    },

    'PUT /api/nutrition/settings': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      return withDoc(res, user.id, doc => {
        if (!('goals' in body) && !('profile' in body)) throw new ValidationError('settings', 'goals or profile required');
        if ('goals' in body) doc.goals = validateGoals(body.goals);
        if ('profile' in body) doc.profile = { ...doc.profile, ...validateProfile(body.profile) };
        return { save: true, body: { profile: doc.profile, goals: doc.goals } };
      });
    },

    'POST /api/nutrition/log': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      return withDoc(res, user.id, doc => {
        const entry = validateLogEntry(body);
        if (doc.log.length >= LIMITS.LOG_MAX) return { status: 409, body: { error: 'food log is full', code: 'full' } };
        const now = Date.now();
        const saved = { id: newId(), ...entry, createdAt: now, updatedAt: now };
        doc.log.push(saved);
        return { save: true, status: 201, body: { entry: saved } };
      });
    },

    'POST /api/nutrition/log/update': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      const id = idOf(body);
      return withDoc(res, user.id, doc => {
        const i = id ? doc.log.findIndex(e => e.id === id) : -1;
        if (i < 0) return { status: 404, body: { error: 'no such entry' } };
        const { id: _drop, ...changes } = body;
        doc.log[i] = applyUpdate(doc.log[i], validateLogEntry(changes, { partial: true }));
        return { save: true, body: { entry: doc.log[i] } };
      });
    },

    'POST /api/nutrition/log/delete': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      const id = idOf(body);
      return withDoc(res, user.id, doc => {
        const i = id ? doc.log.findIndex(e => e.id === id) : -1;
        if (i < 0) return { status: 404, body: { error: 'no such entry' } };
        doc.log.splice(i, 1);
        return { save: true, body: { ok: true, id } };
      });
    },

    'POST /api/nutrition/foods': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      return withDoc(res, user.id, doc => {
        const food = validateFood(body);
        if (doc.foods.length >= LIMITS.FOODS_MAX) return { status: 409, body: { error: 'food list is full', code: 'full' } };
        const now = Date.now();
        const saved = { id: newId(), ...food, createdAt: now, updatedAt: now };
        doc.foods.push(saved);
        return { save: true, status: 201, body: { food: saved } };
      });
    },

    // A whole food, replaced (its fields are few and all of them are edited together).
    'POST /api/nutrition/foods/update': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      const id = idOf(body);
      return withDoc(res, user.id, doc => {
        const i = id ? doc.foods.findIndex(f => f.id === id) : -1;
        if (i < 0) return { status: 404, body: { error: 'no such food' } };
        const { id: _drop, ...fields } = body;
        const food = validateFood(fields);
        doc.foods[i] = { id, ...food, createdAt: doc.foods[i].createdAt, updatedAt: Date.now() };
        return { save: true, body: { food: doc.foods[i] } };
      });
    },

    'POST /api/nutrition/foods/delete': async (req, res) => {
      const [user, body] = await writer(req, res); if (!user) return;
      const id = idOf(body);
      return withDoc(res, user.id, doc => {
        const i = id ? doc.foods.findIndex(f => f.id === id) : -1;
        if (i < 0) return { status: 404, body: { error: 'no such food' } };
        doc.foods.splice(i, 1);
        return { save: true, body: { ok: true, id } };
      });
    },

    'GET /api/food/search': async (req, res) => lookup(req, res, async (q, lang) => {
      const terms = (q.get('q') || '').trim();
      if (terms.length < 2 || terms.length > 80) return json(res, 400, { error: 'q must be 2–80 characters' });
      const foods = await off.search(terms, { page: q.get('page'), lang });
      return json(res, 200, { foods });
    }),

    'GET /api/food/barcode': async (req, res) => lookup(req, res, async (q, lang) => {
      const code = q.get('code') || '';
      if (!/^\d{8,14}$/.test(code)) return json(res, 400, { error: 'code must be 8–14 digits' });
      const food = await off.barcode(code, { lang });
      return json(res, 200, { food });
    }),
  };
}

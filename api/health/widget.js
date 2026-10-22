/* Biscotos iPhone widget (docs/WIDGET.md): GET /api/hooks/widget, one small read-only summary of the
 * caller's day for a widget that cannot sign in with a passkey (the free Scriptable app draws it).
 *
 * It sits under /api/hooks/ with the Apple Health webhook, so the one Bypass rule that lets that
 * webhook through an access proxy covers it too. Authenticated ONLY by a widget token (kind
 * 'widget', minted in the app) in the Authorization header: never a query string, never a session.
 * A health token is refused here and a widget token is refused by the webhook, so a leaked widget
 * key can read this summary and nothing else, and cannot write anything.
 *
 * The answer is numbers only, about the token's owner: nothing about what was eaten, no name, no id.
 * Limits like the webhook's, checked before the token so a guesser pays for every try. */
import { readIntegrations, writeIntegrations, findByToken, readHealth } from './store.js';
import { weekPoints, streakOf, weekOf } from '../social/score.js';

const USE_NOTE_MS = 10 * 60 * 1000;
const STEP_GOAL = 10000;

const round = n => Math.round(Number(n) || 0);

/** What the log says for one day: kcal and grams of each macro, rounded. */
export function totalsOn(log, day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of Array.isArray(log) ? log : []) {
    if (e?.d !== day || !e.per100) continue;
    const f = (Number(e.grams) || 0) / 100;
    for (const k of Object.keys(t)) t[k] += (Number(e.per100[k]) || 0) * f;
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v)]));
}

/** The goal the day is held against: the one the app calculated for today, else the typed one. */
export function goalOf(nutrition, day) {
  const g = nutrition?.profile?.goalToday;
  if (g && g.d === day && Number(g.kcal) > 0) return { kcal: g.kcal, protein: g.protein ?? null, carbs: g.carbs ?? null, fat: g.fat ?? null };
  const t = nutrition?.goals;
  if (t && Number(t.kcal) > 0) return { kcal: t.kcal, protein: t.protein ?? null, carbs: t.carbs ?? null, fat: t.fat ?? null };
  return null;
}

/** The newest steps of the last two days: { d, value } or null. */
export function latestSteps(samples, day, shift) {
  const from = shift(day, -1);
  let best = null;
  for (const s of samples) if (s.type === 'steps' && s.d >= from && s.d <= day && (!best || s.d > best.d)) best = { d: s.d, value: round(s.value) };
  return best;
}

export function widgetRoutes({ json, tooMany, createWindow, limitAddress, dataDir, atomicWrite, readState, readNutrition, today, shiftDay }) {
  const ADDR = createWindow({ max: 60, windowMs: 60000 });
  const TOKEN = createWindow({ max: 30, windowMs: 60000 });

  return {
    'GET /api/hooks/widget': async (req, res) => {
      const addrWait = ADDR.take(limitAddress(req));
      if (addrWait) return tooMany(res, addrWait);
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      let integ; try { integ = readIntegrations(dataDir); } catch { return json(res, 503, { error: 'widget data unreadable' }); }
      const hook = findByToken(integ, token, 'widget');
      if (!hook) return json(res, 401, { error: 'invalid widget key' }, { 'WWW-Authenticate': 'Bearer' });
      const wait = TOKEN.take(hook.id);
      if (wait) return tooMany(res, wait);

      const day = today();
      const S = readState(hook.uid) || { workouts: [] };
      let nutrition = null; try { nutrition = readNutrition(hook.uid); } catch { /* no food data: the rest still answers */ }
      let samples = []; try { samples = readHealth(dataDir, hook.uid).samples || []; } catch { /* none */ }

      const wp = weekPoints(S, weekOf(day), { today: day });
      const eaten = totalsOn(nutrition?.log, day);
      const goal = goalOf(nutrition, day);
      const steps = latestSteps(samples, day, shiftDay);
      const stepGoal = Number(nutrition?.profile?.stepGoal) >= 1000 ? round(nutrition.profile.stepGoal) : STEP_GOAL;

      if (!hook.lastUsedAt || Date.now() - hook.lastUsedAt > USE_NOTE_MS) {
        hook.lastUsedAt = Date.now();
        try { writeIntegrations(dataDir, integ, atomicWrite); } catch (e) { console.error('widget: could not note token use', e.message); }
      }
      json(res, 200, {
        v: 1, day,
        accent: typeof S.accent === 'string' ? S.accent.slice(0, 12) : 'violet',
        streak: streakOf(S, day).weeks,
        week: { workouts: wp.workouts, planned: wp.planned },
        kcal: { eaten: eaten.kcal, goal: goal?.kcal ?? null },
        macros: ['protein', 'carbs', 'fat'].map(k => ({ id: k, eaten: eaten[k], goal: goal?.[k] ?? null })),
        steps: steps ? { ...steps, goal: stepGoal } : null,
      });
    },
  };
}

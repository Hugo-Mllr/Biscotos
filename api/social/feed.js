/* Biscotos feed: what happened in a circle, derived on demand from each member's own documents
 * (docs/SOCIAL.md). Nothing is copied into social.json but the reactions.
 *
 * An event shows only what its member shares: a finished workout (its name, length and number of
 * exercises — never a load), how many records it set (only with records shared, never which
 * exercise), and arrivals in the circle. Ids are HMACs of circle + member + workout, so they say
 * nothing by themselves and are the only handle a client has to react. Pure functions here. */
import { usableWorkouts, bestsOf, shiftDay } from './score.js';

export const FEED_DAYS = 14;
export const FEED_MAX = 60;
export const REACTIONS = Object.freeze(['💪', '🔥', '🍪', '👏', '😮', '🏆']);
export const REACTION_DAYS = 30;

/** Records set by each workout, in order: { workoutId: n }. The first time ever is not one. */
export function recordsByWorkout(S, today) {
  const best = {};
  const out = {};
  for (const w of usableWorkouts(S, today)) {
    let n = 0;
    for (const [id, v] of Object.entries(bestsOf(w))) {
      if (best[id] > 0 && v > best[id]) n++;
      if (!(best[id] >= v)) best[id] = v;
    }
    if (n) out[w.id] = n;
  }
  return out;
}

const minutesOf = w => {
  const ms = Number(w.end) - Number(w.start);
  return ms > 0 && ms < 6 * 3600000 ? Math.round(ms / 60000) : null;
};
const titleOf = w => (typeof w.name === 'string' ? w.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '') || null;

/**
 * The events of one member for the circle, newest first.
 * `m` = { uid, joinedAt }, `prefs` its sharing choices, `idOf(kind, ref)` the HMAC namer.
 */
export function memberEvents({ S, m, prefs, today, idOf }) {
  const out = [{ id: idOf('joined', String(m.joinedAt)), kind: 'joined', at: m.joinedAt }];
  if (!prefs.training || !S) return out;
  const from = shiftDay(today, -FEED_DAYS);
  const recs = prefs.prs ? recordsByWorkout(S, today) : {};
  for (const w of usableWorkouts(S, today)) {
    if (w.d < from || typeof w.id !== 'string') continue;
    const at = Number(w.end) || Number(w.start) || Date.parse(w.d + 'T12:00:00Z');
    out.push({
      id: idOf('workout', w.id), kind: 'workout', at, d: w.d,
      title: titleOf(w), minutes: minutesOf(w),
      exercises: (Array.isArray(w.entries) ? w.entries : []).length,
      records: prefs.prs ? (recs[w.id] || 0) : null,
    });
  }
  return out;
}

/** Reactions on one event as the caller sees them: counts per emoji and the caller's own. */
export function reactionView(byUid = {}, uid) {
  const counts = {};
  for (const e of Object.values(byUid)) if (REACTIONS.includes(e)) counts[e] = (counts[e] || 0) + 1;
  return { counts, mine: REACTIONS.includes(byUid[uid]) ? byUid[uid] : null };
}

/** Drops reactions on events older than REACTION_DAYS (`ages` maps event id → at, ms). */
export function pruneReactions(reactions, now) {
  const keep = {};
  for (const [id, r] of Object.entries(reactions || {})) {
    if (r && typeof r === 'object' && Number(r.at) > now - REACTION_DAYS * 86400000) keep[id] = r;
  }
  return keep;
}

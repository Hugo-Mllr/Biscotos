/* Biscotos social: circles of friends and what each profile shares (docs/SOCIAL.md).
 *
 * One file, social.json under DATA_DIR, written 0600 like every other data file:
 *
 *   { v: 1,
 *     circles: [ { id, name, ownerUid, code, createdAt, members: [ { uid, joinedAt } ] } ],
 *     prefs:   { [uid]: { training, prs, nutrition, notify } },
 *     reactions: { [eventId]: { at, owner, circle, by: { [uid]: emoji } } },   (feed.js)
 *     recaps:  { [circleId]: 'YYYY-MM-DD' } }       (the Monday of the last recap sent)
 *
 * A circle's join code is kept as is, not hashed: every member is shown it so they can invite
 * the next friend. It only lets someone join (never read anything by itself), joins are
 * throttled, the owner can rotate it, and it carries 40 bits from a CSPRNG.
 *
 * Members are never named to a client by their uid: a member key (an HMAC of circle + uid under
 * the instance secret) stands in, so nothing a client sees maps back onto a state-<uid>.json. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = Object.freeze({ CIRCLES_PER_USER: 5, MEMBERS_MAX: 30, NAME_MAX: 40 });
export const DEFAULT_PREFS = Object.freeze({ training: true, prs: true, nutrition: false, notify: true });
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';    // no 0/O, 1/I/L

export class UnreadableError extends Error {}
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const file = dataDir => path.join(dataDir, 'social.json');

export function emptyDoc() { return { v: 1, circles: [], prefs: {}, reactions: {}, recaps: {} }; }

export function readSocial(dataDir) {
  let raw;
  try { raw = fs.readFileSync(file(dataDir), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return emptyDoc(); throw e; }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new UnreadableError('social file unreadable'); }
  if (!isObj(doc)) throw new UnreadableError('social file unreadable');
  return {
    ...doc,
    v: 1,
    circles: Array.isArray(doc.circles) ? doc.circles.filter(c => isObj(c) && Array.isArray(c.members)) : [],
    prefs: isObj(doc.prefs) ? doc.prefs : {},
    reactions: isObj(doc.reactions) ? doc.reactions : {},
    recaps: isObj(doc.recaps) ? doc.recaps : {},
  };
}

export function writeSocial(dataDir, doc, atomicWrite) {
  atomicWrite(file(dataDir), JSON.stringify(doc), 0o600);
}

export const newId = () => crypto.randomBytes(9).toString('base64url');

/** 'ABCD-EFGH': 8 symbols of a 31-letter alphabet (~40 bits), unbiased. */
export function newCode() {
  let s = '';
  while (s.length < 8) {
    const b = crypto.randomBytes(16);
    for (const x of b) if (x < 248 && s.length < 8) s += CODE_ALPHABET[x % 31];
  }
  return s.slice(0, 4) + '-' + s.slice(4);
}
/** What a person typed, as a code to look up ('abcd efgh' → 'ABCD-EFGH'), or null. */
export function cleanCode(v) {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8 || [...s].some(ch => !CODE_ALPHABET.includes(ch))) return null;
  return s.slice(0, 4) + '-' + s.slice(4);
}

/** A circle name: trimmed, control characters out, 1–40 characters; null when unusable. */
export function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s && s.length <= LIMITS.NAME_MAX ? s : null;
}

export function prefsOf(doc, uid) {
  const p = isObj(doc.prefs[uid]) ? doc.prefs[uid] : {};
  return {
    training: typeof p.training === 'boolean' ? p.training : DEFAULT_PREFS.training,
    prs: typeof p.prs === 'boolean' ? p.prs : DEFAULT_PREFS.prs,
    nutrition: typeof p.nutrition === 'boolean' ? p.nutrition : DEFAULT_PREFS.nutrition,
    notify: typeof p.notify === 'boolean' ? p.notify : DEFAULT_PREFS.notify,
  };
}
/** Only the three known switches, only booleans; null when the body has none of them right. */
export function cleanPrefs(body) {
  if (!isObj(body)) return null;
  const out = {};
  for (const k of Object.keys(DEFAULT_PREFS)) {
    if (k in body) { if (typeof body[k] !== 'boolean') return null; out[k] = body[k]; }
  }
  return Object.keys(out).length ? out : null;
}

export const circlesOf = (doc, uid) => doc.circles.filter(c => c.members.some(m => m.uid === uid));
/** The circle `id` if `uid` is one of its members; otherwise null (the caller answers 404). */
export const memberCircle = (doc, id, uid) =>
  (typeof id === 'string' && doc.circles.find(c => c.id === id && c.members.some(m => m.uid === uid))) || null;

export function memberKeyer(secret) {
  return (circleId, uid) => crypto.createHmac('sha256', secret).update(`circle:${circleId}:${uid}`).digest('base64url').slice(0, 16);
}

/**
 * Takes `uid` out of every circle: an owner hands the circle to its longest-standing member, a
 * circle left empty is deleted. Returns whether anything changed. Used by "leave" (one circle)
 * and by the deletion of a profile (all of them).
 */
export function removeMember(doc, uid, circleId = null) {
  let changed = false;
  doc.circles = doc.circles.filter(c => {
    if (circleId && c.id !== circleId) return true;
    const before = c.members.length;
    c.members = c.members.filter(m => m.uid !== uid);
    if (c.members.length === before) return true;
    changed = true;
    if (!c.members.length) return false;
    if (c.ownerUid === uid) c.ownerUid = [...c.members].sort((a, b) => a.joinedAt - b.joinedAt)[0].uid;
    return true;
  });
  return changed;
}

/** A profile deleted by an admin: out of every circle, its sharing choices forgotten. */
export function forgetSocialUser(dataDir, uid, atomicWrite) {
  const doc = readSocial(dataDir);
  const had = uid in doc.prefs;
  delete doc.prefs[uid];
  for (const [id, r] of Object.entries(doc.reactions)) {
    if (r?.owner === uid) delete doc.reactions[id];
    else if (r?.by && uid in r.by) delete r.by[uid];
  }
  if (removeMember(doc, uid) || had) writeSocial(dataDir, doc, atomicWrite);
}

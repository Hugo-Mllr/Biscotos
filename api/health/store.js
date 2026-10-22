/* Biscotos health import: webhook tokens and imported samples (docs/ARCHITECTURE.md § 3.2–3.3,
 * docs/APPLE_HEALTH.md).
 *
 * Tokens: 32 random bytes shown once to their owner, stored as SHA-256 only (integrations.json,
 * 0600), compared in constant time, revocable, at most TOKENS_MAX live per profile. A token only
 * ever writes samples into its owner's file; it opens no session and reads nothing.
 *
 * Samples: one file per profile (health-<uid>.json, 0600). Every sample is validated against a
 * closed list of types with physical bounds; anything else is rejected and reported by index,
 * never echoed (values are health data). Daily figures are one value per (type, day): a Shortcut
 * that runs twice sends the day's running total twice, and the later one replaces the earlier. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TOKEN_PREFIX = 'bxh_';
export const TOKENS_MAX = 5;
export const SAMPLES_MAX = 20000;
export const BATCH_MAX = 500;
export const LABEL_MAX = 40;

// type → { unit, min, max, decimals, daily }. `daily`: one value per day (replace), else a list.
export const TYPES = Object.freeze({
  weight:     { unit: 'kg',  min: 20,  max: 400,    decimals: 2, daily: true },
  steps:      { unit: 'count', min: 0, max: 200000, decimals: 0, daily: true },
  restingHr:  { unit: 'bpm', min: 25,  max: 220,    decimals: 0, daily: true },
  sleepMin:   { unit: 'min', min: 0,   max: 1440,   decimals: 0, daily: true },
  activeKcal: { unit: 'kcal', min: 0,  max: 20000,  decimals: 0, daily: true },
  workoutMin: { unit: 'min', min: 1,   max: 1440,   decimals: 0, daily: false },
});
const LB = 0.45359237;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* ---------------------------------------------------------------- tokens -- */

export const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
export const looksLikeToken = t => typeof t === 'string' && /^bxh_[A-Za-z0-9_-]{43}$/.test(t);
export const mintToken = () => TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

export function integrationsFile(dataDir) { return path.join(dataDir, 'integrations.json'); }

export function readIntegrations(dataDir) {
  try {
    const v = JSON.parse(fs.readFileSync(integrationsFile(dataDir), 'utf8'));
    return { webhooks: Array.isArray(v?.webhooks) ? v.webhooks.filter(isObj) : [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { webhooks: [] };
    // Unreadable: refuse rather than start empty (an empty file written over it would revoke
    // every token silently, and a restored one would lose its revocations).
    throw new Error('integrations.json unreadable');
  }
}
export function writeIntegrations(dataDir, doc, atomicWrite) {
  atomicWrite(integrationsFile(dataDir), JSON.stringify(doc), 0o600);
}

// What a token may do: write Apple Health samples, or read the iPhone widget's summary. A token of
// one kind is refused by the other's route (older rows have no kind: they are Apple Health ones).
export const HOOK_KINDS = Object.freeze(['apple-health', 'widget']);
export const kindOf = w => (HOOK_KINDS.includes(w?.kind) ? w.kind : 'apple-health');

/** The live webhook of `kind` a presented token belongs to, or null. Constant-time on the hash. */
export function findByToken(doc, token, kind = 'apple-health') {
  if (!looksLikeToken(token)) return null;
  const want = Buffer.from(hashToken(token), 'hex');
  let hit = null;
  for (const w of doc.webhooks) {
    if (typeof w.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(w.tokenHash)) continue;
    // Every row compared, whichever matches: the time taken says nothing about which one did.
    if (crypto.timingSafeEqual(want, Buffer.from(w.tokenHash, 'hex')) && !w.revokedAt && kindOf(w) === kind) hit = w;
  }
  return hit;
}

/** A webhook as its owner sees it: never the hash. */
export const publicHook = w => ({ id: w.id, label: w.label, kind: kindOf(w), createdAt: w.createdAt, lastUsedAt: w.lastUsedAt || null, revokedAt: w.revokedAt || null });

export function cleanLabel(v, fallback = 'Apple Health') {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  return s || fallback;
}

/* --------------------------------------------------------------- samples -- */

/** YYYY-MM-DD out of a day or an ISO 8601 date-time (its local date, as written). */
export function dayOf(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.exec(v.trim());
  if (!m) return null;
  const d = m[1];
  const t = Date.parse(d + 'T00:00:00Z');
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== d) return null;
  const y = +d.slice(0, 4);
  return y >= 2000 && y <= 2100 ? d : null;
}

/**
 * One sample from the webhook → stored shape, or throws an Error whose message is safe to return
 * (it names the problem, never the value). Weight in lb is converted to kg.
 */
export function validateSample(s, { today } = {}) {
  if (!isObj(s)) throw new Error('not an object');
  const spec = TYPES[s.type];
  if (!spec) throw new Error('unknown type');
  const d = dayOf(s.date);
  if (!d) throw new Error('date must be YYYY-MM-DD or ISO 8601');
  // A day more than one ahead of the server's is a clock or format mistake, not a measurement.
  if (today && d > shift(today, 1)) throw new Error('date in the future');
  let n = typeof s.value === 'string' ? Number(s.value.trim().replace(',', '.')) : s.value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('value is not a number');
  if (s.type === 'weight' && /^(lb|lbs)$/i.test(String(s.unit || ''))) n *= LB;
  else if (s.unit != null && s.unit !== '' && String(s.unit).toLowerCase() !== spec.unit) {
    // Sleep sent in hours is common enough to accept; anything else is refused, not guessed.
    if (s.type === 'sleepMin' && /^(h|hr|hours?)$/i.test(String(s.unit))) n *= 60;
    else throw new Error(`unit must be ${spec.unit}`);
  }
  if (n < spec.min || n > spec.max) throw new Error('value out of range');
  const p = 10 ** spec.decimals;
  const out = { type: s.type, d, value: Math.round(n * p) / p, source: 'apple-health' };
  if (!spec.daily) {
    const ext = typeof s.id === 'string' ? s.id.trim().slice(0, 80) : '';
    if (ext && /^[\w.:-]+$/.test(ext)) out.extId = ext;
  }
  return out;
}

function shift(day, n) {
  const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Merges validated samples into a document; returns how many were new or changed. */
export function mergeSamples(doc, samples, now = Date.now()) {
  let changed = 0;
  for (const s of samples) {
    const daily = TYPES[s.type].daily;
    const i = doc.samples.findIndex(x => x.type === s.type && x.d === s.d && x.source === s.source
      && (daily || (s.extId ? x.extId === s.extId : (!x.extId && x.value === s.value))));
    if (i >= 0) {
      if (doc.samples[i].value !== s.value) { doc.samples[i] = { ...doc.samples[i], value: s.value, at: now }; changed++; }
    } else {
      doc.samples.push({ ...s, at: now });
      changed++;
    }
  }
  if (doc.samples.length > SAMPLES_MAX) {
    doc.samples.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    doc.samples.splice(0, doc.samples.length - SAMPLES_MAX);
  }
  return changed;
}

export function healthFile(dataDir, uid) {
  const safe = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('empty uid');
  return path.join(dataDir, 'health-' + safe + '.json');
}
export function readHealth(dataDir, uid) {
  try {
    const v = JSON.parse(fs.readFileSync(healthFile(dataDir, uid), 'utf8'));
    return { samples: Array.isArray(v?.samples) ? v.samples.filter(isObj) : [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { samples: [] };
    throw new Error('health file unreadable');
  }
}
export function writeHealth(dataDir, uid, doc, atomicWrite) {
  atomicWrite(healthFile(dataDir, uid), JSON.stringify(doc), 0o600);
}
export function removeHealth(dataDir, uid) {
  try { fs.unlinkSync(healthFile(dataDir, uid)); } catch { /* none */ }
}

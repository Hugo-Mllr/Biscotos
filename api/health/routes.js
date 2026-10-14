/* Biscotos health import routes (docs/APPLE_HEALTH.md). Spread into server.js's route table.
 *
 *   session routes  GET/POST /api/hooks/tokens, POST /api/hooks/tokens/revoke,
 *                   GET /api/health-samples — the profile is the session's, an id that is not
 *                   one of its own answers 404.
 *   webhook         POST /api/hooks/apple-health — authenticated ONLY by a webhook token in the
 *                   Authorization header (never a query string: URLs end up in proxy logs). The
 *                   token writes samples into its owner's file and can do nothing else: it is not
 *                   a session, so it reads nothing and reaches no other route.
 *
 * Limits on the webhook, checked before the token so a guesser pays for every try: 60 requests a
 * minute per address, then 30 a minute per token, 256 KiB and 500 samples per request.
 * Nothing about a sample — not its type, not its value — is ever logged. */
import {
  TOKENS_MAX, BATCH_MAX, mintToken, hashToken, readIntegrations, writeIntegrations, findByToken,
  publicHook, cleanLabel, validateSample, mergeSamples, readHealth, writeHealth
} from './store.js';
import crypto from 'node:crypto';

const BODY_MAX = 256 * 1024;
const USE_NOTE_MS = 10 * 60 * 1000;
const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + 'T00:00:00Z'));

export function healthRoutes({ json, readBody, readSession, tooMany, createWindow, limitAddress, audit, dataDir, atomicWrite, todayISO }) {
  const HOOK_ADDR = createWindow({ max: 60, windowMs: 60000 });
  const HOOK_TOKEN = createWindow({ max: 30, windowMs: 60000 });
  const TOKEN_WRITES = createWindow({ max: 20, windowMs: 60000 });

  const signedIn = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    return user;
  };
  const unreadable = res => { console.error('health: integrations or samples file unreadable'); json(res, 503, { error: 'health import data unreadable' }); };

  return {
    'GET /api/hooks/tokens': async (req, res) => {
      const user = signedIn(req, res); if (!user) return;
      let doc; try { doc = readIntegrations(dataDir); } catch { return unreadable(res); }
      json(res, 200, { hooks: doc.webhooks.filter(w => w.uid === user.id).map(publicHook), endpoint: '/api/hooks/apple-health' });
    },

    // The token is in this answer and nowhere else, ever: only its hash is kept.
    'POST /api/hooks/tokens': async (req, res) => {
      const user = signedIn(req, res); if (!user) return;
      const wait = TOKEN_WRITES.take(user.id); if (wait) return tooMany(res, wait);
      const body = await readBody(req);
      const label = cleanLabel(body?.label);
      if (label == null) return json(res, 400, { error: 'label must be a string', field: 'label' });
      let doc; try { doc = readIntegrations(dataDir); } catch { return unreadable(res); }
      if (doc.webhooks.filter(w => w.uid === user.id && !w.revokedAt).length >= TOKENS_MAX) {
        return json(res, 409, { error: `at most ${TOKENS_MAX} live tokens; revoke one first`, code: 'full' });
      }
      const token = mintToken();
      const hook = { id: crypto.randomBytes(9).toString('base64url'), uid: user.id, kind: 'apple-health', label, tokenHash: hashToken(token), createdAt: Date.now() };
      doc.webhooks.push(hook);
      writeIntegrations(dataDir, doc, atomicWrite);
      audit(req, 'hook.token.create', { user, msg: label });
      json(res, 201, { hook: publicHook(hook), token });
    },

    'POST /api/hooks/tokens/revoke': async (req, res) => {
      const user = signedIn(req, res); if (!user) return;
      const wait = TOKEN_WRITES.take(user.id); if (wait) return tooMany(res, wait);
      const body = await readBody(req);
      let doc; try { doc = readIntegrations(dataDir); } catch { return unreadable(res); }
      const hook = typeof body?.id === 'string' ? doc.webhooks.find(w => w.id === body.id && w.uid === user.id) : null;
      if (!hook) return json(res, 404, { error: 'no such token' });
      if (!hook.revokedAt) {
        hook.revokedAt = Date.now();
        writeIntegrations(dataDir, doc, atomicWrite);
        audit(req, 'hook.token.revoke', { user, msg: hook.label });
      }
      json(res, 200, { hook: publicHook(hook) });
    },

    'GET /api/health-samples': async (req, res) => {
      const user = signedIn(req, res); if (!user) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const from = q.get('from'), to = q.get('to');
      if (!isDay(from) || !isDay(to) || from > to) return json(res, 400, { error: 'from and to must be YYYY-MM-DD days, from <= to' });
      let doc; try { doc = readHealth(dataDir, user.id); } catch { return unreadable(res); }
      json(res, 200, { samples: doc.samples.filter(s => s.d >= from && s.d <= to).map(({ at, ...s }) => s) });
    },

    'POST /api/hooks/apple-health': async (req, res) => {
      const addrWait = HOOK_ADDR.take(limitAddress(req));
      if (addrWait) return tooMany(res, addrWait);
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      let integ; try { integ = readIntegrations(dataDir); } catch { return unreadable(res); }
      const hook = findByToken(integ, token);
      // One answer for a missing, malformed, unknown or revoked token.
      if (!hook) return json(res, 401, { error: 'invalid webhook token' }, { 'WWW-Authenticate': 'Bearer' });
      const tokWait = HOOK_TOKEN.take(hook.id);
      if (tokWait) return tooMany(res, tokWait);
      if (+req.headers['content-length'] > BODY_MAX) return json(res, 413, { error: 'body too large' });
      const body = await readBody(req);
      const raw = Array.isArray(body?.samples) ? body.samples : null;
      if (!raw) return json(res, 400, { error: 'samples must be an array' });
      if (raw.length > BATCH_MAX) return json(res, 413, { error: `at most ${BATCH_MAX} samples per request` });

      const today = todayISO();
      const ok = [], rejected = [];
      raw.forEach((s, index) => {
        try { ok.push(validateSample(s, { today })); }
        catch (e) { if (rejected.length < 50) rejected.push({ index, error: e.message }); }
      });
      let doc; try { doc = readHealth(dataDir, hook.uid); } catch { return unreadable(res); }
      const changed = mergeSamples(doc, ok);
      if (changed) writeHealth(dataDir, hook.uid, doc, atomicWrite);
      if (!hook.lastUsedAt || Date.now() - hook.lastUsedAt > USE_NOTE_MS) {
        hook.lastUsedAt = Date.now();
        try { writeIntegrations(dataDir, integ, atomicWrite); } catch (e) { console.error('health: could not note token use', e.message); }
      }
      json(res, 200, { accepted: ok.length, changed, rejected: rejected.length, errors: rejected });
    },
  };
}

/** Everything of a profile's health import, for account deletion. */
export function forgetHealthUser(dataDir, uid, atomicWrite) {
  const doc = readIntegrations(dataDir);
  const keep = doc.webhooks.filter(w => w.uid !== uid);
  if (keep.length !== doc.webhooks.length) writeIntegrations(dataDir, { ...doc, webhooks: keep }, atomicWrite);
}

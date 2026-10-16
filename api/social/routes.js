/* Biscotos social routes: circles of friends, sharing choices and the weekly league
 * (docs/SOCIAL.md). Spread into server.js's route table.
 *
 * Every route needs a session, and the profile is always the session's. A circle the caller is
 * not a member of answers 404, exactly like one that does not exist (no IDOR, no existence
 * oracle). Members are named to clients by their display name and an opaque member key, never
 * by uid. What a member's friends see is computed here from that member's own documents and
 * limited to what they chose to share: points and their breakdown, the streak, the number of
 * workouts and records. Never a weight, a body measurement, a food or a note. */
import {
  LIMITS, readSocial, writeSocial, newId, newCode, cleanCode, cleanName, prefsOf, cleanPrefs,
  circlesOf, memberCircle, memberKeyer, removeMember, UnreadableError
} from './store.js';
import { weekPoints, streakOf, seasonOf, weekOf, shiftDay } from './score.js';

export function socialRoutes({
  json, readBody, readSession, tooMany, createWindow, limitAddress, audit, dataDir, atomicWrite,
  secret, userById, readState, readNutrition, today
}) {
  const READS = createWindow({ max: 60, windowMs: 60000 });
  const WRITES = createWindow({ max: 30, windowMs: 60000 });
  const JOINS = createWindow({ max: 10, windowMs: 60000 });
  const JOIN_ADDR = createWindow({ max: 20, windowMs: 60000 });
  const keyOf = memberKeyer(secret);

  const signedIn = (req, res, win) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    const wait = win.take(user.id);
    if (wait) { tooMany(res, wait); return null; }
    return user;
  };
  const load = res => {
    try { return readSocial(dataDir); }
    catch (e) {
      console.error('social: social.json unreadable', e instanceof UnreadableError ? '' : e.code || '');
      json(res, 503, { error: 'social data unreadable' });
      return null;
    }
  };
  const save = doc => writeSocial(dataDir, doc, atomicWrite);
  const nameOf = uid => userById(uid)?.name || '—';
  const noCircle = res => json(res, 404, { error: 'no such circle' });

  // A circle as its members see it.
  const view = (c, uid) => ({
    id: c.id, name: c.name, code: c.code, owner: c.ownerUid === uid, createdAt: c.createdAt,
    members: c.members.map(m => ({
      member: keyOf(c.id, m.uid), name: nameOf(m.uid), me: m.uid === uid, owner: m.uid === c.ownerUid, joinedAt: m.joinedAt,
    })),
  });

  // What one member shows the circle for the week starting `monday` (null fields when not shared).
  function standing(doc, c, m, monday, now) {
    const prefs = prefsOf(doc, m.uid);
    const row = { member: keyOf(c.id, m.uid), name: nameOf(m.uid), shares: prefs };
    if (!prefs.training) return { row: { ...row, points: null } };
    const S = readState(m.uid) || { workouts: [] };
    let nutrition = null;
    if (prefs.nutrition) { try { nutrition = readNutrition(m.uid); } catch { nutrition = null; } }
    const wp = weekPoints(S, monday, { today: now, nutrition });
    const out = { ...row, points: wp.points, breakdown: wp.breakdown, workouts: wp.workouts, planned: wp.planned };
    if (!prefs.nutrition) out.breakdown = { ...out.breakdown, nutrition: null };
    out.records = prefs.prs ? wp.records.length : null;
    if (!prefs.prs) { out.points -= wp.breakdown.records; out.breakdown.records = null; }
    out.streak = streakOf(S, now);
    return { row: out, S, nutrition };
  }
  const rank = rows => rows
    .sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.name.localeCompare(b.name))
    .map((r, i, all) => ({ ...r, rank: r.points == null ? null : 1 + all.findIndex(x => x.points === r.points) }));

  return {
    'GET /api/social': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const doc = load(res); if (!doc) return;
      json(res, 200, { prefs: prefsOf(doc, user.id), circles: circlesOf(doc, user.id).map(c => view(c, user.id)), limits: LIMITS });
    },

    'PUT /api/social/prefs': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const p = cleanPrefs(await readBody(req));
      if (!p) return json(res, 400, { error: 'expected booleans: training, prs, nutrition' });
      const doc = load(res); if (!doc) return;
      doc.prefs[user.id] = { ...prefsOf(doc, user.id), ...p };
      save(doc);
      json(res, 200, { prefs: prefsOf(doc, user.id) });
    },

    'POST /api/social/circles': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const name = cleanName(body?.name);
      if (!name) return json(res, 400, { error: `name: 1 to ${LIMITS.NAME_MAX} characters`, field: 'name' });
      const doc = load(res); if (!doc) return;
      if (circlesOf(doc, user.id).length >= LIMITS.CIRCLES_PER_USER) {
        return json(res, 409, { error: `at most ${LIMITS.CIRCLES_PER_USER} circles`, code: 'full' });
      }
      const now = Date.now();
      const c = { id: newId(), name, ownerUid: user.id, code: newCode(), createdAt: now, members: [{ uid: user.id, joinedAt: now }] };
      doc.circles.push(c);
      const p = cleanPrefs(body?.prefs);
      if (p) doc.prefs[user.id] = { ...prefsOf(doc, user.id), ...p };
      save(doc);
      audit(req, 'social.circle.create', { user, msg: name });
      json(res, 201, { circle: view(c, user.id) });
    },

    'POST /api/social/join': async (req, res) => {
      const addrWait = JOIN_ADDR.take(limitAddress(req));
      if (addrWait) return tooMany(res, addrWait);
      const user = signedIn(req, res, JOINS); if (!user) return;
      const body = await readBody(req);
      const code = cleanCode(body?.code);
      const doc = load(res); if (!doc) return;
      const c = code && doc.circles.find(x => x.code === code);
      // One answer for a malformed and an unknown code.
      if (!c) return json(res, 404, { error: 'no circle with this code', code: 'bad-code' });
      if (c.members.some(m => m.uid === user.id)) return json(res, 200, { circle: view(c, user.id) });
      if (circlesOf(doc, user.id).length >= LIMITS.CIRCLES_PER_USER) {
        return json(res, 409, { error: `at most ${LIMITS.CIRCLES_PER_USER} circles`, code: 'full' });
      }
      if (c.members.length >= LIMITS.MEMBERS_MAX) return json(res, 409, { error: 'this circle is full', code: 'circle-full' });
      c.members.push({ uid: user.id, joinedAt: Date.now() });
      const p = cleanPrefs(body?.prefs);
      if (p) doc.prefs[user.id] = { ...prefsOf(doc, user.id), ...p };
      save(doc);
      audit(req, 'social.circle.join', { user, msg: c.name });
      json(res, 200, { circle: view(c, user.id) });
    },

    'POST /api/social/leave': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, body?.circle, user.id);
      if (!c) return noCircle(res);
      removeMember(doc, user.id, c.id);
      save(doc);
      audit(req, 'social.circle.leave', { user, msg: c.name });
      json(res, 200, { ok: true });
    },

    // Owner only: rename, or a new code (the old one stops working at once).
    'POST /api/social/circles/update': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, body?.circle, user.id);
      if (!c) return noCircle(res);
      if (c.ownerUid !== user.id) return json(res, 403, { error: 'only the circle owner can change it' });
      if ('name' in (body || {})) {
        const name = cleanName(body.name);
        if (!name) return json(res, 400, { error: `name: 1 to ${LIMITS.NAME_MAX} characters`, field: 'name' });
        c.name = name;
      }
      if (body?.rotateCode === true) c.code = newCode();
      save(doc);
      json(res, 200, { circle: view(c, user.id) });
    },

    'POST /api/social/circles/remove': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, body?.circle, user.id);
      if (!c) return noCircle(res);
      if (c.ownerUid !== user.id) return json(res, 403, { error: 'only the circle owner can remove a member' });
      const m = typeof body?.member === 'string' ? c.members.find(x => keyOf(c.id, x.uid) === body.member) : null;
      if (!m) return json(res, 404, { error: 'no such member' });
      if (m.uid === user.id) return json(res, 400, { error: 'leave the circle instead' });
      removeMember(doc, m.uid, c.id);
      save(doc);
      audit(req, 'social.circle.remove', { user, msg: c.name });
      json(res, 200, { circle: view(c, user.id) });
    },

    'POST /api/social/circles/delete': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, body?.circle, user.id);
      if (!c) return noCircle(res);
      if (c.ownerUid !== user.id) return json(res, 403, { error: 'only the circle owner can delete it' });
      doc.circles = doc.circles.filter(x => x.id !== c.id);
      save(doc);
      audit(req, 'social.circle.delete', { user, msg: c.name });
      json(res, 200, { ok: true });
    },

    // This week, last week and the season (every week since each member joined, at most 52).
    'GET /api/social/leaderboard': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, q.get('circle'), user.id);
      if (!c) return noCircle(res);
      const now = today();
      const monday = weekOf(now), lastMonday = shiftDay(monday, -7);
      const week = [], last = [], season = [];
      for (const m of c.members) {
        const me = m.uid === user.id;
        const st = standing(doc, c, m, monday, now);
        if (st.row.points == null) { const r = { ...st.row, me }; week.push(r); last.push(r); season.push(r); continue; }
        week.push({ ...st.row, me });
        const lp = standing(doc, c, m, lastMonday, now).row;
        last.push({ member: lp.member, name: lp.name, me, points: lp.points, workouts: lp.workouts });
        const prefs = prefsOf(doc, m.uid);
        const weeks = seasonOf(st.S, new Date(m.joinedAt).toISOString().slice(0, 10), { today: now, nutrition: st.nutrition });
        const total = weeks.reduce((a, w) => a + w.points - (prefs.prs ? 0 : w.breakdown.records), 0);
        season.push({ member: st.row.member, name: st.row.name, me, points: total, weeks: weeks.length, best: Math.max(0, ...weeks.map(w => w.points)) });
      }
      json(res, 200, {
        circle: { id: c.id, name: c.name },
        week: { start: monday, rows: rank(week) },
        lastWeek: { start: lastMonday, rows: rank(last) },
        season: { rows: rank(season) },
      });
    },
  };
}

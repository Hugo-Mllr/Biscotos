/* Biscotos social: circles of friends, sharing choices, the weekly league, the feed and its
 * reactions, and the notifications they send (docs/SOCIAL.md). createSocial() returns the routes
 * to spread into server.js's route table, plus two hooks the server calls: onStateSaved (after
 * a profile's state document is written) and tick (on a timer, for the Monday recap).
 *
 * Every route needs a session, and the profile is always the session's. A circle the caller is
 * not a member of answers 404, exactly like one that does not exist (no IDOR, no existence
 * oracle). Members are named to clients by their display name and an opaque member key, never
 * by uid. What a member's friends see is computed here from that member's own documents and
 * limited to what they chose to share: points and their breakdown, the streak, the number of
 * workouts and records, a workout's name and length. Never a weight, a body measurement, a food
 * or a note. Notifications carry names and counts only, and go to profiles that left them on. */
import crypto from 'node:crypto';
import {
  LIMITS, readSocial, writeSocial, newId, newCode, cleanCode, cleanName, prefsOf, cleanPrefs,
  circlesOf, memberCircle, memberKeyer, removeMember, UnreadableError
} from './store.js';
import { weekPoints, streakOf, seasonOf, weekOf, shiftDay, usableWorkouts, bestSetsOf } from './score.js';
import { memberEvents, reactionView, pruneReactions, recordsByWorkout, REACTIONS, FEED_MAX } from './feed.js';
import { badgesOf, challengeOf } from './badges.js';
import { reactionPush, recordsPush, recapPush } from './push-copy.js';

const RECAP_HOUR = 9;   // Monday, from 9:00 on the server's clock
const HERE_MS = 3 * 3600 * 1000;   // "at the gym" lapses by itself after three hours
const GHOST_IDS = 30, GHOSTS_PER_EXERCISE = 3;
const EX_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export function createSocial({
  json, readBody, readSession, tooMany, createWindow, limitAddress, audit, dataDir, atomicWrite,
  secret, userById, readState, readNutrition, today, sendPush = () => {}, now = () => new Date()
}) {
  const READS = createWindow({ max: 60, windowMs: 60000 });
  const WRITES = createWindow({ max: 30, windowMs: 60000 });
  const REACTS = createWindow({ max: 60, windowMs: 60000 });
  const JOINS = createWindow({ max: 10, windowMs: 60000 });
  const JOIN_ADDR = createWindow({ max: 20, windowMs: 60000 });
  const keyOf = memberKeyer(secret);
  // Who says they are at the gym: uid → since. Kept in memory only (never written to disk) and
  // forgotten on restart; checking in is the consent, and only circle mates ever see it.
  const here = new Map();
  const hereSince = uid => {
    const at = here.get(uid);
    if (at === undefined) return null;
    if (now().getTime() - at > HERE_MS) { here.delete(uid); return null; }
    return at;
  };
  const eventIdOf = (circleId, uid) => (kind, ref) =>
    crypto.createHmac('sha256', secret).update(`event:${circleId}:${uid}:${kind}:${ref}`).digest('base64url').slice(0, 22);

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
  const langOf = uid => readState(uid)?.lang;
  const noCircle = res => json(res, 404, { error: 'no such circle' });
  // Notifications never fail a request: the push is a side effect.
  const notify = (uid, payload) => { try { Promise.resolve(sendPush(uid, payload)).catch(() => {}); } catch { /* none */ } };

  const view = (c, uid) => ({
    id: c.id, name: c.name, code: c.code, owner: c.ownerUid === uid, createdAt: c.createdAt, shame: c.shame !== false,
    members: c.members.map(m => ({
      member: keyOf(c.id, m.uid), name: nameOf(m.uid), me: m.uid === uid, owner: m.uid === c.ownerUid, joinedAt: m.joinedAt,
    })),
  });

  // What one member shows the circle for the week starting `monday` (points null when not shared).
  function standing(doc, c, m, monday, day) {
    const prefs = prefsOf(doc, m.uid);
    const row = { member: keyOf(c.id, m.uid), name: nameOf(m.uid), shares: prefs };
    if (!prefs.training) return { row: { ...row, points: null } };
    const S = readState(m.uid) || { workouts: [] };
    let nutrition = null;
    if (prefs.nutrition) { try { nutrition = readNutrition(m.uid); } catch { nutrition = null; } }
    const wp = weekPoints(S, monday, { today: day, nutrition });
    const out = { ...row, points: wp.points, breakdown: { ...wp.breakdown }, workouts: wp.workouts, planned: wp.planned };
    if (!prefs.nutrition) out.breakdown.nutrition = null;
    out.records = prefs.prs ? wp.records.length : null;
    if (!prefs.prs) { out.points -= wp.breakdown.records; out.breakdown.records = null; }
    out.streak = streakOf(S, day);
    return { row: out, S, nutrition };
  }
  const rank = rows => rows
    .sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.name.localeCompare(b.name))
    .map((r, i, all) => ({ ...r, rank: r.points == null ? null : 1 + all.findIndex(x => x.points === r.points) }));
  const shareless = ({ shares, ...r }) => r;   // a member's switches are theirs, not the circle's

  // The feed of a circle as `uid` sees it, newest first.
  function feedOf(doc, c, uid, day) {
    const events = [];
    for (const m of c.members) {
      const prefs = prefsOf(doc, m.uid);
      const S = prefs.training ? readState(m.uid) : null;
      for (const e of memberEvents({ S, m, prefs, today: day, idOf: eventIdOf(c.id, m.uid) })) {
        events.push({ ...e, member: keyOf(c.id, m.uid), name: nameOf(m.uid), me: m.uid === uid, owner: m.uid });
      }
    }
    return events.sort((a, b) => b.at - a.at).slice(0, FEED_MAX);
  }

  /* ---------- hooks ---------- */

  // A profile saved its document: new workouts with records tell the circles (once: a workout
  // id already in the previous document is never announced again).
  function onStateSaved(uid, prev, next) {
    let doc; try { doc = readSocial(dataDir); } catch { return; }
    const circles = circlesOf(doc, uid);
    if (!circles.length) return;
    const prefs = prefsOf(doc, uid);
    if (!prefs.training || !prefs.prs) return;
    const day = today();
    const had = new Set((Array.isArray(prev?.workouts) ? prev.workouts : []).map(w => w?.id));
    const fresh = usableWorkouts(next, day).filter(w => !had.has(w.id) && w.d >= shiftDay(day, -1));
    if (!fresh.length) return;
    const recs = recordsByWorkout(next, day);
    const n = fresh.reduce((a, w) => a + (recs[w.id] || 0), 0);
    if (!n) return;
    const who = nameOf(uid);
    const told = new Set();
    for (const c of circles) for (const m of c.members) {
      if (m.uid === uid || told.has(m.uid) || !prefsOf(doc, m.uid).notify) continue;
      told.add(m.uid);
      notify(m.uid, recordsPush(langOf(m.uid), who, n));
    }
  }

  // Monday from 9:00: last week's podium to every member who has notifications on, once.
  function tick() {
    const t = now();
    if (t.getDay() !== 1 || t.getHours() < RECAP_HOUR) return 0;
    let doc; try { doc = readSocial(dataDir); } catch { return 0; }
    const day = today();
    const last = shiftDay(weekOf(day), -7);
    let sent = 0;
    for (const c of doc.circles) {
      if (doc.recaps[c.id] >= last || c.members.length < 2) continue;
      // Not a week the circle existed for: nothing to sum up yet.
      if (c.createdAt > Date.parse(weekOf(day) + 'T00:00:00')) { doc.recaps[c.id] = last; continue; }
      const rows = rank(c.members.map(m => standing(doc, c, m, last, day).row)).filter(r => r.points != null);
      doc.recaps[c.id] = last;
      for (const m of c.members) {
        if (!prefsOf(doc, m.uid).notify) continue;
        notify(m.uid, recapPush(langOf(m.uid), c.name, rows, c.shame !== false));
        sent++;
      }
    }
    try { save(doc); } catch (e) { console.error('social: could not note the recap', e.code || e.message); }
    return sent;
  }

  /* ---------- routes ---------- */

  const routes = {
    'GET /api/social': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const doc = load(res); if (!doc) return;
      json(res, 200, { prefs: prefsOf(doc, user.id), circles: circlesOf(doc, user.id).map(c => view(c, user.id)), limits: LIMITS, reactions: REACTIONS });
    },

    'PUT /api/social/prefs': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const p = cleanPrefs(await readBody(req));
      if (!p) return json(res, 400, { error: 'expected booleans: training, prs, nutrition, notify, lifts' });
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
      const at = Date.now();
      const c = { id: newId(), name, ownerUid: user.id, code: newCode(), createdAt: at, members: [{ uid: user.id, joinedAt: at }] };
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

    // Owner only: rename, a new code (the old one stops working at once), the wall of shame.
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
      if ('shame' in (body || {})) {
        if (typeof body.shame !== 'boolean') return json(res, 400, { error: 'shame must be a boolean', field: 'shame' });
        c.shame = body.shame;
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
      for (const [id, r] of Object.entries(doc.reactions)) if (r?.circle === c.id) delete doc.reactions[id];
      delete doc.recaps[c.id];
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
      const day = today();
      const monday = weekOf(day), lastMonday = shiftDay(monday, -7);
      const week = [], last = [], season = [];
      for (const m of c.members) {
        const me = m.uid === user.id;
        const st = standing(doc, c, m, monday, day);
        if (st.row.points == null) { const r = { ...shareless(st.row), me }; week.push(r); last.push(r); season.push(r); continue; }
        week.push({ ...shareless(st.row), me });
        const lp = standing(doc, c, m, lastMonday, day).row;
        last.push({ member: lp.member, name: lp.name, me, points: lp.points, workouts: lp.workouts });
        const prefs = prefsOf(doc, m.uid);
        const weeks = seasonOf(st.S, new Date(m.joinedAt).toISOString().slice(0, 10), { today: day, nutrition: st.nutrition });
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

    // What happened in the circle these two weeks, with reactions.
    'GET /api/social/feed': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, q.get('circle'), user.id);
      if (!c) return noCircle(res);
      const events = feedOf(doc, c, user.id, today()).map(({ owner, ...e }) => ({ ...e, reactions: reactionView(doc.reactions[e.id]?.by, user.id) }));
      json(res, 200, { circle: { id: c.id, name: c.name }, events, choices: REACTIONS });
    },

    // The circle's challenge of the week and each member's badges, both derived on demand from
    // what that member shares (nothing is stored).
    'GET /api/social/challenge': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, q.get('circle'), user.id);
      if (!c) return noCircle(res);
      const day = today(), monday = weekOf(day);
      const rows = [], members = [];
      for (const m of c.members) {
        const prefs = prefsOf(doc, m.uid);
        const who = { member: keyOf(c.id, m.uid), name: nameOf(m.uid), me: m.uid === user.id };
        if (!prefs.training) { members.push({ ...who, badges: [] }); continue; }
        const st = standing(doc, c, m, monday, day).row;
        rows.push({ workouts: st.workouts, records: st.records, plan: st.breakdown.plan > 0 });
        members.push({ ...who, badges: badgesOf(readState(m.uid) || { workouts: [] }, day, { prs: prefs.prs }) });
      }
      json(res, 200, { circle: { id: c.id, name: c.name }, challenge: challengeOf(monday, rows), members });
    },

    // Who is at the gym right now, among the people of one circle.
    'GET /api/social/gym': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, q.get('circle'), user.id);
      if (!c) return noCircle(res);
      const people = c.members
        .map(m => ({ m, since: hereSince(m.uid) }))
        .filter(x => x.since !== null)
        .map(({ m, since }) => ({ member: keyOf(c.id, m.uid), name: nameOf(m.uid), me: m.uid === user.id, since }))
        .sort((a, b) => a.since - b.since);
      json(res, 200, { circle: { id: c.id, name: c.name }, here: people, mine: hereSince(user.id) !== null });
    },

    // "I'm at the gym" / "I left": { in: boolean }. Not tied to a circle; each circle shows it to its own.
    'POST /api/social/gym': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      if (typeof body?.in !== 'boolean') return json(res, 400, { error: 'in must be a boolean', field: 'in' });
      if (body.in) here.set(user.id, now().getTime()); else here.delete(user.id);
      json(res, 200, { mine: body.in });
    },

    // The ghosts of a workout: for each exercise asked (?ex=a,b,c), the best set of the friends who
    // share their lifts, from every circle the caller is in, strongest first. Names only, no member
    // key: a ghost belongs to no one circle. The caller's own lifts are never in it.
    'GET /api/social/ghosts': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const ids = [...new Set((new URL(req.url, 'http://x').searchParams.get('ex') || '').split(',').filter(Boolean))];
      if (!ids.length || ids.length > GHOST_IDS || !ids.every(id => EX_ID.test(id))) {
        return json(res, 400, { error: `ex: 1 to ${GHOST_IDS} exercise ids, comma-separated`, field: 'ex' });
      }
      const doc = load(res); if (!doc) return;
      const day = today();
      const friends = new Set();
      for (const c of circlesOf(doc, user.id)) for (const m of c.members) if (m.uid !== user.id) friends.add(m.uid);
      const ghosts = {};
      for (const uid of friends) {
        const prefs = prefsOf(doc, uid);
        if (!prefs.training || !prefs.lifts) continue;
        const bests = bestSetsOf(readState(uid) || { workouts: [] }, ids, day);
        for (const [id, b] of Object.entries(bests)) (ghosts[id] ||= []).push({ name: nameOf(uid), ...b });
      }
      for (const id of Object.keys(ghosts)) ghosts[id] = ghosts[id].sort((a, b) => b.e1rm - a.e1rm).slice(0, GHOSTS_PER_EXERCISE);
      json(res, 200, { ghosts });
    },

    // One reaction per person and event: an emoji sets it, the same one again or null takes it off.
    'POST /api/social/react': async (req, res) => {
      const user = signedIn(req, res, REACTS); if (!user) return;
      const body = await readBody(req);
      const emoji = body?.emoji ?? null;
      if (emoji !== null && !REACTIONS.includes(emoji)) return json(res, 400, { error: 'unknown reaction', field: 'emoji' });
      const doc = load(res); if (!doc) return;
      const c = memberCircle(doc, body?.circle, user.id);
      if (!c) return noCircle(res);
      // Only an event the caller can see right now: nothing else is ever stored.
      const ev = typeof body?.event === 'string' ? feedOf(doc, c, user.id, today()).find(e => e.id === body.event) : null;
      if (!ev) return json(res, 404, { error: 'no such event' });
      doc.reactions = pruneReactions(doc.reactions, Date.now());
      const r = doc.reactions[ev.id] || { at: ev.at, owner: ev.owner, circle: c.id, by: {} };
      const before = r.by[user.id];
      if (emoji === null || before === emoji) delete r.by[user.id]; else r.by[user.id] = emoji;
      if (Object.keys(r.by).length) doc.reactions[ev.id] = r; else delete doc.reactions[ev.id];
      save(doc);
      // A new reaction to someone else's workout tells them (not a change of mind, not a removal).
      const set = r.by[user.id];
      if (set && !before && ev.kind === 'workout' && ev.owner !== user.id && prefsOf(doc, ev.owner).notify) {
        notify(ev.owner, reactionPush(langOf(ev.owner), nameOf(user.id), set, ev.title));
      }
      json(res, 200, { event: ev.id, reactions: reactionView(r.by, user.id) });
    },
  };

  return { routes, onStateSaved, tick };
}

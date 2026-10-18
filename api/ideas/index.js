/* Biscotos ideas box (docs/IDEAS.md): friends suggest what the app should do next and +1 each
 * other's ideas; each new idea is also opened as an issue on the project's GitHub repository, so
 * the maintainer sees it where the work happens.
 *
 * One file, ideas.json under DATA_DIR, written 0600 like every other data file:
 *
 *   { v: 1, ideas: [ { id, uid, title, body, at, votes: { [uid]: true }, status, issue, url, tries } ] }
 *
 * Clients are never shown a uid: an idea names its author by display name, and "mine"/"voted"
 * are worked out for the caller. The GitHub issue is anonymous — no name, no uid — and its text
 * is defused (no @mention can notify anyone, everything is quoted), because the repository is
 * public. The token only lives in the environment (IDEAS_GITHUB_TOKEN), is sent to GitHub alone,
 * and is never logged. Without it the box works exactly the same, in the app only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = Object.freeze({ TITLE_MIN: 3, TITLE_MAX: 80, BODY_MAX: 1000, PER_DAY: 5, TOTAL: 500, TRIES: 5 });
const STATUSES = ['open', 'done', 'declined'];
const DAY_MS = 86400000;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

class UnreadableError extends Error {}
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const file = dataDir => path.join(dataDir, 'ideas.json');

export function readIdeas(dataDir) {
  let raw;
  try { raw = fs.readFileSync(file(dataDir), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { v: 1, ideas: [] }; throw e; }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new UnreadableError('ideas file unreadable'); }
  if (!isObj(doc)) throw new UnreadableError('ideas file unreadable');
  return { v: 1, ideas: Array.isArray(doc.ideas) ? doc.ideas.filter(i => isObj(i) && typeof i.id === 'string') : [] };
}

/** One line of plain text: control characters out, whitespace collapsed, cut at `max`. */
export function cleanText(v, max, { multiline = false } = {}) {
  if (typeof v !== 'string') return '';
  let s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  s = multiline ? s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : s.replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

/** Text that cannot ping anyone on GitHub: a zero-width space after every @. */
export const defuse = s => String(s || '').replace(/@/g, '@​');

/** The anonymous issue for an idea: { title, body, labels }. Nothing in it names the author. */
export function issueFor(idea) {
  const quoted = idea.body ? defuse(idea.body).split('\n').map(l => '> ' + l).join('\n') : '> _(pas de détails)_';
  return {
    title: '[Idée] ' + defuse(idea.title),
    body: `${quoted}\n\n---\n_Proposée anonymement depuis la boîte à idées de Biscotos · ${idea.id}_`,
    labels: ['idea'],
  };
}

export function createIdeas({
  json, readBody, readSession, tooMany, createWindow, audit, dataDir, atomicWrite, userById, isAdmin,
  github = {}, fetchImpl = globalThis.fetch, now = () => Date.now()
}) {
  const READS = createWindow({ max: 60, windowMs: 60000 });
  const WRITES = createWindow({ max: 20, windowMs: 60000 });
  const gh = github.token && REPO.test(github.repo || '')
    ? { token: github.token, repo: github.repo, api: (github.api || 'https://api.github.com').replace(/\/+$/, '') }
    : null;

  const signedIn = (req, res, win) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    const wait = win.take(user.id);
    if (wait) { tooMany(res, wait); return null; }
    return user;
  };
  const load = res => {
    try { return readIdeas(dataDir); }
    catch (e) { console.error('ideas: ideas.json unreadable', e instanceof UnreadableError ? '' : e.code || ''); json(res, 503, { error: 'ideas unreadable' }); return null; }
  };
  const save = doc => atomicWrite(file(dataDir), JSON.stringify(doc), 0o600);
  const nameOf = uid => userById(uid)?.name || '—';
  const noIdea = res => json(res, 404, { error: 'no such idea' });

  const view = (i, uid) => ({
    id: i.id, title: i.title, body: i.body || '', at: i.at, author: nameOf(i.uid), mine: i.uid === uid,
    votes: Object.keys(i.votes || {}).length, voted: !!(i.votes || {})[uid], status: i.status || 'open',
    ...(i.url ? { url: i.url } : {}),
  });
  const ordered = (ideas, uid) => ideas.map(i => view(i, uid)).sort((a, b) =>
    ((a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1)) || (b.votes - a.votes) || (b.at - a.at));

  /* ---------- GitHub ---------- */

  async function openIssue(idea) {
    const post = body => fetchImpl(`${gh.api}/repos/${gh.repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'biscotos-ideas', 'Content-Type': 'application/json'
      },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    const issue = issueFor(idea);
    let r = await post(issue);
    // A token allowed to open issues but not to create the "idea" label: open it without.
    if (r.status === 422) { const { labels, ...plain } = issue; r = await post(plain); }
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const out = await r.json();
    return { issue: Number(out.number) || null, url: typeof out.html_url === 'string' ? out.html_url : null };
  }

  // Every idea not on GitHub yet, oldest first, at most TRIES attempts each. Never throws. One pass
  // at a time; an idea posted while a pass runs gets another pass right after, not at the next tick.
  let pushing = null, again = false;
  function push() {
    if (!gh) return Promise.resolve(0);
    if (pushing) { again = true; return pushing; }
    pushing = (async () => {
      let sent = 0;
      let doc; try { doc = readIdeas(dataDir); } catch { return 0; }
      for (const idea of doc.ideas.filter(i => !i.issue && (i.tries || 0) < LIMITS.TRIES).sort((a, b) => a.at - b.at)) {
        try {
          const { issue, url } = await openIssue(idea);
          const fresh = readIdeas(dataDir);           // the box may have changed meanwhile
          const cur = fresh.ideas.find(i => i.id === idea.id);
          if (cur) { cur.issue = issue; cur.url = url; save(fresh); sent++; }
        } catch (e) {
          console.error('ideas: could not open the GitHub issue', e.message);   // a status, never the token
          try {
            const fresh = readIdeas(dataDir);
            const cur = fresh.ideas.find(i => i.id === idea.id);
            if (cur) { cur.tries = (cur.tries || 0) + 1; save(fresh); }
          } catch { /* next tick */ }
        }
      }
      return sent;
    })().finally(() => { pushing = null; if (again) { again = false; push(); } });
    return pushing;
  }

  /* ---------- routes ---------- */

  const routes = {
    'GET /api/ideas': async (req, res) => {
      const user = signedIn(req, res, READS); if (!user) return;
      const doc = load(res); if (!doc) return;
      json(res, 200, { ideas: ordered(doc.ideas, user.id), github: !!gh, limits: LIMITS, admin: !!isAdmin(user) });
    },

    'POST /api/ideas': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const title = cleanText(body?.title, LIMITS.TITLE_MAX);
      const text = cleanText(body?.body, LIMITS.BODY_MAX, { multiline: true });
      if (title.length < LIMITS.TITLE_MIN) return json(res, 400, { error: `title: ${LIMITS.TITLE_MIN} to ${LIMITS.TITLE_MAX} characters`, field: 'title' });
      const doc = load(res); if (!doc) return;
      const t = now();
      if (doc.ideas.filter(i => i.uid === user.id && i.at > t - DAY_MS).length >= LIMITS.PER_DAY) {
        return json(res, 429, { error: `${LIMITS.PER_DAY} ideas a day at most`, code: 'per-day' });
      }
      if (doc.ideas.length >= LIMITS.TOTAL) return json(res, 409, { error: 'the box is full', code: 'full' });
      const idea = { id: crypto.randomBytes(9).toString('base64url'), uid: user.id, title, body: text, at: t, votes: {}, status: 'open', issue: null };
      doc.ideas.push(idea);
      save(doc);
      audit(req, 'ideas.create', { user, msg: title });
      push();
      json(res, 201, { idea: view(idea, user.id) });
    },

    // One +1 per person and idea: the same call again takes it back.
    'POST /api/ideas/vote': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const doc = load(res); if (!doc) return;
      const idea = typeof body?.id === 'string' ? doc.ideas.find(i => i.id === body.id) : null;
      if (!idea) return noIdea(res);
      idea.votes = isObj(idea.votes) ? idea.votes : {};
      if (idea.votes[user.id]) delete idea.votes[user.id]; else idea.votes[user.id] = true;
      save(doc);
      json(res, 200, { idea: view(idea, user.id) });
    },

    // The admin marks an idea done or declined (or open again).
    'POST /api/ideas/status': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      if (!isAdmin(user)) { audit(req, 'admin.denied', { user, msg: 'ideas.status' }); return json(res, 403, { error: 'admin only' }); }
      const body = await readBody(req);
      if (!STATUSES.includes(body?.status)) return json(res, 400, { error: `status: ${STATUSES.join(', ')}`, field: 'status' });
      const doc = load(res); if (!doc) return;
      const idea = typeof body?.id === 'string' ? doc.ideas.find(i => i.id === body.id) : null;
      if (!idea) return noIdea(res);
      idea.status = body.status;
      save(doc);
      audit(req, 'ideas.status', { user, msg: `${idea.id} ${idea.status}` });
      json(res, 200, { idea: view(idea, user.id) });
    },

    // Its author or the admin takes an idea out of the box (an issue already opened stays on GitHub).
    'POST /api/ideas/delete': async (req, res) => {
      const user = signedIn(req, res, WRITES); if (!user) return;
      const body = await readBody(req);
      const doc = load(res); if (!doc) return;
      const idea = typeof body?.id === 'string' ? doc.ideas.find(i => i.id === body.id) : null;
      if (!idea || (idea.uid !== user.id && !isAdmin(user))) return noIdea(res);   // someone else's: same answer as none
      doc.ideas = doc.ideas.filter(i => i.id !== idea.id);
      save(doc);
      json(res, 200, { ok: true });
    },
  };

  return { routes, tick: push, enabled: !!gh };
}

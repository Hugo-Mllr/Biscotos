// Biscotos: the weekly league of a circle of friends (docs/SOCIAL.md).
//
// Everything shown is computed by the server from each member's own data and limited to what
// that member shares (api/social/routes.js). This screen only reads it and manages circles:
// create, join with a code, invite, leave, and what you share.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import * as sapi from '../lib/social-api.js'
import { RULES, podium, myRow, gapToNext, initials, hueOf, ago } from '../lib/league.js'
import { CountUp, Sheet } from '../components/bx/index.jsx'
import Icon from '../components/Icon.jsx'

const BOARDS = [
  { key: 'week', label: () => t('This week') },
  { key: 'lastWeek', label: () => t('Last week') },
  { key: 'season', label: () => t('Season') },
]
const LAST_CIRCLE = 'bx_league_circle'
const remembered = () => { try { return localStorage.getItem(LAST_CIRCLE) } catch { return null } }
const remember = id => { try { localStorage.setItem(LAST_CIRCLE, id) } catch { /* private mode */ } }

function problemText(key) {
  return {
    'bad-code': t('No circle has this code. Check it with the friend who sent it.'),
    full: t('You are already in 5 circles. Leave one first.'),
    'circle-full': t('This circle is full.'),
    busy: t('Too many tries. Wait a minute.'),
    'signed-out': t('Your session has expired. Sign in again.'),
    gone: t('This circle is no longer available.'),
  }[key] || t('Something went wrong. Try again.')
}

export function Avatar({ name, size = 36, me = false }) {
  return <span className="bx-avatar" aria-hidden="true"
    style={{ width: size, height: size, fontSize: size * 0.4, '--h': hueOf(name), ...(me ? { boxShadow: '0 0 0 2px var(--bx-volt)' } : {}) }}>
    {initials(name)}
  </span>
}

export default function League() {
  const user = useStore(s => s.user)
  const nav = useNavigate()
  const [social, setSocial] = useState(null)
  const [circleId, setCircleId] = useState(remembered)
  const [board, setBoard] = useState(null)
  const [tab, setTab] = useState('week')
  const [error, setError] = useState(null)
  const [sheet, setSheet] = useState(null)       // 'start' | 'share' | 'circle' | 'rules'
  const [open, setOpen] = useState(null)         // member key whose detail is open

  const reload = useCallback(async () => {
    if (!user) return
    try { setError(null); setSocial(await sapi.loadSocial()) } catch (e) { setError(sapi.socialProblem(e)) }
  }, [user])
  useEffect(() => { reload() }, [reload])

  const circles = social?.circles || []
  const circle = circles.find(c => c.id === circleId) || circles[0] || null
  useEffect(() => {
    if (!circle) { setBoard(null); return }
    remember(circle.id)
    let live = true
    setBoard(null)
    sapi.loadLeaderboard(circle.id).then(b => { if (live) setBoard(b) }).catch(e => { if (live) setError(sapi.socialProblem(e)) })
    return () => { live = false }
  }, [circle?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return <div className="bx bx-page"><div className="bx-wrap">
      <Header />
      <div className="bx-card bx-empty">
        <p style={{ marginBottom: 'var(--bx-s4)' }}>{t('The league is shared through your server, so it needs an account.')}</p>
        <button className="bx-btn bx-btn-primary bx-tap" onClick={() => nav('/settings')}>{t('Sign in')}</button>
      </div>
    </div></div>
  }

  const onCircle = c => {
    setSocial(s => ({ ...s, circles: [...(s?.circles || []).filter(x => x.id !== c.id), c] }))
    setCircleId(c.id)
    setSheet(null)
  }
  const current = board?.[tab]
  const mine = board ? myRow(board.week) : null

  return (
    <div className="bx bx-page"><div className="bx-wrap">
      <Header circle={circle} start={board?.week?.start}
        onShare={() => setSheet('share')} onCircle={circle ? () => setSheet('circle') : null} />

      {error && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>
        {problemText(error)} <button className="bx-chip bx-tap" onClick={reload}>{t('Try again')}</button>
      </div>}

      {social && !circles.length && <Welcome onStart={() => setSheet('start')} />}

      {circles.length > 1 && <div className="bx-chips" role="tablist" aria-label={t('Circles')} style={{ marginBottom: 'var(--bx-s3)' }}>
        {circles.map(c => <button key={c.id} role="tab" aria-selected={c.id === circle?.id} aria-pressed={c.id === circle?.id}
          className="bx-chip bx-tap" onClick={() => setCircleId(c.id)}>{c.name}</button>)}
        <button className="bx-chip bx-tap" onClick={() => setSheet('start')} aria-label={t('Create or join a circle')}><Icon name="plus" /></button>
      </div>}

      {circle && <div className="bx-cols"><div className="bx-col">
        <div className="bx-chips" role="tablist" aria-label={t('Period')} style={{ marginBottom: 'var(--bx-s3)' }}>
          {BOARDS.map(b => <button key={b.key} role="tab" aria-selected={tab === b.key} aria-pressed={tab === b.key}
            className="bx-chip bx-tap" onClick={() => setTab(b.key)}>{b.label()}</button>)}
        </div>

        {!current ? <div className="bx-card"><div className="bx-skeleton" style={{ height: 180 }} /></div> : <>
          <Podium rows={current.rows} />
          <section className="bx-card" aria-label={t('Ranking')}>
            <ul className="bx-list">
              {current.rows.map(r => <LeagueRow key={r.member} row={r} tab={tab}
                open={open === r.member} onToggle={() => setOpen(o => (o === r.member ? null : r.member))} />)}
            </ul>
          </section>
        </>}
        <Gym circle={circle} />
        <Challenge circle={circle} />
        <Feed circle={circle} />
      </div><div className="bx-col">
        {mine && <MyWeek row={mine} rows={board.week.rows} />}
        <section className="bx-card">
          <div className="bx-card-hd">
            <h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('How to score')}</h2>
            <button className="bx-chip bx-tap" onClick={() => setSheet('rules')}>{t('Details')}</button>
          </div>
          <ul className="bx-rules">
            {RULES.map(r => <li key={r.key}><Icon name={r.icon} /><span>{t(r.title)}</span><b>+{r.pts}</b></li>)}
          </ul>
        </section>
        <Invite circle={circle} />
      </div></div>}

      {sheet === 'start' && <StartSheet prefs={social?.prefs} onClose={() => setSheet(null)} onDone={onCircle} />}
      {sheet === 'share' && social && <ShareSheet prefs={social.prefs} onClose={() => setSheet(null)}
        onSaved={prefs => { setSocial(s => ({ ...s, prefs })); setSheet(null); if (circle) sapi.loadLeaderboard(circle.id).then(setBoard).catch(() => {}) }} />}
      {sheet === 'circle' && circle && <CircleSheet circle={circle} onClose={() => setSheet(null)}
        onChanged={c => { setSocial(s => ({ ...s, circles: s.circles.map(x => (x.id === c.id ? c : x)) })); }}
        onGone={() => { setSheet(null); setCircleId(null); reload() }} />}
      {sheet === 'rules' && <Sheet title={t('How to score')} onClose={() => setSheet(null)}>
        <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>
          {t('Points reward effort against your own level, never the weight on the bar: everyone can win a week.')}
        </p>
        <ul className="bx-list">{RULES.map(r => <li key={r.key} className="bx-item">
          <span className="bx-rule-ic"><Icon name={r.icon} /></span>
          <div className="bx-item-main"><div className="bx-item-title">{t(r.title)}</div><div className="bx-item-sub">{t(r.note)}</div></div>
          <b>+{r.pts}</b>
        </li>)}</ul>
        <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s4)' }}>
          {t('Streak: weeks in a row with at least one workout. One joker a month covers a single missed week.')}
        </p>
      </Sheet>}
    </div></div>
  )
}

function Header({ circle, start, onShare, onCircle }) {
  const kicker = start
    ? t('Week of {0}', new Date(start + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))
    : t('League')
  return (
    <header className="bx-head">
      <div>
        <div className="bx-kicker">{kicker}</div>
        <h1 className="bx-title">{circle?.name || t('League')}</h1>
      </div>
      <div className="bx-head-actions">
        {onShare && <button className="bx-iconbtn bx-tap" onClick={onShare} aria-label={t('What I share')}><Icon name="shield" /></button>}
        {onCircle && <button className="bx-iconbtn bx-tap" onClick={onCircle} aria-label={t('Circle settings')}><Icon name="gear" /></button>}
      </div>
    </header>
  )
}

function Welcome({ onStart }) {
  return <section className="bx-card bx-hero">
    <Icon name="trophy" className="bx-hero-ic" />
    <h2 className="bx-title" style={{ fontSize: 'var(--bx-fs-xl)', margin: 'var(--bx-s3) 0' }}>{t('Train with your friends')}</h2>
    <p className="bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>
      {t('Create a circle, send the code to your friends, and a new league starts every Monday. Points reward progress against your own level, so everyone has a chance.')}
    </p>
    <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" onClick={onStart}><Icon name="plus" /> {t('Create or join a circle')}</button>
  </section>
}

function Podium({ rows }) {
  const top = podium(rows)
  if (!top.length) return <div className="bx-card bx-empty" style={{ marginBottom: 'var(--bx-s3)' }}>{t('No points yet. The first workout takes the lead.')}</div>
  return <div className="bx-podium" aria-label={t('Podium')}>
    {top.map(r => <div key={r.member} className={'bx-step bx-step-' + r.rank}>
      {r.rank === 1 && <Icon name="crown" className="bx-crown" />}
      <Avatar name={r.name} size={r.rank === 1 ? 56 : 44} me={r.me} />
      <div className="bx-step-name">{r.me ? t('You') : r.name}</div>
      <div className="bx-score bx-score-sm"><CountUp value={r.points} /></div>
      <div className="bx-step-block"><span>{r.rank}</span></div>
    </div>)}
  </div>
}

function LeagueRow({ row, tab, open, onToggle }) {
  const hidden = row.points == null
  const detail = tab === 'week' && !hidden && row.breakdown
  return <li className={'bx-item bx-lrow' + (row.me ? ' is-me' : '')}>
    <span className="bx-rank">{hidden ? '–' : row.rank}</span>
    <Avatar name={row.name} me={row.me} />
    <button className="bx-item-main bx-tap" style={{ textAlign: 'start' }} onClick={detail ? onToggle : undefined} aria-expanded={detail ? open : undefined}>
      <div className="bx-item-title">{row.me ? t('You') : row.name}</div>
      <div className="bx-item-sub">
        {hidden ? t('Does not share training')
          : tab === 'season' ? tn('{0} week', '{0} weeks', row.weeks || 0)
          : <>
            {tn('{0} workout', '{0} workouts', row.workouts || 0)}
            {row.streak?.weeks > 0 && <>{' · '}<span className="bx-flame"><Icon name="flame" />{row.streak.weeks}</span></>}
          </>}
      </div>
      {open && detail && <div className="bx-breakdown">
        {RULES.map(r => row.breakdown[r.key] == null ? null
          : <span key={r.key}><Icon name={r.icon} /> {t(r.title)} <b>{row.breakdown[r.key]}</b></span>)}
      </div>}
    </button>
    {!hidden && <span className="bx-pts"><CountUp value={row.points} /><small>{t('pts')}</small></span>}
  </li>
}

function MyWeek({ row, rows }) {
  if (row.points == null) return <section className="bx-card bx-small bx-dim">{t('You do not share your training: friends see no points for you.')}</section>
  const gap = gapToNext(rows, row)
  const s = row.streak || { weeks: 0 }
  return <section className="bx-card bx-me" aria-label={t('Your week')}>
    <div className="bx-row4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center' }}>
      <div><div className="bx-label">{t('Rank')}</div><div className="bx-score bx-score-sm">{row.rank}</div></div>
      <div><div className="bx-label">{t('Points')}</div><div className="bx-score bx-score-sm"><CountUp value={row.points} /></div></div>
      <div><div className="bx-label">{t('Streak')}</div><div className="bx-score bx-score-sm bx-flame"><Icon name="flame" />{s.weeks}</div></div>
    </div>
    <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)', textAlign: 'center' }}>
      {gap === 0 ? t('You lead the week. Hold on!') : t('{0} points to the next place.', fmtNum(gap))}{' '}
      {s.weeks > 0 && (s.jokerAvailable ? t('Joker available this month.') : t('Joker used this month.'))}
    </p>
  </section>
}

function Invite({ circle }) {
  const [copied, setCopied] = useState(false)
  const text = t('Join my circle “{0}” on Biscotos with the code {1}', circle.name, circle.code)
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ text, url: location.origin }); return }
      await navigator.clipboard.writeText(circle.code)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { /* cancelled */ }
  }
  return <section className="bx-card">
    <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Invite friends')}</h2>
      <span className="bx-small bx-dim">{tn('{0} member', '{0} members', circle.members.length)}</span></div>
    <div className="bx-code" aria-label={t('Circle code')}>{circle.code}</div>
    <button className="bx-btn bx-btn-block bx-tap" onClick={share}><Icon name="link" /> {copied ? t('Code copied') : t('Share the code')}</button>
    <div className="bx-avatars">{circle.members.map(m => <span key={m.member} title={m.name}><Avatar name={m.name} size={30} me={m.me} /></span>)}</div>
  </section>
}

function Toggles({ value, onChange }) {
  const items = [
    ['training', t('Points, workouts and streak'), t('Never the weights you lift.')],
    ['prs', t('Personal records'), t('How many, not which loads.')],
    ['nutrition', t('Days on my calorie goal'), t('Never what you eat.')],
    ['notify', t('Notifications'), t('Reactions, friends’ records and the Monday recap.')],
  ]
  return <div className="bx-toggles">
    {items.map(([k, title, sub]) => <label key={k} className="bx-toggle">
      <span><b>{title}</b><small>{sub}</small></span>
      <input type="checkbox" role="switch" checked={!!value[k]} onChange={e => onChange({ ...value, [k]: e.target.checked })} />
    </label>)}
    <p className="bx-small bx-dim">{t('Your body weight and measurements are never shared.')}</p>
  </div>
}

function StartSheet({ prefs, onClose, onDone }) {
  const [mode, setMode] = useState('join')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [share, setShare] = useState(prefs || { training: true, prs: true, nutrition: false, notify: true })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async e => {
    e.preventDefault()
    setBusy(true); setProblem(null)
    try { onDone(mode === 'join' ? await sapi.joinCircle(code, share) : await sapi.createCircle(name, share)) }
    catch (err) { setProblem(sapi.socialProblem(err)) }
    finally { setBusy(false) }
  }
  return <Sheet title={t('Your circle')} onClose={onClose}>
    <div className="bx-chips" style={{ marginBottom: 'var(--bx-s4)' }}>
      <button className="bx-chip bx-tap" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>{t('Join with a code')}</button>
      <button className="bx-chip bx-tap" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>{t('Create a circle')}</button>
    </div>
    <form onSubmit={submit}>
      {mode === 'join'
        ? <label className="bx-field"><span className="bx-label">{t('Circle code')}</span>
          <input className="bx-input bx-input-code" value={code} onChange={e => setCode(e.target.value)} placeholder="ABCD-EFGH" autoCapitalize="characters" autoComplete="off" maxLength={12} required /></label>
        : <label className="bx-field"><span className="bx-label">{t('Circle name')}</span>
          <input className="bx-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('The Biscotos')} maxLength={40} required /></label>}
      <h3 className="bx-label" style={{ margin: 'var(--bx-s4) 0 var(--bx-s2)' }}>{t('What my friends see')}</h3>
      <Toggles value={share} onChange={setShare} />
      {problem && <div className="bx-alert" role="alert" style={{ margin: 'var(--bx-s3) 0' }}>{problemText(problem)}</div>}
      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={busy} style={{ marginTop: 'var(--bx-s4)' }}>
        {mode === 'join' ? t('Join') : t('Create')}
      </button>
    </form>
  </Sheet>
}

function ShareSheet({ prefs, onClose, onSaved }) {
  const [share, setShare] = useState(prefs)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const save = async () => {
    setBusy(true); setProblem(null)
    try { onSaved((await sapi.savePrefs(share)).prefs) } catch (e) { setProblem(sapi.socialProblem(e)) } finally { setBusy(false) }
  }
  return <Sheet title={t('What I share')} onClose={onClose}>
    <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>{t('The same choice for all your circles. Friends only ever see points and counts.')}</p>
    <Toggles value={share} onChange={setShare} />
    {problem && <div className="bx-alert" role="alert">{problemText(problem)}</div>}
    <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={busy} onClick={save} style={{ marginTop: 'var(--bx-s4)' }}>{t('Save')}</button>
  </Sheet>
}

function CircleSheet({ circle, onClose, onChanged, onGone }) {
  const [name, setName] = useState(circle.name)
  const [problem, setProblem] = useState(null)
  const [confirm, setConfirm] = useState(null)   // 'leave' | 'delete' | member key
  const run = async (fn, after) => {
    setProblem(null)
    try { after(await fn()) } catch (e) { setProblem(sapi.socialProblem(e)) }
  }
  return <Sheet title={circle.name} onClose={onClose}>
    {circle.owner && <form onSubmit={e => { e.preventDefault(); run(() => sapi.renameCircle(circle.id, name), onChanged) }} style={{ marginBottom: 'var(--bx-s4)' }}>
      <label className="bx-field"><span className="bx-label">{t('Circle name')}</span>
        <input className="bx-input" value={name} onChange={e => setName(e.target.value)} maxLength={40} required /></label>
      <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap' }}>
        <button className="bx-chip bx-tap" type="submit">{t('Rename')}</button>
        <button className="bx-chip bx-tap" type="button" onClick={() => run(() => sapi.rotateCode(circle.id), onChanged)}>{t('New code')}</button>
      </div>
      <p className="bx-small bx-dim" style={{ marginTop: 6 }}>{t('A new code stops the old one at once.')}</p>
    </form>}
    {circle.owner && <label className="bx-toggle" style={{ marginBottom: 'var(--bx-s4)' }}>
      <span><b>{t('Wall of shame')}</b><small>{t('The Monday recap names those on 0 points.')}</small></span>
      <input type="checkbox" role="switch" checked={circle.shame !== false}
        onChange={e => run(() => sapi.setShame(circle.id, e.target.checked), onChanged)} />
    </label>}
    <h3 className="bx-label" style={{ marginBottom: 'var(--bx-s2)' }}>{t('Members')}</h3>
    <ul className="bx-list" style={{ marginBottom: 'var(--bx-s4)' }}>
      {circle.members.map(m => <li key={m.member} className="bx-item">
        <Avatar name={m.name} size={30} me={m.me} />
        <div className="bx-item-main"><div className="bx-item-title">{m.me ? t('You') : m.name}</div>
          {m.owner && <div className="bx-item-sub">{t('Owner')}</div>}</div>
        {circle.owner && !m.me && (confirm === m.member
          ? <button className="bx-chip bx-tap bx-danger" onClick={() => run(() => sapi.removeMember(circle.id, m.member), c => { setConfirm(null); onChanged(c) })}>{t('Confirm')}</button>
          : <button className="bx-chip bx-tap" onClick={() => setConfirm(m.member)}>{t('Remove')}</button>)}
      </li>)}
    </ul>
    {problem && <div className="bx-alert" role="alert">{problemText(problem)}</div>}
    <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap' }}>
      {confirm === 'leave'
        ? <button className="bx-btn bx-tap bx-danger" onClick={() => run(() => sapi.leaveCircle(circle.id), onGone)}>{t('Leave for good')}</button>
        : <button className="bx-btn bx-tap" onClick={() => setConfirm('leave')}>{t('Leave the circle')}</button>}
      {circle.owner && (confirm === 'delete'
        ? <button className="bx-btn bx-tap bx-danger" onClick={() => run(() => sapi.deleteCircle(circle.id), onGone)}>{t('Delete for everyone')}</button>
        : <button className="bx-btn bx-btn-ghost bx-tap" onClick={() => setConfirm('delete')}>{t('Delete the circle')}</button>)}
    </div>
  </Sheet>
}

// One goal a week for the whole circle, and the milestones each member has reached.
const CHALLENGE_TITLES = { sessions: 'Sessions together', records: 'Records together', plan: 'Weekly plans met' }
function badgeLabel(b) {
  return b.id === 'sessions' ? tn('{0} session', '{0} sessions', b.tier)
    : b.id === 'streak' ? tn('{0} week', '{0} weeks', b.tier)
    : tn('{0} record', '{0} records', b.tier)
}
function Challenge({ circle }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let live = true
    setData(null)
    sapi.loadChallenge(circle.id).then(d => { if (live) setData(d) }).catch(() => { if (live) setData({ challenge: null, members: [] }) })
    return () => { live = false }
  }, [circle.id])
  if (data && !data.challenge && !data.members.some(m => m.badges.length)) return null
  const c = data?.challenge
  return <section className="bx-card" aria-label={t('Weekly challenge')} style={{ marginTop: 'var(--bx-s3)' }}>
    <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Weekly challenge')}</h2></div>
    {!data ? <div className="bx-skeleton" style={{ height: 60 }} /> : <>
      {c && <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--bx-s2)', marginBottom: 'var(--bx-s2)' }}><b>{t(CHALLENGE_TITLES[c.kind])}</b><span className="bx-small bx-dim">{c.done ? t('Done') : `${c.progress} / ${c.goal}`}</span></div>
        <progress max={c.goal} value={Math.min(c.progress, c.goal)} aria-label={t(CHALLENGE_TITLES[c.kind])} style={{ width: '100%' }} />
      </div>}
      {data.members.some(m => m.badges.length) && <>
        <h3 className="bx-label" style={{ marginTop: 'var(--bx-s3)' }}>{t('Badges')}</h3>
        <ul className="bx-list">{data.members.filter(m => m.badges.length).map(m => <li key={m.member} className="bx-item" style={{ flexWrap: 'wrap', gap: 'var(--bx-s2)' }}>
          <span>{m.me ? t('You') : m.name}</span> {m.badges.map(b => <span key={b.id} className="bx-chip"><Icon name={b.id === 'streak' ? 'flame' : b.id === 'records' ? 'trophy' : 'medal'} /> {badgeLabel(b)}</span>)}
        </li>)}</ul>
      </>}
    </>}
  </section>
}

// Who says they are at the gym right now: checking in is the consent, and it lapses by itself.
function Gym({ circle }) {
  const [gym, setGym] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => sapi.loadGym(circle.id).then(setGym).catch(() => setGym({ here: [], mine: false })), [circle.id])
  useEffect(() => { setGym(null); load() }, [load])
  const toggle = async () => {
    setBusy(true)
    try { await sapi.setGym(!gym.mine); await load() } catch { /* keeps the old state */ } finally { setBusy(false) }
  }
  return <section className="bx-card" aria-label={t('At the gym')} style={{ marginTop: 'var(--bx-s3)' }}>
    <div className="bx-card-hd">
      <h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('At the gym')}</h2>
      {gym && <button className="bx-chip bx-tap" disabled={busy} onClick={toggle}>{gym.mine ? t('I left') : t("I'm at the gym")}</button>}
    </div>
    {!gym ? <div className="bx-skeleton" style={{ height: 40 }} />
      : !gym.here.length ? <p className="bx-small bx-dim">{t('Nobody at the gym right now.')}</p>
      : <ul className="bx-list">{gym.here.map(p => <li key={p.member} className="bx-item" style={{ gap: 'var(--bx-s2)' }}>{p.me ? t('You') : p.name} <span className="bx-small bx-dim">{ago(p.since, Date.now(), dateLocale())}</span></li>)}</ul>}
  </section>
}

// What happened in the circle these two weeks, with one-tap reactions.
function Feed({ circle }) {
  const [feed, setFeed] = useState(null)
  useEffect(() => {
    let live = true
    setFeed(null)
    sapi.loadFeed(circle.id).then(f => { if (live) setFeed(f) }).catch(() => { if (live) setFeed({ events: [], choices: [] }) })
    return () => { live = false }
  }, [circle.id])
  const onReact = async (ev, emoji) => {
    const next = ev.reactions.mine === emoji ? null : emoji
    try {
      const r = await sapi.react(circle.id, ev.id, next)
      setFeed(f => ({ ...f, events: f.events.map(e => (e.id === ev.id ? { ...e, reactions: r.reactions } : e)) }))
    } catch { /* keeps the old state */ }
  }
  return <section className="bx-card" aria-label={t('Activity')} style={{ marginTop: 'var(--bx-s3)' }}>
    <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Activity')}</h2></div>
    {!feed ? <div className="bx-skeleton" style={{ height: 80 }} />
      : !feed.events.length ? <p className="bx-small bx-dim">{t('Nothing yet these two weeks.')}</p>
      : <ul className="bx-list bx-feed">{feed.events.map(ev => <FeedItem key={ev.id} ev={ev} choices={feed.choices} onReact={onReact} />)}</ul>}
  </section>
}

function FeedItem({ ev, choices, onReact }) {
  const who = ev.me ? t('You') : ev.name
  const line = ev.kind === 'joined' ? t('{0} joined the circle', who)
    : ev.title ? t('{0} finished “{1}”', who, ev.title) : t('{0} finished a workout', who)
  const meta = ev.kind === 'workout' ? [
    ev.minutes ? t('{0} min', ev.minutes) : null,
    ev.exercises ? tn('{0} exercise', '{0} exercises', ev.exercises) : null,
  ].filter(Boolean).join(' · ') : ''
  return <li className="bx-item bx-feed-item">
    <Avatar name={ev.name} size={34} me={ev.me} />
    <div className="bx-item-main">
      <div className="bx-feed-line">{line}</div>
      <div className="bx-item-sub">
        {ago(ev.at, Date.now(), dateLocale())}{meta ? ' · ' + meta : ''}
        {ev.records > 0 && <span className="bx-feed-pr"><Icon name="trophy" /> {tn('{0} record', '{0} records', ev.records)}</span>}
      </div>
      {ev.kind === 'workout' && <div className="bx-reacts">
        {choices.map(e => {
          const n = ev.reactions.counts[e] || 0
          const mine = ev.reactions.mine === e
          return <button key={e} className={'bx-react bx-tap' + (mine ? ' is-mine' : '') + (n ? ' has' : '')} aria-pressed={mine}
            aria-label={t('React {0}', e)} onClick={() => onReact(ev, e)}>{e}{n > 0 && <span>{n}</span>}</button>
        })}
      </div>}
    </div>
  </li>
}

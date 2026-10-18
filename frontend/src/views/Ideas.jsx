// Biscotos ideas box (docs/IDEAS.md): suggest what the app should do next, +1 the friends' ideas.
// Reached from Home. With the server's GitHub settings each new idea is also an anonymous issue on
// the project's public repository, and the form says so before anything is sent.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { ago } from '../lib/league.js'
import * as iapi from '../lib/ideas-api.js'
import Icon from '../components/Icon.jsx'

const STATUS_LABEL = { done: () => t('Implemented'), declined: () => t('Not planned') }

export default function Ideas() {
  const nav = useNavigate()
  const [box, setBox] = useState(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const reload = useCallback(() => iapi.loadIdeas().then(setBox).catch(() => setBox({ ideas: [], failed: true })), [])
  useEffect(() => { reload() }, [reload])

  const replace = idea => setBox(b => ({ ...b, ideas: b.ideas.map(i => (i.id === idea.id ? idea : i)) }))
  const send = async e => {
    e.preventDefault()
    if (busy || title.trim().length < 3) return
    setBusy(true); setProblem(null)
    try {
      const idea = await iapi.sendIdea(title.trim(), body.trim())
      setBox(b => ({ ...b, ideas: [idea, ...(b?.ideas || [])] }))
      setTitle(''); setBody('')
    } catch (err) { setProblem(iapi.ideaProblem(err)) } finally { setBusy(false) }
  }
  const act = fn => async () => { try { const r = await fn(); if (r?.id) replace(r) } catch { /* keeps the old state */ } }
  const remove = id => async () => { try { await iapi.deleteIdea(id); setBox(b => ({ ...b, ideas: b.ideas.filter(i => i.id !== id) })) } catch { /* stays */ } }

  return <div className="bx bx-page"><div className="bx-wrap">
    <header className="bx-head">
      <div>
        <button className="bx-iconbtn bx-tap" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      </div>
      <div style={{ flex: 1 }}><h1 className="bx-title">{t('Ideas')}</h1></div>
    </header>
    <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s3)' }}>{t('Suggest what Biscotos should do next, and +1 your friends’ ideas.')}</p>

    <form className="bx-card" onSubmit={send}>
      <label className="bx-field"><span className="bx-label">{t('Your idea')}</span>
        <input className="bx-input" value={title} onChange={e => setTitle(e.target.value)} maxLength={box?.limits?.TITLE_MAX || 80} required minLength={3} /></label>
      <label className="bx-field"><span className="bx-label">{t('Details (optional)')}</span>
        <textarea className="bx-input" rows={3} value={body} onChange={e => setBody(e.target.value)} maxLength={box?.limits?.BODY_MAX || 1000} /></label>
      <p className="bx-small bx-dim" style={{ margin: 'var(--bx-s2) 0' }}>
        {box?.github ? t('Your idea is published anonymously on the project’s public GitHub. Do not put anything personal in it.') : t('Your friends see it and can +1 it.')}
      </p>
      {problem && <div className="bx-alert" role="alert">{problem === 'per-day' ? t('Five ideas a day at most. Come back tomorrow.') : t('Could not send. Try again.')}</div>}
      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={busy || title.trim().length < 3}>{t('Send')}</button>
    </form>

    {!box ? <div className="bx-skeleton" style={{ height: 120, marginTop: 'var(--bx-s3)' }} />
      : !box.ideas.length ? <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s4)', textAlign: 'center' }}>{t('No idea yet. Be the first!')}</p>
      : <ul className="bx-list" style={{ marginTop: 'var(--bx-s3)' }}>{box.ideas.map(i => <li key={i.id} className="bx-item" style={{ display: 'block' }}>
        <div style={{ display: 'flex', gap: 'var(--bx-s3)', alignItems: 'flex-start' }}>
          <button className="bx-chip bx-tap" aria-pressed={i.voted} aria-label={`+1 ${i.title}`} onClick={act(() => iapi.voteIdea(i.id))}>+1 {i.votes}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{i.title} {STATUS_LABEL[i.status] && <span className="tag">{STATUS_LABEL[i.status]()}</span>}</div>
            {i.body && <div className="bx-small" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{i.body}</div>}
            <div className="bx-small bx-dim" style={{ marginTop: 4 }}>
              {i.mine ? t('You') : i.author} · {ago(i.at, Date.now(), dateLocale())}
              {i.url && <> · <a href={i.url} target="_blank" rel="noopener noreferrer">GitHub</a></>}
            </div>
            {(i.mine || box.admin) && <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap', marginTop: 'var(--bx-s2)' }}>
              {box.admin && i.status !== 'done' && <button className="bx-chip bx-tap" onClick={act(() => iapi.setIdeaStatus(i.id, 'done'))}>{t('Implemented')}</button>}
              {box.admin && i.status !== 'declined' && <button className="bx-chip bx-tap" onClick={act(() => iapi.setIdeaStatus(i.id, 'declined'))}>{t('Not planned')}</button>}
              {box.admin && i.status !== 'open' && <button className="bx-chip bx-tap" onClick={act(() => iapi.setIdeaStatus(i.id, 'open'))}>{t('Reopen')}</button>}
              <button className="bx-chip bx-tap" onClick={remove(i.id)}>{t('Delete')}</button>
            </div>}
          </div>
        </div>
      </li>)}</ul>}
  </div></div>
}

/** The count Home shows on its card. */
export const ideasCount = n => tn('{0} idea', '{0} ideas', n)

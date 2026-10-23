// Apple Health import: the webhook tokens of this profile (docs/APPLE_HEALTH.md). A new token is
// shown here once, with the address the iOS Shortcut posts to; after this sheet closes only its
// label and dates remain visible — the server keeps nothing but its hash.
import { useEffect, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { getLang } from '../../lib/i18n-core.js'
import { useStore } from '../../store/useStore.js'
import { SHORTCUT_JSON, guideSteps } from '../../lib/health-guide.js'
import { apiUrl } from '../../lib/api.js'
import { listHookTokens, createHookToken, revokeHookToken, loadHealthSamples } from '../../lib/nutrition-api.js'
import { shiftDay } from '../../lib/nutrition.js'
import { saveFailure } from '../../lib/failure.js'
import { todayISO, fmtNum } from '../../lib/format.js'
import { Sheet } from './index.jsx'

const fmtWhen = ms => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : t('never'))
const TYPE_LABEL = { weight: () => t('Body weight'), steps: () => t('Steps'), restingHr: () => t('Resting heart rate'), sleepMin: () => t('Sleep'), activeKcal: () => t('Active energy'), workoutMin: () => t('Workouts') }
const UNIT = { weight: 'kg', steps: '', restingHr: 'bpm', sleepMin: 'min', activeKcal: 'kcal', workoutMin: 'min' }

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export default function HealthImportSheet({ onClose }) {
  const [hooks, setHooks] = useState(null)
  const [fresh, setFresh] = useState(null)      // { token, hook } just created — shown once
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [copied, setCopied] = useState(null)
  const [latest, setLatest] = useState([])
  const endpoint = apiUrl('/api/hooks/apple-health')
  const shortcut = useStore(s => s.config?.health_shortcut)

  useEffect(() => {
    // The widget's keys (components/bx/WidgetSheet.jsx) are listed there, not among the Shortcut's.
    listHookTokens().then(r => setHooks((r.hooks || []).filter(h => (h.kind || 'apple-health') === 'apple-health'))).catch(setErr)
    const today = todayISO()
    loadHealthSamples(shiftDay(today, -6), today).then(s => {
      // the newest value of each type
      const m = new Map()
      for (const x of s) if (!m.has(x.type) || m.get(x.type).d < x.d) m.set(x.type, x)
      setLatest([...m.values()])
    }).catch(() => {})
  }, [])

  const create = async e => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await createHookToken(label.trim() || 'Apple Health')
      setFresh(r); setHooks(h => [...(h || []), r.hook]); setLabel('')
    } catch (x) { setErr(x) } finally { setBusy(false) }
  }
  const revoke = async id => {
    setBusy(true); setErr(null)
    try {
      const hook = await revokeHookToken(id)
      setHooks(h => h.map(x => (x.id === id ? hook : x)))
      if (fresh?.hook.id === id) setFresh(null)
    } catch (x) { setErr(x) } finally { setBusy(false) }
  }
  const doCopy = async (what, text) => setCopied((await copy(text)) ? what : null)
  const live = (hooks || []).filter(h => !h.revokedAt)

  return (
    <Sheet title={t('Apple Health')} onClose={onClose}>
      <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>
        {t('An iOS Shortcut sends your weight, steps, sleep and resting heart rate here. Each Shortcut gets its own token, which you can revoke at any time.')}
      </p>

      {fresh && <div className="bx-card bx-flash" style={{ borderColor: 'var(--bx-volt-text)' }} role="status">
        <p className="bx-label" style={{ color: 'var(--bx-volt-text)', marginBottom: 'var(--bx-s2)' }}>{t('Copy it now: it will not be shown again.')}</p>
        <Field label={t('Address')} value={endpoint} onCopy={() => doCopy('url', endpoint)} copied={copied === 'url'} />
        <Field label={t('Token')} value={fresh.token} onCopy={() => doCopy('token', fresh.token)} copied={copied === 'token'} secret />
        <button type="button" className="bx-chip bx-tap" style={{ marginBottom: 'var(--bx-s2)' }} onClick={() => doCopy('auth', 'Bearer ' + fresh.token)}>
          {copied === 'auth' ? t('Copied') : t('Copy “Bearer” + token')}
        </button>
        <p className="bx-small bx-dim">{t('Paste both into the Shortcut, as described in the guide. Treat the token like a password.')}</p>
      </div>}

      {err && <div className="bx-alert" role="alert" style={{ margin: 'var(--bx-s3) 0' }}>{err.status === 409 ? t('Five tokens at most: revoke one first.') : saveFailure(err)}</div>}

      <section className="bx-card" aria-label={t('Tokens')}>
        <div className="bx-card-hd"><h3 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Tokens')}</h3></div>
        {hooks === null ? <div className="bx-skeleton" style={{ height: 40 }} />
          : !hooks.length ? <p className="bx-small bx-dim">{t('No token yet.')}</p>
          : <ul className="bx-list">{hooks.map(h => <li key={h.id} className="bx-item">
              <div className="bx-item-main">
                <div className="bx-item-title" style={h.revokedAt ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{h.label}</div>
                <div className="bx-item-sub">{h.revokedAt ? t('Revoked {0}', fmtWhen(h.revokedAt)) : t('Last used: {0}', fmtWhen(h.lastUsedAt))}</div>
              </div>
              {!h.revokedAt && <button className="bx-chip bx-tap" style={{ color: 'var(--bx-danger)' }} disabled={busy} onClick={() => revoke(h.id)}>{t('Revoke')}</button>}
            </li>)}</ul>}
        {live.length < 5 && <form onSubmit={create} style={{ marginTop: 'var(--bx-s3)' }}>
          <label className="bx-field"><span className="bx-label">{t('Name of this Shortcut')}</span>
            <input className="bx-input" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} placeholder="iPhone" />
          </label>
          <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={busy}>{t('Create a token')}</button>
        </form>}
      </section>

      {shortcut && <a className="bx-btn bx-btn-primary bx-btn-block bx-tap" href={shortcut} target="_blank" rel="noopener noreferrer" style={{ marginBottom: 'var(--bx-s2)' }}>
        {t('Install the Shortcut')}
      </a>}
      {shortcut && <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>
        {t('Create a token first: when iOS asks, paste the address, then “Bearer”, a space and the token.')}
      </p>}

      <details className="bx-card">
        <summary className="bx-label" style={{ color: 'var(--bx-ink)', cursor: 'pointer' }}>{shortcut ? t('Or build it yourself') : t('How to set up the Shortcut')}</summary>
        <ol style={{ paddingLeft: '1.2em', marginTop: 'var(--bx-s3)' }}>
          {guideSteps(getLang()).map((step, i) => <li key={i} style={{ marginBottom: 'var(--bx-s3)' }}>
            <strong>{step.title}</strong>
            <p className="bx-small bx-dim">{step.text}</p>
            {step.copy === 'json' && <>
              <pre className="bx-small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{SHORTCUT_JSON}</pre>
              <button type="button" className="bx-chip bx-tap" onClick={() => doCopy('json', SHORTCUT_JSON)}>{copied === 'json' ? t('Copied') : t('Copy the text')}</button>
            </>}
            {step.copy === 'url' && <button type="button" className="bx-chip bx-tap" onClick={() => doCopy('guide-url', endpoint)}>{copied === 'guide-url' ? t('Copied') : t('Copy the address')}</button>}
          </li>)}
        </ol>
      </details>

      {latest.length > 0 && <section className="bx-card" aria-label={t('Received this week')}>
        <div className="bx-card-hd"><h3 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Received this week')}</h3></div>
        <ul className="bx-list">{latest.map(s => <li key={s.type} className="bx-item">
          <div className="bx-item-main"><div className="bx-item-title">{TYPE_LABEL[s.type]?.() || s.type}</div><div className="bx-item-sub">{s.d}</div></div>
          <strong>{fmtNum(s.value)}{UNIT[s.type] ? ' ' + UNIT[s.type] : ''}</strong>
        </li>)}</ul>
      </section>}
    </Sheet>
  )
}

function Field({ label, value, onCopy, copied, secret }) {
  return <div className="bx-field">
    <span className="bx-label">{label}</span>
    <div style={{ display: 'flex', gap: 'var(--bx-s2)' }}>
      <input className="bx-input" readOnly value={value} onFocus={e => e.target.select()} spellCheck={false}
        autoComplete="off" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} aria-label={label} {...(secret ? { 'data-secret': '' } : {})} />
      <button type="button" className="bx-chip bx-tap" onClick={onCopy}>{copied ? t('Copied') : t('Copy')}</button>
    </div>
  </div>
}

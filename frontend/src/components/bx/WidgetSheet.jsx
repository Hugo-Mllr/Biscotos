// Biscotos: the iPhone widget (docs/WIDGET.md). A widget key is created here, and the Scriptable
// script that holds it is copied to the clipboard in one tap: paste it once into Scriptable and add the
// widget. The key is shown nowhere — only inside the copied script, once; after this sheet closes
// only the label and dates remain, and a lost phone's key is revoked from this list.
import { useEffect, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { getLang } from '../../lib/i18n-core.js'
import { apiUrl } from '../../lib/api.js'
import { listHookTokens, createHookToken, revokeHookToken } from '../../lib/nutrition-api.js'
import { widgetScript } from '../../lib/widget-script.js'
import { Sheet } from './index.jsx'

const fmtWhen = ms => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : t('never'))
const isWidget = h => h.kind === 'widget'

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export default function WidgetSheet({ onClose }) {
  const [hooks, setHooks] = useState(null)
  const [fresh, setFresh] = useState(null)      // { token, hook } just created: its script can be copied now
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { listHookTokens().then(r => setHooks((r.hooks || []).filter(isWidget))).catch(setErr) }, [])

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await createHookToken(t('iPhone widget'), 'widget')
      setFresh(r); setHooks(h => [...(h || []), r.hook]); setCopied(false)
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
  const copyScript = async () => {
    const base = apiUrl('/api/hooks/widget').replace(/\/api\/hooks\/widget$/, '')
    setCopied(await copy(widgetScript({ base, key: fresh.token, lang: getLang() })))
  }
  const live = (hooks || []).filter(h => !h.revokedAt)

  return (
    <Sheet title={t('iPhone widget')} onClose={onClose}>
      <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s3)' }}>
        {t('A widget with your streak, calories and steps, on the Home Screen or the Lock Screen. It is drawn by Scriptable, a free app.')}
      </p>
      <ol className="bx-small" style={{ paddingInlineStart: '1.2em', marginBottom: 'var(--bx-s4)' }}>
        <li>{t('Install Scriptable from the App Store.')}</li>
        <li>{t('Create a widget key, then copy the script.')}</li>
        <li>{t('In Scriptable, tap +, paste, and name the script “Biscotos”. Then add a Scriptable widget to your Home Screen or Lock Screen and choose it.')}</li>
      </ol>

      {err && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>{err.status === 409 ? t('Five tokens at most: revoke one first.') : t('Could not save. Try again.')}</div>}

      {fresh
        ? <div className="bx-card bx-flash" style={{ borderColor: 'var(--bx-volt-text)' }} role="status">
          <p className="bx-small" style={{ marginBottom: 'var(--bx-s3)' }}>{t('Copy the script now: it holds your key, which will not be shown again.')}</p>
          <button type="button" className="bx-btn bx-btn-primary bx-btn-block bx-tap" onClick={copyScript}>{copied ? t('Copied') : t('Copy the script')}</button>
        </div>
        : live.length < 5 && <button type="button" className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={busy} onClick={create}>{t('Create a widget key')}</button>}

      <section className="bx-card" aria-label={t('Widget keys')} style={{ marginTop: 'var(--bx-s4)' }}>
        <div className="bx-card-hd"><h3 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Widget keys')}</h3></div>
        {hooks === null ? <div className="bx-skeleton" style={{ height: 40 }} />
          : !hooks.length ? <p className="bx-small bx-dim">{t('No token yet.')}</p>
          : <ul className="bx-list">{hooks.map(h => <li key={h.id} className="bx-item">
              <div className="bx-item-main">
                <div className="bx-item-title" style={h.revokedAt ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{h.label}</div>
                <div className="bx-item-sub">{h.revokedAt ? t('Revoked {0}', fmtWhen(h.revokedAt)) : t('Last used: {0}', fmtWhen(h.lastUsedAt))}</div>
              </div>
              {!h.revokedAt && <button className="bx-chip bx-tap" style={{ color: 'var(--bx-danger)' }} disabled={busy} onClick={() => revoke(h.id)}>{t('Revoke')}</button>}
            </li>)}</ul>}
      </section>
      <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)' }}>{t('iOS refreshes a widget every 15 to 30 minutes or so, when it decides to.')}</p>
    </Sheet>
  )
}

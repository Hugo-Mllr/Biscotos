// Inside the Home weight card: weights Apple Health sent for days the curve has none, each one
// added only when the person taps Add (docs/QUESTIONS.md Q7, lib/health-weight.js). Signed in
// only — the samples live on the server. Nothing shows, and nothing is asked, without any.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO, fmtNum, fmtDate } from '../lib/format.js'
import { shiftDay } from '../lib/nutrition.js'
import { loadHealthSamples } from '../lib/nutrition-api.js'
import { weightSuggestions, addWeighIn, suggestionKey, loadDismissed, saveDismissed } from '../lib/health-weight.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

export default function HealthWeightPrompt() {
  const user = useStore(s => s.user)
  const bodyweight = useStore(s => s.S.bodyweight)
  const unit = useStore(s => s.S.unit)
  const update = useStore(s => s.update)
  const [samples, setSamples] = useState(null)
  const [dismissed, setDismissed] = useState(loadDismissed)

  useEffect(() => {
    if (!user) return
    let alive = true
    const today = todayISO()
    loadHealthSamples(shiftDay(today, -13), today).then(s => { if (alive) setSamples(s) }).catch(() => { /* offline: ask next time */ })
    return () => { alive = false }
  }, [user])

  const list = user ? weightSuggestions(samples, bodyweight, unit, dismissed) : []
  if (!list.length) return null

  const add = s => update(st => { addWeighIn(st, s.d, s.w) })
  const dismiss = s => { const next = [...dismissed, suggestionKey(s)]; setDismissed(next); saveDismissed(next) }

  return (
    <div className="health-weight" role="group" aria-label={t('From Apple Health')} style={{ marginTop: 10 }}>
      {list.map(s => (
        <div key={s.d} className="row between" style={{ gap: 8, padding: '6px 0' }}>
          <div className="row" style={{ gap: 8, minWidth: 0, flex: 1 }}>
            <Icon name="heart" style={{ color: 'var(--pink)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div className="small muted">{t('From Apple Health')}</div>
              <div className="small"><strong>{fmtNum(s.w)} {unit}</strong> <span className="muted">· {fmtDate(s.d)}</span></div>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <Button size="sm" variant="ghost" onClick={() => dismiss(s)}>{t('Dismiss')}</Button>
            <Button size="sm" icon="plus" onClick={() => add(s)}>{t('Add')}</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

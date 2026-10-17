// Biscotos: today's form on Home — a score out of 100 from the per-muscle fatigue model, its
// state, and the muscles to go easy on. Hidden until there is a recent workout to read.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { fatigueOf, FATIGUE_SCAN_MS, FATIGUE_STATES } from '../lib/recovery.js'
import { readinessOf, profileBodyweightKg } from '../lib/recovery-view.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'

const STATE_LABEL = {
  [FATIGUE_STATES.READY]: () => t('Ready'),
  [FATIGUE_STATES.RECOVERING]: () => t('Recovering'),
  [FATIGUE_STATES.FATIGUED]: () => t('Fatigued'),
}

export default function ReadinessToday() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const form = useMemo(() => {
    const now = Date.now()
    const workouts = S.workouts || []
    const recent = workouts.some(w => (Number(w.start) || Date.parse(w.d + 'T00:00:00') || 0) > now - FATIGUE_SCAN_MS)
    if (!recent) return null
    return readinessOf(fatigueOf(workouts, now, { bodyweightKg: profileBodyweightKg(S), unit: S.unit }))
  }, [S.workouts, S.bodyweight, S.unit])
  if (!form) return null

  return (
    <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/stats'))}>
      <div className="row between">
        <div className="row" style={{ gap: 9 }}>
          <span className="lrow-i" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }}><Icon name="flame" /></span>
          <div>
            <div className="lbl2">{t("Today's form")}</div>
            <div className="ttl">{fmtNum(form.score)} / 100 · {STATE_LABEL[form.state]()}</div>
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
      {form.tired.length > 0 && <p className="bx-small" style={{ marginTop: 8 }}>
        {t('Go easy on {0}', form.tired.map(m => t(MUSCLE_NAME[m])).join(', '))}
      </p>}
    </div>
  )
}

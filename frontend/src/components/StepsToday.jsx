// Biscotos: the day's steps against the goal, as a small ring on Home. The steps come from the Apple
// Health Shortcut (docs/APPLE_HEALTH.md), so the card only exists once some have been received in the
// last week; it shows today's, or the latest day's when today's have not arrived yet (the Shortcut
// runs once a day). The goal is set in Body & goals (10,000 unless changed).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { shiftDay, progress } from '../lib/nutrition.js'
import { stepGoalOf } from '../lib/body.js'
import * as napi from '../lib/nutrition-api.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { Ring } from './bx/index.jsx'
import Icon from './Icon.jsx'

/** The newest steps row: { d, value } or null. */
export const latestSteps = samples => (samples || []).filter(s => s?.type === 'steps' && Number(s.value) >= 0)
  .reduce((best, s) => (!best || s.d > best.d ? { d: s.d, value: Math.round(Number(s.value)) } : best), null)

export default function StepsToday() {
  const nav = useNavigate()
  const [state, setState] = useState(null)
  useEffect(() => {
    let live = true
    const d = todayISO()
    Promise.all([napi.loadHealthSamples(shiftDay(d, -6), d), napi.loadNutrition(d, d)])
      .then(([samples, nutrition]) => { if (live) setState({ steps: latestSteps(samples), goal: stepGoalOf(nutrition?.profile) }) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  if (!state?.steps) return null

  const { steps, goal } = state
  const p = progress(steps.value, goal)
  const done = steps.value >= goal
  return (
    <div className="card tappable steps-card" style={{ cursor: 'pointer' }} {...tappable(() => nav('/body'))}>
      <div className="row between">
        <div className="row" style={{ gap: 12 }}>
          <Ring fraction={p.fraction ?? 0} size={64} stroke={7} label={t('{0} of {1} steps', steps.value, goal)}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{Math.min(999, Math.round((p.fraction ?? 0) * 100))}%</div>
          </Ring>
          <div>
            <div className="lbl2">{steps.d === todayISO() ? t('Steps today') : t('Steps · {0}', fmtDate(steps.d, true))}</div>
            <div className="ttl">{fmtNum(steps.value)} / {fmtNum(goal)}</div>
            <div className="muted small">{done ? t('Goal reached!') : t('To go: {0}', fmtNum(goal - steps.value))}</div>
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
  )
}

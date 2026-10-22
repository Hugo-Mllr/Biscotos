// Biscotos: today's food log at a glance on Home — calories against the goal and the three
// macros — and the way into the Nutrition screen. Signed in only (the log lives on the server).
// It reads the day once per visit to Home; a failed read keeps the plain link, never an error.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { lastBW, workoutDay } from '../lib/history.js'
import { goalsFor, healthOf } from '../lib/body.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { MACROS, totalsOf, progress, toKg } from '../lib/nutrition.js'
import * as napi from '../lib/nutrition-api.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { Ring, Bar } from './bx/index.jsx'
import GoalTodaySync from './GoalTodaySync.jsx'
import Icon from './Icon.jsx'

const MACRO = {
  protein: { label: () => t('Protein'), color: 'var(--bx-protein)' },
  carbs: { label: () => t('Carbs'), color: 'var(--bx-carbs)' },
  fat: { label: () => t('Fat'), color: 'var(--bx-fat)' },
}

export default function NutritionToday() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [data, setData] = useState(null)
  const [health, setHealth] = useState({})
  useEffect(() => {
    let live = true
    const d = todayISO()
    napi.loadNutrition(d, d).then(r => { if (live) setData(r) }).catch(() => {})
    napi.loadHealthSamples(d, d).then(s => { if (live) setHealth(healthOf(s)) }).catch(() => {})
    return () => { live = false }
  }, [])
  const totals = totalsOf((data?.log || []).filter(e => e.d === todayISO()))
  // The same goal as the Nutrition screen: calculated from the day when a goal is chosen, else the typed one.
  const last = lastBW(S)
  const { goals, auto } = goalsFor({ profile: data?.profile || {}, goals: data?.goals, weightKg: last ? toKg(last.w, S.unit) : null, unit: S.unit,
    workouts: S.workouts.filter(w => workoutDay(w) === todayISO()), health, year: new Date().getFullYear() })
  const kcal = progress(totals.kcal, goals.kcal)

  return (
    <div className="card tappable nt-card" style={{ cursor: 'pointer' }} {...tappable(() => nav('/nutrition'))}>
      <div className="row between" style={{ marginBottom: data ? 12 : 0 }}>
        <div className="row" style={{ gap: 9 }}>
          <span className="lrow-i" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }}><Icon name="flame" /></span>
          <div>
            <div className="lbl2">{t('Food log, macros, goals')}</div>
            <div className="ttl">{t('Nutrition')}</div>
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
      {data && <GoalTodaySync profile={data.profile} auto={auto} goals={goals} day={todayISO()} />}
      {data && <div className="nt-body">
        <Ring fraction={kcal.fraction ?? 0} size={92} stroke={9} label={t('{0} of {1} kcal', totals.kcal, goals.kcal || '–')}>
          <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtNum(totals.kcal)}</div>
            <div className="dim" style={{ fontSize: 11 }}>{goals.kcal ? '/ ' + fmtNum(goals.kcal) : 'kcal'}</div>
          </div>
        </Ring>
        <div className="nt-macros">
          {MACROS.map(m => {
            const p = progress(totals[m], goals[m])
            return <div key={m}>
              <div className="row between small" style={{ marginBottom: 3 }}>
                <span style={{ color: MACRO[m].color, fontWeight: 600 }}>{MACRO[m].label()}</span>
                <span className="muted">{fmtNum(totals[m])}{goals[m] ? ' / ' + fmtNum(goals[m]) : ''} g</span>
              </div>
              <Bar fraction={p.fraction ?? (totals[m] > 0 ? 1 : 0)} color={MACRO[m].color} label={MACRO[m].label()} />
            </div>
          })}
        </div>
      </div>}
    </div>
  )
}

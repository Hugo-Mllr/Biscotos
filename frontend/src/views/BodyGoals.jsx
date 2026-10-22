// Biscotos: "Body & goals" — who you are (sex, birth year, height, weight, daily life), what you
// want (lose, maintain, gain, recomp) and what that makes in calories and macros today
// (lib/body.js). The profile is saved on the server with the nutrition data (api/nutrition); the
// Nutrition ring follows it unless the goal is "Manual".
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { lastBW, workoutDay } from '../lib/history.js'
import { toKg, bmiBand, parseAmount, shiftDay, totalsOf, MACROS } from '../lib/nutrition.js'
import { PACE_KG_WEEK, STEP_GOAL_DEFAULT, stepGoalOf, planFor, dayCost, observedTdee, calibrationOf, healthOf } from '../lib/body.js'
import * as napi from '../lib/nutrition-api.js'
import { bwSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import WidgetSheet from '../components/bx/WidgetSheet.jsx'

const WINDOW_DAYS = 28
const SEX = [['m', () => t('Male')], ['f', () => t('Female')]]
const ACTIVITY = [['low', () => t('Mostly sitting')], ['mid', () => t('On my feet')], ['high', () => t('Physical job')]]
const GOALS = [['manual', () => t('Manual')], ['cut', () => t('Lose fat')], ['maintain', () => t('Maintain')], ['bulk', () => t('Gain muscle')], ['recomp', () => t('Recomposition')]]
const PACES = [['gentle', () => t('Gentle')], ['steady', () => t('Steady')], ['fast', () => t('Fast')]]
const MACRO_LABEL = { protein: () => t('Protein'), carbs: () => t('Carbs'), fat: () => t('Fat') }
const SOURCE = {
  estimate: () => t('Estimated from your profile and your workouts.'),
  'health-steps': () => t('Adjusted with the steps from Apple Health.'),
  'health-active': () => t('Adjusted with the active energy from Apple Health.'),
}

const Chips = ({ items, value, onPick, label }) => <div className="bx-chips" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
  {items.map(([k, text]) => <button type="button" key={k} className="bx-chip bx-tap" aria-pressed={value === k} onClick={() => onPick(value === k && k !== 'manual' ? null : k)}>{text()}</button>)}
</div>

function Num({ label, suffix, value, onSave, min, max, decimals = 0, placeholder }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => { setText(value ?? '') }, [value])
  const commit = () => {
    const v = String(text).trim() === '' ? null : parseAmount(text)
    if (v !== null && (v == null || v < min || v > max)) { setText(value ?? ''); return }
    const r = v === null ? null : Math.round(v * 10 ** decimals) / 10 ** decimals
    if (r !== (value ?? null)) onSave(r)
  }
  return <label className="bx-field"><span className="bx-label">{label}{suffix ? ` (${suffix})` : ''}</span>
    <input className="bx-input" inputMode="decimal" value={text} placeholder={placeholder} onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  </label>
}

export default function BodyGoals() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const day = todayISO()
  const year = Number(day.slice(0, 4))
  const [data, setData] = useState(null)
  const [health, setHealth] = useState({})
  const [p, setP] = useState({})
  const [err, setErr] = useState(null)
  const [widget, setWidget] = useState(false)

  useEffect(() => {
    if (!user) return
    napi.loadNutrition(shiftDay(day, 1 - WINDOW_DAYS), day).then(d => { setData(d); setP(d.profile || {}) }).catch(setErr)
    napi.loadHealthSamples(day, day).then(s => setHealth(healthOf(s))).catch(() => {})
  }, [user, day])

  const save = async patch => {
    setP(o => ({ ...o, ...patch })); setErr(null)
    try { setP((await napi.saveSettings({ profile: patch })).profile) } catch (e) { setErr(e) }
  }

  const last = lastBW(S)
  const weightKg = last ? toKg(last.w, S.unit) : null
  const workoutsOn = d => S.workouts.filter(w => workoutDay(w) === d)
  const plan = useMemo(() => planFor({ profile: p, weightKg, unit: S.unit, workouts: workoutsOn(day), health, year }),
    [p, weightKg, S.unit, S.workouts, health, day, year])

  // What the last weeks show: the weight trend against the average intake.
  const seen = useMemo(() => {
    if (!data || !(plan.bmr > 0)) return null
    const byDay = new Map()
    for (const e of data.log || []) if (e.d < day) byDay.set(e.d, [...(byDay.get(e.d) || []), e])
    const intake = [...byDay].map(([d, es]) => ({ d, kcal: totalsOf(es).kcal }))
    const from = shiftDay(day, 1 - WINDOW_DAYS)
    const weighIns = S.bodyweight.filter(b => b.d >= from && b.d <= day).map(b => ({ d: b.d, kg: toKg(b.w, S.unit) }))
    const o = observedTdee({ weighIns, intake })
    if (!o) return null
    const logged = intake.filter(x => x.kcal >= 800)
    const estimated = Math.round(logged.reduce((n, x) => n + dayCost({ bmr: plan.bmr, activity: p.activity, workouts: workoutsOn(x.d), weightKg, unit: S.unit }).total, 0) / logged.length)
    return { ...o, estimated, shift: calibrationOf(o.observed, estimated), intakeAvg: Math.round(logged.reduce((n, x) => n + x.kcal, 0) / logged.length) }
  }, [data, plan.bmr, p.activity, S.bodyweight, S.workouts, S.unit, weightKg, day])

  // Turned on, the shift follows the latest numbers.
  useEffect(() => { if (p.calibrate && seen && seen.shift !== (p.calibration ?? 0)) save({ calibration: seen.shift }) }, [seen?.shift, p.calibrate]) // eslint-disable-line react-hooks/exhaustive-deps

  const Header = <header className="bx-head">
    <div><button className="bx-iconbtn bx-tap" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div>
    <div style={{ flex: 1 }}><h1 className="bx-title">{t('Body & goals')}</h1></div>
  </header>

  if (!user) {
    return <div className="bx bx-page"><div className="bx-wrap">{Header}
      <div className="bx-card bx-empty">
        <p style={{ marginBottom: 'var(--bx-s4)' }}>{t('Nutrition is saved on your server, so it needs an account. Sign in to log what you eat.')}</p>
        <button className="bx-btn bx-btn-primary bx-tap" onClick={() => nav('/settings')}>{t('Sign in')}</button>
      </div>
    </div></div>
  }

  const mode = p.goalMode || 'manual'
  const auto = mode !== 'manual'
  const paceKg = (PACE_KG_WEEK[mode] || {})
  const band = plan.bmi != null ? { under: t('Below the usual BMI range.'), normal: t('Within the usual BMI range.'), over: t('Above the usual BMI range.'), obese: t('Well above the usual BMI range.') }[bmiBand(plan.bmi)] : null

  return <div className="bx bx-page"><div className="bx-wrap">
    {Header}
    {err && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>{t('Could not save. Try again.')}</div>}

    <section className="bx-card" aria-label={t('About you')}>
      <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('About you')}</h2></div>
      <span className="bx-label">{t('Sex')}</span>
      <Chips items={SEX} value={p.sex} label={t('Sex')} onPick={v => save({ sex: v })} />
      <div className="bx-row2" style={{ marginTop: 'var(--bx-s3)' }}>
        <Num label={t('Birth year')} value={p.birthYear} min={year - 110} max={year - 10} onSave={v => save({ birthYear: v })} placeholder="1999" />
        <Num label={t('Height')} suffix="cm" value={p.heightCm} min={50} max={260} decimals={1} onSave={v => save({ heightCm: v })} />
      </div>
      <div className="bx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--bx-s3)', marginBottom: 'var(--bx-s3)' }}>
        <div><div className="bx-label">{t('Body weight')}</div>
          <div className="bx-score bx-score-sm">{last ? fmtNum(last.w) : '–'}{last && <span className="bx-unit">{S.unit}</span>}</div></div>
        <button type="button" className="bx-chip bx-tap" onClick={() => bwSheet()}>{t('Log my weight')}</button>
      </div>
      <span className="bx-label">{t('Daily life')}</span>
      <Chips items={ACTIVITY} value={p.activity} label={t('Daily life')} onPick={v => save({ activity: v })} />
      <p className="bx-small bx-dim" style={{ margin: 'var(--bx-s2) 0 var(--bx-s3)' }}>{t('Your workouts are counted on top of this.')}</p>
      <Num label={t('Body fat (optional)')} suffix="%" value={p.bodyFatPct} min={3} max={60} decimals={1} onSave={v => save({ bodyFatPct: v })} />
    </section>

    <section className="bx-card" aria-label={t('My goal')}>
      <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('My goal')}</h2></div>
      <Chips items={GOALS} value={mode} label={t('My goal')} onPick={v => save({ goalMode: v || 'manual' })} />
      {(mode === 'cut' || mode === 'bulk') && <>
        <span className="bx-label" style={{ display: 'block', marginTop: 'var(--bx-s3)' }}>{t('Pace')}</span>
        <Chips items={PACES} value={p.pace || 'steady'} label={t('Pace')} onPick={v => save({ pace: v || 'steady' })} />
        <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s2)' }}>{t('{0} kg a week', fmtNum(paceKg[p.pace || 'steady']))}</p>
      </>}
      {!auto && <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)' }}>{t('You set your daily goals yourself in Nutrition.')}</p>}
    </section>

    <section className="bx-card" aria-label={t('Daily steps goal')}>
      <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Daily steps goal')}</h2></div>
      <Num label={t('Steps')} value={p.stepGoal ?? null} min={1000} max={100000} placeholder={String(STEP_GOAL_DEFAULT)} onSave={v => save({ stepGoal: v })} />
      <p className="bx-small bx-dim">{t('{0} a day by default. The steps come from the Apple Health Shortcut.', fmtNum(stepGoalOf({})))}</p>
    </section>

    <section className="bx-card" aria-label={t('Your numbers')}>
      <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Your numbers')}</h2></div>
      {plan.missing.length > 0 && <p className="bx-small bx-dim">{t('Fill in your height, birth year, sex and weight to calculate your goal.')}</p>}
      <div className="bx-row4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center' }}>
        <div><div className="bx-label">{t('BMI')}</div><div className="bx-score bx-score-sm">{plan.bmi != null ? fmtNum(plan.bmi) : '–'}</div></div>
        <div><div className="bx-label">{t('Resting metabolism')}</div><div className="bx-score bx-score-sm">{plan.bmr ? fmtNum(plan.bmr) : '–'}<span className="bx-unit">kcal</span></div></div>
        <div><div className="bx-label">{t('Energy needed today')}</div><div className="bx-score bx-score-sm">{plan.tdee ? fmtNum(plan.tdee) : '–'}<span className="bx-unit">kcal</span></div></div>
      </div>
      {band && <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)' }}>{band} {t('BMI ignores muscle mass: read it as a rough indicator only.')}</p>}
      {plan.cost && <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s2)' }}>{SOURCE[plan.cost.source]()}</p>}

      {auto && plan.target && <div style={{ marginTop: 'var(--bx-s4)' }}>
        <div className="bx-label">{t('Goal for today')}</div>
        <div className="bx-score">{fmtNum(plan.target.kcal)}<span className="bx-unit">kcal</span></div>
        {plan.macros && <p className="bx-small" style={{ marginTop: 'var(--bx-s2)' }}>{MACROS.map(m => `${MACRO_LABEL[m]()} ${fmtNum(plan.macros[m])} g`).join(' · ')}</p>}
        <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s2)' }}>{t('It follows what you burn each day, and replaces the goals set by hand while a goal is chosen.')}</p>
      </div>}
      <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)' }}>{t('An estimate, not medical advice.')}</p>
    </section>

    <section className="bx-card" aria-label={t('iPhone widget')}>
      <button type="button" className="bx-btn bx-btn-block bx-tap" onClick={() => setWidget(true)}>{t('iPhone widget')} <Icon name="chevronRight" /></button>
    </section>
    {widget && <WidgetSheet onClose={() => setWidget(false)} />}

    {seen && <section className="bx-card" aria-label={t('Your results')}>
      <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Your results')}</h2></div>
      <p className="bx-small">{t('Over the last weeks you ate {0} kcal a day and your weight moved {1} kg a week: your body seems to burn about {2} kcal a day, where the estimate says {3}.',
        fmtNum(seen.intakeAvg), (seen.kgPerWeek > 0 ? '+' : '') + fmtNum(seen.kgPerWeek), fmtNum(seen.observed), fmtNum(seen.estimated))}</p>
      <label className="bx-toggle" style={{ marginTop: 'var(--bx-s3)' }}>
        <span><b>{t('Adjust my estimate by {0} kcal', (seen.shift > 0 ? '+' : '') + seen.shift)}</b></span>
        <input type="checkbox" role="switch" checked={!!p.calibrate} onChange={e => save({ calibrate: e.target.checked, calibration: seen.shift })} />
      </label>
    </section>}
  </div></div>
}

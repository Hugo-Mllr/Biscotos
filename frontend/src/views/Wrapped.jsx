// Biscotos Wrapped: the year at the gym in a few big numbers (lib/wrapped.js), from Stats. Computed
// on the device from the profile's own workouts; "Share" hands a short text to the phone's share
// sheet (or copies it), never anything else.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn, getLang } from '../lib/i18n.js'
import { fmtNum, exerciseNameText } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { wrappedOf, wrappedYears } from '../lib/wrapped.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const monthName = m => new Date(2026, m, 15).toLocaleDateString(getLang(), { month: 'long' })
const weekdayName = d => new Date(2026, 1, 1 + d).toLocaleDateString(getLang(), { weekday: 'long' })   // Feb 1 2026 is a Sunday
const TIME = { morning: () => t('Morning person'), afternoon: () => t('Afternoon lifter'), evening: () => t('Evening lifter') }

/** The text "Share" sends: the headline numbers, one per line. */
export function wrappedText(y, unit) {
  const lines = [`${t('Your year')} ${y.year}`,
    `${t('Workouts')}: ${fmtNum(y.sessions)}`,
    `${t('Hours')}: ${fmtNum(Math.round(y.minutes / 60))}`,
    `${t('Lifted in total')}: ${fmtNum(y.volume)} ${unit}`,
    `${t('Personal records')}: ${fmtNum(y.records)}`]
  if (y.topExercises[0]) lines.push(`${t('Your favourites')}: ${exerciseNameText(exOr(y.topExercises[0].id))}`)
  return lines.join('\n') + '\n🍪 Biscotos'
}

export default function Wrapped() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const years = useMemo(() => wrappedYears(S), [S.workouts])
  const [year, setYear] = useState(() => years[0] ?? new Date().getFullYear())
  const y = useMemo(() => wrappedOf(S, year), [S.workouts, year])
  const [shared, setShared] = useState(false)

  const share = async () => {
    const text = wrappedText(y, S.unit)
    try {
      if (navigator.share) await navigator.share({ text })
      else { await navigator.clipboard.writeText(text); setShared(true) }
    } catch { /* closed or refused */ }
  }

  const big = (icon, value, label, sub) => <div className="card wrapped-card">
    <div className="l"><Icon name={icon} /> {label}</div>
    <div className="wrapped-v">{value}</div>
    {sub && <div className="muted small">{sub}</div>}
  </div>

  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Your year')}</h1>
        <div className="sub">{t('Your workouts of the year, in a few numbers.')}</div></div></div>

    {years.length > 1 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {years.map(v => <Button key={v} size="sm" variant={v === year ? 'primary' : 'tinted'} aria-pressed={v === year} onClick={() => setYear(v)}>{v}</Button>)}
    </div>}

    {!y ? <div className="card muted">{t('No workout this year yet.')}</div> : <>
      {big('dumbbell', fmtNum(y.sessions), t('Workouts'), null)}
      {big('clock', fmtNum(Math.round(y.minutes / 60)), t('Hours'), y.sessions ? t('{0} min per workout on average', fmtNum(Math.round(y.minutes / y.sessions))) : null)}
      {big('scale', `${fmtNum(y.volume)} ${S.unit}`, t('Lifted in total'), tn('{0} set', '{0} sets', y.sets))}
      {y.topExercises.length > 0 && <div className="card wrapped-card">
        <div className="l"><Icon name="star" /> {t('Your favourites')}</div>
        <ol className="wrapped-top">{y.topExercises.map(e => <li key={e.id}><span>{exerciseNameText(exOr(e.id))}</span>
          <span className="muted small">{tn('{0} workout', '{0} workouts', e.sessions)}</span></li>)}</ol>
      </div>}
      {big('trophy', fmtNum(y.records), t('Personal records'),
        y.progress ? t('Biggest jump: {0}, +{1} %', exerciseNameText(exOr(y.progress.id)), fmtNum(y.progress.pct)) : null)}
      {big('flame', tn('{0} week', '{0} weeks', y.longestStreak), t('Longest streak'),
        y.busiestMonth != null ? t('Busiest month: {0}', monthName(y.busiestMonth)) : null)}
      {y.favoriteWeekday != null && big('calendar', weekdayName(y.favoriteWeekday), t('Your gym day'), y.timeOfDay ? TIME[y.timeOfDay]() : null)}
      <Button variant="primary" onClick={share}>{shared ? t('Copied') : t('Share my year')}</Button>
    </>}
  </>
}

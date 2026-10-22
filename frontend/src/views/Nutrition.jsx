// Biscotos — Nutrition (docs/ARCHITECTURE.md § 3.1, docs/DESIGN.md).
// The day's score (kcal ring + macro bars), the meals, a 7-day chart and the body card.
// Data lives on the server (api/nutrition); totals are computed by lib/nutrition.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { getLang } from '../lib/i18n-core.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { lastBW, workoutDay } from '../lib/history.js'
import { planFor, healthOf } from '../lib/body.js'
import { MOBILE } from '../lib/mobile.js'
import {
  MEALS, MACROS, macrosOf, totalsOf, byMeal, progress, mealForHour, shiftDay, weekEnding, kcalByDay,
  toKg, bmi, bmiBand, parseAmount, entryFromFood, foodBarcode, lastMeal, repeatEntries, fillSuggestions
} from '../lib/nutrition.js'
import * as napi from '../lib/nutrition-api.js'
import { CountUp, Ring, Bar, Sheet } from '../components/bx/index.jsx'
import FoodScanner, { canScanInBrowser } from '../components/bx/FoodScanner.jsx'
import Icon from '../components/Icon.jsx'
import HealthImportSheet from '../components/bx/HealthImportSheet.jsx'
import MenuImportSheet from '../components/bx/MenuImportSheet.jsx'
import NutritionDataSheet from '../components/bx/NutritionDataSheet.jsx'

const MEAL_LABEL = { breakfast: () => t('Breakfast'), lunch: () => t('Lunch'), dinner: () => t('Dinner'), snack: () => t('Snack') }
const MACRO_LABEL = { protein: () => t('Protein'), carbs: () => t('Carbs'), fat: () => t('Fat') }
// One-letter macro tags follow the language (P/C/F in English, P/G/L in French, E/K/F in German).
const ab = m => MACRO_LABEL[m]().charAt(0).toUpperCase()
const macroLine = (x, unit = '') => MACROS.map(m => `${ab(m)} ${fmtNum(x[m])}${unit}`).join(' · ')
const MACRO_COLOR = { protein: 'var(--bx-protein)', carbs: 'var(--bx-carbs)', fat: 'var(--bx-fat)' }
const offLang = () => (getLang() || 'fr').slice(0, 2).toLowerCase()

function problemText(key) {
  return {
    'not-found': t('This product is not in Open Food Facts yet. Enter it by hand below.'),
    busy: t('Too many lookups right now. Try again in a minute.'),
    off: t('Food search is turned off on this server. You can still enter foods by hand.'),
    'signed-out': t('Your session has expired. Sign in again.'),
    unavailable: t('Open Food Facts cannot be reached. Check your connection, or enter the food by hand.'),
  }[key] || null
}

function dayTitle(day) {
  const today = todayISO()
  if (day === today) return t('Today')
  if (day === shiftDay(today, -1)) return t('Yesterday')
  return new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Nutrition() {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const nav = useNavigate()
  const [day, setDay] = useState(todayISO)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sheet, setSheet] = useState(null)        // 'add' | 'goals' | { edit: entry }
  const [repeating, setRepeating] = useState(false)
  const [pulse, setPulse] = useState(0)           // bumps on every logged food: the ring pops

  const days = useMemo(() => weekEnding(day), [day])
  const reload = useCallback(async () => {
    if (!user) return
    try {
      setError(null)
      setData(await napi.loadNutrition(days[0], days[6]))
    } catch (e) { setError(e) }
  }, [user, days])
  useEffect(() => { reload() }, [reload])
  // What the Apple Health Shortcut sent for the day (steps, active energy): it corrects the day's cost.
  const [health, setHealth] = useState({})
  useEffect(() => {
    if (!user) return
    let live = true
    napi.loadHealthSamples(day, day).then(s => { if (live) setHealth(healthOf(s)) }).catch(() => { if (live) setHealth({}) })
    return () => { live = false }
  }, [user, day])

  if (!user) {
    return <div className="bx bx-page"><div className="bx-wrap">
      <Header day={day} />
      <div className="bx-card bx-empty">
        <p style={{ marginBottom: 'var(--bx-s4)' }}>{t('Nutrition is saved on your server, so it needs an account. Sign in to log what you eat.')}</p>
        <button className="bx-btn bx-btn-primary bx-tap" onClick={() => nav('/settings')}>{t('Sign in')}</button>
      </div>
    </div></div>
  }

  const log = data?.log || []
  const todays = log.filter(e => e.d === day)
  const totals = totalsOf(todays)
  // With a goal chosen in Body & goals, the day's goal is calculated from what the day costs (lib/body.js);
  // "Manual" keeps the goals typed by hand.
  const last = lastBW(S)
  const weightKg = last ? toKg(last.w, S.unit) : null
  const plan = planFor({ profile: data?.profile || {}, weightKg, unit: S.unit, workouts: S.workouts.filter(w => workoutDay(w) === day), health, year: Number(day.slice(0, 4)) })
  const auto = !!plan.target && !!data?.profile?.goalMode && data.profile.goalMode !== 'manual'
  const goals = auto ? { kcal: plan.target.kcal, ...(plan.macros || {}) } : data?.goals || {}
  const kcalP = progress(totals.kcal, goals.kcal)
  const meals = byMeal(log, day)
  const week = kcalByDay(log, days)
  const heightCm = data?.profile?.heightCm ?? null
  const bmiV = bmi(heightCm, weightKg)

  const onLogged = entry => {
    setData(d => ({ ...d, log: [...(d?.log || []), entry] }))
    setPulse(p => p + 1)
    setSheet(null)
  }

  // One tap: one of the person's own foods, at the portion they last ate, to close the protein gap.
  const addSuggestion = async s => {
    setRepeating(true)
    try { onLogged(await napi.addEntry(entryFromFood(s.food, { d: day, meal: mealForHour(new Date().getHours()), grams: s.grams }))) }
    catch (e) { setError(e) } finally { setRepeating(false) }
  }

  // One tap: the same meal as the last time it was logged this week.
  const repeatMeal = async (meal, last) => {
    setRepeating(true)
    try { for (const body of repeatEntries(last.entries, { d: day, meal })) onLogged(await napi.addEntry(body)) }
    catch (e) { setError(e) } finally { setRepeating(false) }
  }

  return (
    <div className="bx bx-page"><div className="bx-wrap">
      <Header day={day} onPrev={() => setDay(d => shiftDay(d, -1))} onNext={day < todayISO() ? () => setDay(d => shiftDay(d, 1)) : null}
        onGoals={() => setSheet('goals')} />

      {error && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>
        {problemText(napi.lookupProblem(error)) || t('Could not load your nutrition. Try again.')}{' '}
        <button className="bx-chip bx-tap" onClick={reload}>{t('Try again')}</button>
      </div>}

      {/* Two columns on a computer: the day (score, meals) and the trends (week, body) */}
      <div className="bx-cols"><div className="bx-col">
      {/* The score of the day */}
      <section className="bx-card" aria-label={t('Today’s total')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bx-s5)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <div key={pulse} className={pulse ? 'bx-pop' : ''}>
            <Ring fraction={kcalP.fraction ?? 0} label={t('{0} of {1} kcal', totals.kcal, goals.kcal || '–')}>
              <div>
                <div className="bx-score"><CountUp value={totals.kcal} /></div>
                <div className="bx-label">{goals.kcal ? t('of {0} kcal', fmtNum(goals.kcal)) : 'kcal'}</div>
              </div>
            </Ring>
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 180 }}>
            {kcalP.fraction != null && <p className="bx-small" style={{ marginBottom: 'var(--bx-s3)', color: kcalP.over ? 'var(--bx-ember)' : 'var(--bx-ink-2)' }}>
              {kcalP.over ? t('{0} kcal over', fmtNum(-kcalP.remaining)) : t('{0} kcal left', fmtNum(kcalP.remaining))}
            </p>}
            {MACROS.map(m => {
              const p = progress(totals[m], goals[m])
              return <div key={m} style={{ marginBottom: 'var(--bx-s3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="bx-label" style={{ color: MACRO_COLOR[m] }}>{MACRO_LABEL[m]()}</span>
                  <span className="bx-small"><CountUp value={totals[m]} decimals={0} /> {goals[m] ? `/ ${goals[m]} g` : 'g'}</span>
                </div>
                <Bar fraction={p.fraction ?? (totals[m] > 0 ? 1 : 0)} color={MACRO_COLOR[m]} label={MACRO_LABEL[m]()} />
              </div>
            })}
            {auto && <button className="bx-chip bx-tap" onClick={() => nav('/body')}>{t('Goal for today')} · {t('{0} kcal burnt', fmtNum(plan.tdee))}</button>}
            {!data?.goals && !auto && <button className="bx-chip bx-tap" onClick={() => setSheet('goals')}>{t('Set daily goals')}</button>}
          </div>
        </div>
      </section>

      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" style={{ margin: 'var(--bx-s4) 0 var(--bx-s2)' }} onClick={() => setSheet('add')}>
        <Icon name="plus" /> {t('Add food')}
      </button>
      <div style={{ textAlign: 'center', marginBottom: 'var(--bx-s4)' }}>
        <button className="bx-chip bx-tap" onClick={() => setSheet('menu')}><Icon name="note" /> {t('Import a menu')}</button>
      </div>

      {/* Close the protein gap with foods already in the log */}
      {data && (fills => fills.length > 0 && <section className="bx-card" aria-label={t('Reach your protein goal')}>
        <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Reach your protein goal')}</h2></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--bx-s2)' }}>
          {fills.map(f => <button key={f.food.id} className="bx-chip bx-tap" disabled={repeating} onClick={() => addSuggestion(f)}>
            {f.food.name} · {fmtNum(f.grams)} g · +{fmtNum(f.macros.protein)} g
          </button>)}
        </div>
      </section>)(fillSuggestions(log, goals, day))}

      {/* Meals */}
      {!data && !error ? <div className="bx-card"><div className="bx-skeleton" style={{ height: 120 }} /></div>
        : MEALS.map((m, i) => (
          <section key={m} className="bx-card" style={{ '--i': i }} aria-label={MEAL_LABEL[m]()}>
            <div className="bx-card-hd">
              <h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{MEAL_LABEL[m]()}</h2>
              <span className="bx-small bx-dim">{fmtNum(totalsOf(meals[m]).kcal)} kcal</span>
            </div>
            {meals[m].length === 0
              ? <>
                <p className="bx-small bx-dim">{t('Nothing logged yet.')}</p>
                {(last => last && <button className="bx-chip bx-tap" disabled={repeating} onClick={() => repeatMeal(m, last)}>
                  <Icon name="repeat" /> {t('Same as {0}', new Date(last.d + 'T00:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' }))}
                </button>)(lastMeal(log, day, m))}
              </>
              : <ul className="bx-list">{meals[m].map(e => {
                  const mm = macrosOf(e)
                  return <li key={e.id} className="bx-item">
                    <button className="bx-item-main bx-tap" style={{ textAlign: 'start' }} onClick={() => setSheet({ edit: e })}>
                      <div className="bx-item-title">{e.name}</div>
                      <div className="bx-item-sub">{fmtNum(e.grams)} g{e.brand ? ' · ' + e.brand : ''} · {macroLine(mm)}</div>
                    </button>
                    <span style={{ fontWeight: 700 }}>{fmtNum(mm.kcal)}</span>
                  </li>
                })}</ul>}
          </section>
        ))}

      </div><div className="bx-col">
      {/* Seven days */}
      {data && <WeekChart week={week} goal={goals.kcal} day={day} onPick={setDay} />}

      {/* Body */}
      <section className="bx-card" aria-label={t('Body')}>
        <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Body')}</h2></div>
        <div className="bx-row4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center' }}>
          <Stat label={t('Height')} value={heightCm ? fmtNum(heightCm) : '–'} unit={heightCm ? 'cm' : ''} />
          <Stat label={t('Body weight')} value={last ? fmtNum(last.w) : '–'} unit={last ? S.unit : ''} />
          <Stat label={t('BMI')} value={bmiV != null ? fmtNum(bmiV) : '–'} />
        </div>
        {bmiV != null && <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)' }}>
          {{ under: t('Below the usual BMI range.'), normal: t('Within the usual BMI range.'), over: t('Above the usual BMI range.'), obese: t('Well above the usual BMI range.') }[bmiBand(bmiV)]}{' '}
          {t('BMI ignores muscle mass: read it as a rough indicator only.')}
        </p>}
        <div style={{ display: 'flex', gap: 'var(--bx-s2)', marginTop: 'var(--bx-s4)', flexWrap: 'wrap' }}>
          {!heightCm && <button className="bx-chip bx-tap" onClick={() => setSheet('goals')}>{t('Add your height')}</button>}
          <button className="bx-chip bx-tap" onClick={() => nav('/body')}>{t('Body & goals')} <Icon name="chevronRight" /></button>
          <button className="bx-chip bx-tap" onClick={() => nav('/measurements')}>{t('Body measurements')} <Icon name="chevronRight" /></button>
          <button className="bx-chip bx-tap" onClick={() => setSheet('health')}><Icon name="heart" /> {t('Apple Health')}</button>
        </div>
      </section>
      </div></div>

      {sheet === 'add' && <AddFoodSheet day={day} foods={data?.foods || []} onClose={() => setSheet(null)} onLogged={onLogged}
        onFoodSaved={f => setData(d => ({ ...d, foods: [...(d?.foods || []), f] }))} />}
      {sheet === 'menu' && <MenuImportSheet day={day} foods={data?.foods || []} log={log} onClose={() => setSheet(null)}
        onLogged={entry => { setData(d => ({ ...d, log: [...(d?.log || []), entry] })); setPulse(p => p + 1) }} />}
      {sheet === 'health' && <HealthImportSheet onClose={() => setSheet(null)} />}
      {sheet === 'data' && <NutritionDataSheet onClose={() => setSheet(null)} onChanged={reload} />}
      {sheet === 'goals' && <GoalsSheet data={data} onClose={() => setSheet(null)}
        onSaved={r => { setData(d => ({ ...d, ...r })); setSheet(null) }} />}
      {sheet?.edit && <EditEntrySheet entry={sheet.edit} onClose={() => setSheet(null)}
        onSaved={e => { setData(d => ({ ...d, log: d.log.map(x => (x.id === e.id ? e : x)) })); setSheet(null) }}
        onDeleted={id => { setData(d => ({ ...d, log: d.log.filter(x => x.id !== id) })); setSheet(null) }} />}

      <div style={{ textAlign: 'center', marginTop: 'var(--bx-s5)' }}>
        <button className="bx-chip bx-tap" onClick={() => setSheet('data')}>{t('My nutrition data')}</button>
      </div>
      <p className="bx-small bx-dim" style={{ marginTop: 'var(--bx-s3)', textAlign: 'center' }}>
        {t('Food data')}: © <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>Open Food Facts</a> (ODbL)
      </p>
    </div></div>
  )
}

function Header({ day, onPrev, onNext, onGoals }) {
  return (
    <header className="bx-head">
      <div>
        <div className="bx-kicker">{dayTitle(day)}</div>
        <h1 className="bx-title">{t('Nutrition')}</h1>
      </div>
      <div className="bx-head-actions">
        {onPrev && <button className="bx-iconbtn bx-tap" onClick={onPrev} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>}
        {onPrev && <button className="bx-iconbtn bx-tap" onClick={onNext || undefined} disabled={!onNext} aria-label={t('Next day')} style={!onNext ? { opacity: 0.35 } : undefined}><Icon name="chevronRight" /></button>}
        {onGoals && <button className="bx-iconbtn bx-tap" onClick={onGoals} aria-label={t('Daily goals')}><Icon name="target" /></button>}
      </div>
    </header>
  )
}

function Stat({ label, value, unit }) {
  return <div>
    <div className="bx-label">{label}</div>
    <div className="bx-score bx-score-sm">{value}{unit && <span className="bx-unit">{unit}</span>}</div>
  </div>
}

function WeekChart({ week, goal, day, onPick }) {
  const max = Math.max(goal || 0, ...week.map(w => w.kcal), 1)
  return (
    <section className="bx-card" aria-label={t('Last 7 days')}>
      <div className="bx-card-hd"><h2 className="bx-label" style={{ color: 'var(--bx-ink)' }}>{t('Last 7 days')}</h2></div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 'var(--bx-s2)', height: 120 }}>
        {goal > 0 && <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: `${(goal / max) * 100}%`, borderTop: '1px dashed var(--bx-line-2)' }} />}
        {week.map((w, i) => {
          const over = goal > 0 && w.kcal > goal
          return <button key={w.d} className="bx-tap" onClick={() => onPick(w.d)}
            aria-label={`${new Date(w.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })}: ${w.kcal} kcal`}
            style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch' }}>
            <span style={{
              display: 'block', height: `${(w.kcal / max) * 100}%`, minHeight: w.kcal ? 4 : 0, borderRadius: 6,
              background: over ? 'var(--bx-ember)' : w.d === day ? 'var(--bx-kcal)' : 'var(--bx-surface-3)',
              transformOrigin: 'bottom', animation: `bx-rise var(--bx-dur-slow) var(--bx-ease-out) ${i * 40}ms both`
            }} />
          </button>
        })}
      </div>
      <div style={{ display: 'flex', gap: 'var(--bx-s2)', marginTop: 6 }}>
        {week.map(w => <span key={w.d} className="bx-label" style={{ flex: 1, textAlign: 'center', color: w.d === day ? 'var(--bx-volt-text)' : undefined }}>
          {new Date(w.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}
        </span>)}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ sheets -- */

function AddFoodSheet({ day, foods, onClose, onLogged, onFoodSaved }) {
  const [mode, setMode] = useState('search')     // search | mine | manual | scan
  const [picked, setPicked] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [code, setCode] = useState('')
  const seq = useRef(0)

  // Debounced search; only the latest answer is kept.
  useEffect(() => {
    if (mode !== 'search' || q.trim().length < 2) { setResults([]); return }
    const my = ++seq.current
    const timer = setTimeout(async () => {
      setBusy(true); setProblem(null)
      try { const r = await napi.searchFoods(q.trim(), offLang()); if (my === seq.current) setResults(r) }
      catch (e) { if (my === seq.current) { setResults([]); setProblem(napi.lookupProblem(e)) } }
      finally { if (my === seq.current) setBusy(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [q, mode])

  const lookUp = useCallback(async raw => {
    const c = foodBarcode(raw)
    if (!c) { setProblem('not-found'); return }
    setBusy(true); setProblem(null)
    try { setPicked(await napi.foodByBarcode(c, offLang())) }
    catch (e) {
      const p = napi.lookupProblem(e)
      setProblem(p)
      if (p === 'not-found') { setCode(c); setMode('manual') }
    } finally { setBusy(false) }
  }, [])

  const startScan = async () => {
    setProblem(null)
    if (MOBILE) {
      try {
        const { scanCode } = await import('../lib/scan.js')
        const hit = await scanCode()
        if (hit) lookUp(hit.value)
      } catch { setMode('scan') }   // no ML Kit: fall back to typing
      return
    }
    setMode('scan')
  }

  if (picked) return <Sheet title={t('Add food')} onClose={onClose}>
    <PortionForm food={picked} day={day} onBack={() => setPicked(null)} onLogged={onLogged} onFoodSaved={onFoodSaved} />
  </Sheet>

  return (
    <Sheet title={t('Add food')} onClose={onClose}>
      <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap', marginBottom: 'var(--bx-s4)' }} role="group" aria-label={t('How to add')}>
        <button className="bx-chip bx-tap" aria-pressed={mode === 'search'} onClick={() => setMode('search')}>{t('Search')}</button>
        <button className="bx-chip bx-tap" aria-pressed={mode === 'scan'} onClick={startScan}>{t('Scan a barcode')}</button>
        <button className="bx-chip bx-tap" aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>{t('My foods')}</button>
        <button className="bx-chip bx-tap" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>{t('By hand')}</button>
      </div>

      {problem && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>{problemText(problem)}</div>}

      {mode === 'search' && <>
        <input className="bx-input" type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} maxLength={80}
          placeholder={t('Oats, skyr, banana…')} aria-label={t('Search')} enterKeyHint="search" />
        <ul className="bx-list" style={{ marginTop: 'var(--bx-s3)' }} aria-busy={busy}>
          {busy && !results.length && <li className="bx-item"><div className="bx-skeleton" style={{ width: '100%' }} /></li>}
          {results.map((f, i) => <FoodRow key={(f.barcode || '') + i} food={f} onPick={() => setPicked(f)} />)}
          {!busy && q.trim().length >= 2 && !results.length && !problem && <li className="bx-empty">{t('No match. Try another word, or enter it by hand.')}</li>}
        </ul>
      </>}

      {mode === 'scan' && <>
        {!MOBILE && canScanInBrowser() && <FoodScanner onFound={lookUp} onCancel={() => setMode('search')} />}
        <form onSubmit={e => { e.preventDefault(); lookUp(code) }} style={{ marginTop: 'var(--bx-s3)' }}>
          <label className="bx-field"><span className="bx-label">{t('Barcode digits')}</span>
            <input className="bx-input" inputMode="numeric" pattern="[0-9 ]*" value={code} onChange={e => setCode(e.target.value)} maxLength={18} />
          </label>
          <button className="bx-btn bx-btn-block bx-tap" disabled={!foodBarcode(code) || busy}>{t('Look up')}</button>
        </form>
      </>}

      {mode === 'mine' && (foods.length
        ? <ul className="bx-list">{foods.map(f => <FoodRow key={f.id} food={f} onPick={() => setPicked(f)} />)}</ul>
        : <p className="bx-empty">{t('Foods you save show up here.')}</p>)}

      {mode === 'manual' && <ManualFood barcode={foodBarcode(code)} onDone={setPicked} />}
    </Sheet>
  )
}

function FoodRow({ food, onPick }) {
  return <li className="bx-item">
    <button className="bx-item-main bx-tap" style={{ textAlign: 'start' }} onClick={onPick}>
      <div className="bx-item-title">{food.name}</div>
      <div className="bx-item-sub">{food.brand ? food.brand + ' · ' : ''}{t('{0} kcal / 100 g', fmtNum(food.per100.kcal))} · {macroLine(food.per100)}</div>
    </button>
    <span aria-hidden="true" style={{ color: 'var(--bx-volt-text)', fontSize: 22, display: 'inline-flex' }}><Icon name="plus" /></span>
  </li>
}

function NumInput({ label, value, onChange, suffix }) {
  return <label className="bx-field"><span className="bx-label">{label}{suffix ? ` (${suffix})` : ''}</span>
    <input className="bx-input" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} />
  </label>
}

function ManualFood({ barcode, onDone }) {
  const [f, setF] = useState({ name: '', brand: '', kcal: '', protein: '', carbs: '', fat: '' })
  const set = k => v => setF(x => ({ ...x, [k]: v }))
  const nums = ['kcal', 'protein', 'carbs', 'fat'].map(k => parseAmount(f[k]))
  const ok = f.name.trim() && nums.every(v => v != null) && nums[0] <= 900 && nums[1] + nums[2] + nums[3] <= 105
  return <form onSubmit={e => {
    e.preventDefault(); if (!ok) return
    onDone({ name: f.name.trim(), brand: f.brand.trim() || undefined, barcode: barcode || undefined, source: 'manual',
      per100: { kcal: nums[0], protein: nums[1], carbs: nums[2], fat: nums[3] } })
  }}>
    <label className="bx-field"><span className="bx-label">{t('Name')}</span>
      <input className="bx-input" value={f.name} onChange={e => set('name')(e.target.value)} maxLength={120} autoFocus /></label>
    <label className="bx-field"><span className="bx-label">{t('Brand')} ({t('optional')})</span>
      <input className="bx-input" value={f.brand} onChange={e => set('brand')(e.target.value)} maxLength={80} /></label>
    <p className="bx-label" style={{ margin: 'var(--bx-s3) 0 var(--bx-s2)' }}>{t('Per 100 g, as on the label')}</p>
    <div className="bx-row2">
      <NumInput label="kcal" value={f.kcal} onChange={set('kcal')} />
      <NumInput label={t('Protein')} suffix="g" value={f.protein} onChange={set('protein')} />
      <NumInput label={t('Carbs')} suffix="g" value={f.carbs} onChange={set('carbs')} />
      <NumInput label={t('Fat')} suffix="g" value={f.fat} onChange={set('fat')} />
    </div>
    <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={!ok}>{t('Next')}</button>
  </form>
}

function PortionForm({ food, day, onBack, onLogged, onFoodSaved }) {
  const [grams, setGrams] = useState(String(food.serving?.grams || 100))
  const [meal, setMeal] = useState(() => mealForHour(new Date().getHours()))
  const [keep, setKeep] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const g = parseAmount(grams)
  const valid = g != null && g > 0 && g <= 5000
  const preview = macrosOf({ grams: valid ? g : 0, per100: food.per100 })
  const presets = [...new Set([food.serving?.grams, 50, 100, 150, 200].filter(Boolean))]

  const submit = async e => {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true); setErr(null)
    try {
      if (keep && !food.id) {
        const { name, brand, barcode, source, per100, serving } = food
        onFoodSaved(await napi.addFood({ name, brand, barcode, source, per100, serving }))
      }
      onLogged(await napi.addEntry(entryFromFood(food, { d: day, meal, grams: g })))
    } catch (x) { setErr(x); setSaving(false) }
  }

  return <form onSubmit={submit}>
    <div className="bx-item" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="bx-item-main">
        <div className="bx-item-title">{food.name}</div>
        <div className="bx-item-sub">{food.brand ? food.brand + ' · ' : ''}{t('{0} kcal / 100 g', fmtNum(food.per100.kcal))}</div>
      </div>
      <button type="button" className="bx-chip bx-tap" onClick={onBack}>{t('Change')}</button>
    </div>

    <div style={{ textAlign: 'center', margin: 'var(--bx-s4) 0' }}>
      <span className="bx-score"><CountUp value={preview.kcal} /></span><span className="bx-unit">kcal</span>
      <div className="bx-small bx-dim">{macroLine(preview, ' g')}</div>
    </div>

    <NumInput label={t('Amount')} suffix="g" value={grams} onChange={setGrams} />
    <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap', marginBottom: 'var(--bx-s4)' }}>
      {presets.map(p => <button type="button" key={p} className="bx-chip bx-tap" aria-pressed={g === p} onClick={() => setGrams(String(p))}>
        {p === food.serving?.grams && !food.serving.label.includes(String(p)) ? `${food.serving.label} · ${p} g` : p === food.serving?.grams ? food.serving.label : `${p} g`}
      </button>)}
    </div>

    <p className="bx-label" style={{ marginBottom: 'var(--bx-s2)' }}>{t('Meal')}</p>
    <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap', marginBottom: 'var(--bx-s4)' }}>
      {MEALS.map(m => <button type="button" key={m} className="bx-chip bx-tap" aria-pressed={meal === m} onClick={() => setMeal(m)}>{MEAL_LABEL[m]()}</button>)}
    </div>

    {!food.id && <label style={{ display: 'flex', gap: 'var(--bx-s2)', alignItems: 'center', marginBottom: 'var(--bx-s4)' }}>
      <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> <span className="bx-small">{t('Save to my foods')}</span>
    </label>}

    {err && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>{t('Could not save. Try again.')}</div>}
    <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={!valid || saving}>{t('Add to {0}', MEAL_LABEL[meal]())}</button>
  </form>
}

function EditEntrySheet({ entry, onClose, onSaved, onDeleted }) {
  const [grams, setGrams] = useState(String(entry.grams))
  const [meal, setMeal] = useState(entry.meal)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const g = parseAmount(grams)
  const valid = g != null && g > 0 && g <= 5000
  const run = async fn => { setBusy(true); setErr(null); try { await fn() } catch (x) { setErr(x); setBusy(false) } }
  return <Sheet title={entry.name} onClose={onClose}>
    <div style={{ textAlign: 'center', marginBottom: 'var(--bx-s4)' }}>
      <span className="bx-score"><CountUp value={macrosOf({ grams: valid ? g : 0, per100: entry.per100 }).kcal} /></span><span className="bx-unit">kcal</span>
    </div>
    <NumInput label={t('Amount')} suffix="g" value={grams} onChange={setGrams} />
    <div style={{ display: 'flex', gap: 'var(--bx-s2)', flexWrap: 'wrap', marginBottom: 'var(--bx-s4)' }}>
      {MEALS.map(m => <button type="button" key={m} className="bx-chip bx-tap" aria-pressed={meal === m} onClick={() => setMeal(m)}>{MEAL_LABEL[m]()}</button>)}
    </div>
    {err && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>{t('Could not save. Try again.')}</div>}
    <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={!valid || busy}
      onClick={() => run(async () => onSaved(await napi.updateEntry(entry.id, { grams: g, meal })))}>{t('Save')}</button>
    <button className="bx-btn bx-btn-ghost bx-btn-block bx-tap" style={{ marginTop: 'var(--bx-s2)', color: 'var(--bx-danger)' }} disabled={busy}
      onClick={() => run(async () => { await napi.deleteEntry(entry.id); onDeleted(entry.id) })}>{t('Delete')}</button>
  </Sheet>
}

function GoalsSheet({ data, onClose, onSaved }) {
  const g0 = data?.goals || {}
  const [v, setV] = useState({
    kcal: g0.kcal ?? '', protein: g0.protein ?? '', carbs: g0.carbs ?? '', fat: g0.fat ?? '',
    height: data?.profile?.heightCm ?? ''
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = k => x => setV(o => ({ ...o, [k]: x }))
  const parsed = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x).trim() === '' ? null : parseAmount(x)]))
  const bad = Object.entries(v).some(([k, x]) => String(x).trim() !== '' && parsed[k] == null)
    || (parsed.height != null && (parsed.height < 50 || parsed.height > 260))
  const save = async e => {
    e.preventDefault()
    if (bad || busy) return
    setBusy(true); setErr(null)
    const goals = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].filter(k => parsed[k] != null).map(k => [k, Math.round(parsed[k])]))
    try { onSaved(await napi.saveSettings({ goals: Object.keys(goals).length ? goals : null, profile: { heightCm: parsed.height } })) }
    catch (x) { setErr(x); setBusy(false) }
  }
  return <Sheet title={t('Daily goals')} onClose={onClose}>
    <form onSubmit={save}>
      <NumInput label={t('Energy')} suffix="kcal" value={v.kcal} onChange={set('kcal')} />
      <div className="bx-row2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <NumInput label={t('Protein')} suffix="g" value={v.protein} onChange={set('protein')} />
        <NumInput label={t('Carbs')} suffix="g" value={v.carbs} onChange={set('carbs')} />
        <NumInput label={t('Fat')} suffix="g" value={v.fat} onChange={set('fat')} />
      </div>
      <NumInput label={t('Height')} suffix="cm" value={v.height} onChange={set('height')} />
      <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>{t('Leave a field empty for no goal.')}</p>
      {err && <div className="bx-alert" role="alert" style={{ marginBottom: 'var(--bx-s3)' }}>{t('Could not save. Try again.')}</div>}
      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={bad || busy}>{t('Save')}</button>
    </form>
  </Sheet>
}

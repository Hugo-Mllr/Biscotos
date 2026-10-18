// Biscotos: paste what you ate, check what was understood, log it. Two steps in one sheet: the text,
// then a preview where every line shows the food it was matched to (the person's own foods first,
// then Open Food Facts for what they have never logged), an amount in grams, and a skip. A line whose
// amount cannot be worked out stays out until one is typed; nothing is logged before "Add".
import { useEffect, useMemo, useRef, useState } from 'react'
import { t, tn } from '../../lib/i18n.js'
import { getLang } from '../../lib/i18n-core.js'
import { fmtNum } from '../../lib/format.js'
import { MEALS, entryFromFood, mealForHour, macrosOf, parseAmount } from '../../lib/nutrition.js'
import { parseMenu, knownFoods, rankFoods, mergeCandidates, amountFor, MENU_MAX_CHARS } from '../../lib/menu-import.js'
import * as napi from '../../lib/nutrition-api.js'
import { Sheet } from './index.jsx'

const SKIP = -1
const MEAL_LABEL = { breakfast: () => t('Breakfast'), lunch: () => t('Lunch'), dinner: () => t('Dinner'), snack: () => t('Snack') }
const offLang = () => (getLang() || 'fr').slice(0, 2).toLowerCase()
const foodLabel = f => f.name + (f.brand ? ' · ' + f.brand : '')

// The preview before any online answer: the person's own foods are ready at once.
function read(text, own) {
  const parsed = parseMenu(text)
  return {
    ignored: parsed.ignored,
    groups: parsed.groups.map((g, gi) => ({
      key: gi, meal: g.meal || mealForHour(new Date().getHours()),
      items: g.items.map((item, ii) => {
        const candidates = rankFoods(item.name, own)
        return { key: `${gi}.${ii}`, item, candidates, choice: candidates.length ? 0 : SKIP, grams: '', typed: false, searching: !candidates.length }
      })
    }))
  }
}

export default function MenuImportSheet({ day, foods, log, onLogged, onClose }) {
  const own = useMemo(() => knownFoods(foods, log), [foods, log])
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const live = useRef(true)
  const asked = useRef(new Set())
  // Set again on every mount: React's development double-mount runs the cleanup once before the real one.
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  // Lines with no food of the person's own are searched online, one at a time and politely.
  useEffect(() => {
    if (!preview) return
    const next = preview.groups.flatMap(g => g.items).find(x => x.searching && !asked.current.has(x.key))
    if (!next) return
    asked.current.add(next.key)
    ;(async () => {
      let online = []
      try { online = (await napi.searchFoods(next.item.name, offLang())).slice(0, 5) } catch { online = [] }
      if (!live.current) return
      setPreview(p => ({
        ...p, groups: p.groups.map(g => ({
          ...g, items: g.items.map(x => {
            if (x.key !== next.key) return x
            const candidates = mergeCandidates(x.candidates, online)
            return { ...x, candidates, choice: candidates.length ? 0 : SKIP, searching: false }
          })
        }))
      }))
    })()
  }, [preview])

  const patch = (key, change) => setPreview(p => ({
    ...p, groups: p.groups.map(g => ({ ...g, items: g.items.map(x => (x.key === key ? { ...x, ...change } : x)) }))
  }))
  const setMeal = (gi, meal) => setPreview(p => ({ ...p, groups: p.groups.map((g, i) => (i === gi ? { ...g, meal } : g)) }))
  const gramsOf = x => {
    if (x.typed) return parseAmount(x.grams)
    const food = x.candidates[x.choice]
    return food ? amountFor(x.item, food) : null
  }

  const ready = (preview?.groups || []).flatMap(g => g.items.map(x => ({ g, x, grams: gramsOf(x) })))
    .filter(({ x, grams }) => x.choice !== SKIP && grams != null && grams > 0 && grams <= 5000)

  const add = async () => {
    setAdding(true); setError(null)
    try {
      for (const { g, x, grams } of ready) onLogged(await napi.addEntry(entryFromFood(x.candidates[x.choice], { d: day, meal: g.meal, grams })))
      onClose()
    } catch (e) { setError(e); setAdding(false) }
  }

  if (!preview) {
    return <Sheet title={t('Import a menu')} onClose={onClose}>
      <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s3)' }}>
        {t('Paste what you ate: one food per line, like “Rice 200g” or “2 eggs”. A title like “Breakfast” or “Lunch” sets the meal.')}
      </p>
      <textarea className="bx-input" rows={9} maxLength={MENU_MAX_CHARS} value={text} onChange={e => setText(e.target.value)}
        placeholder={'Breakfast:\nGreek yogurt 150g\n2 eggs\n\nLunch:\nRice 200g\nChicken 150g'} style={{ marginBottom: 'var(--bx-s3)' }} />
      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={!text.trim()} onClick={() => setPreview(read(text, own))}>{t('Read my menu')}</button>
    </Sheet>
  }

  return <Sheet title={t('Import a menu')} onClose={onClose}>
    {!preview.groups.length && <p className="bx-dim">{t('Nothing recognised in this menu.')}</p>}
    {preview.groups.map((g, gi) => <section key={g.key} style={{ marginBottom: 'var(--bx-s4)' }}>
      <select className="bx-input" aria-label={t('Meal')} value={g.meal} onChange={e => setMeal(gi, e.target.value)}>
        {MEALS.map(m => <option key={m} value={m}>{MEAL_LABEL[m]()}</option>)}
      </select>
      <ul className="bx-list" style={{ marginTop: 'var(--bx-s2)' }}>
        {g.items.map(x => {
          const food = x.candidates[x.choice]
          const grams = gramsOf(x)
          return <li key={x.key} className="bx-item" style={{ display: 'block' }}>
            <div className="bx-small bx-dim">{x.item.raw}</div>
            {x.searching
              ? <div className="bx-small bx-dim">{t('Searching…')}</div>
              : x.candidates.length
                ? <select className="bx-input" aria-label={x.item.name} value={x.choice} onChange={e => patch(x.key, { choice: +e.target.value })} style={{ marginTop: 4 }}>
                  {x.candidates.map((f, k) => <option key={k} value={k}>{foodLabel(f)}</option>)}
                  <option value={SKIP}>{t('Skip')}</option>
                </select>
                : <div className="bx-small bx-dim">{t('No match')} · {t('Skip')}</div>}
            {food && x.choice !== SKIP && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bx-s2)', marginTop: 4 }}>
              <input className="bx-input" inputMode="decimal" aria-label={t('Amount (g)')} placeholder={t('Amount (g)')} style={{ maxWidth: 120 }}
                value={x.typed ? x.grams : (grams ?? '')} onChange={e => patch(x.key, { grams: e.target.value, typed: true })} />
              <span className="bx-small bx-dim">{grams != null && grams > 0 ? `${fmtNum(macrosOf({ grams, per100: food.per100 }).kcal)} kcal` : t('Needs an amount')}</span>
            </div>}
          </li>
        })}
      </ul>
    </section>)}
    {preview.ignored > 0 && <p className="bx-small bx-dim">{tn('{0} line left out', '{0} lines left out', preview.ignored)}</p>}
    {error && <div className="bx-alert" role="alert">{t('Could not add. Try again.')}</div>}
    <div style={{ display: 'flex', gap: 'var(--bx-s2)' }}>
      <button className="bx-btn bx-btn-ghost bx-tap" onClick={() => setPreview(null)}>{t('Back')}</button>
      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={!ready.length || adding} onClick={add}>
        {tn('Add {0} food', 'Add {0} foods', ready.length)}
      </button>
    </div>
  </Sheet>
}

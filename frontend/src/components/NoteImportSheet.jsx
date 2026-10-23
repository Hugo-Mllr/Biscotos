// Biscotos: paste a workout from a notes app, check what was understood, add it as routines.
// Two steps in one sheet: the text, then a preview where every line shows the exercise it was
// matched to (changeable, or skipped). It only ever adds routines — nothing existing is touched —
// and the toast that follows has an Undo that takes them out again.
import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { exerciseNameText } from '../lib/format.js'
import { allExercises } from '../lib/exercises.js'
import { deleteRoutine } from '../lib/routines.js'
import { exLine } from '../lib/history.js'
import { parseNote, rankMatches, buildRoutine, NOTE_MAX_CHARS } from '../lib/note-import.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { Button } from './ui.jsx'

const SKIP = -1

// What the sheet understood: routines whose items each carry their candidates and the one chosen.
function read(text, list) {
  const known = new Map()
  const rank = name => {
    if (!known.has(name)) known.set(name, rankMatches(name, list, 5))
    return known.get(name)
  }
  const parsed = parseNote(text, { isKnown: name => rank(name).length > 0 })
  return {
    ignored: parsed.ignored,
    routines: parsed.routines.map((r, i) => ({
      key: i, name: r.name || '',
      items: r.items.map(item => { const candidates = rank(item.name); return { item, candidates, first: candidates, q: '', choice: candidates.length ? 0 : SKIP } })
    }))
  }
}

export function NoteImportSheet({ close }) {
  const S = useStore(s => s.S)
  const list = useMemo(() => allExercises(S), [S.customEx])
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const areaRef = useRef(null)
  const onFocus = useSheetKeyboard(areaRef)

  const choose = (ri, ii, choice) => setPreview(p => ({
    ...p, routines: p.routines.map((r, i) => (i !== ri ? r : { ...r, items: r.items.map((it, j) => (j !== ii ? it : { ...it, choice })) }))
  }))
  // Typing in a line's own search box looks the library up again: a note's words are not always the library's.
  const research = (ri, ii, q) => setPreview(p => ({
    ...p, routines: p.routines.map((r, i) => (i !== ri ? r : { ...r, items: r.items.map((it, j) => {
      if (j !== ii) return it
      const candidates = q.trim().length >= 2 ? rankMatches(q, list, 8) : it.first
      return { ...it, q, candidates, choice: candidates.length ? 0 : SKIP }
    }) }))
  }))
  const rename = (ri, name) => setPreview(p => ({ ...p, routines: p.routines.map((r, i) => (i === ri ? { ...r, name } : r)) }))

  const ready = (preview?.routines || [])
    .map((r, i) => ({ r, i, picks: r.items.filter(x => x.choice !== SKIP).map(x => ({ exercise: x.candidates[x.choice], item: x.item })) }))
    .filter(x => x.picks.length)

  const add = () => {
    const n = ready.length
    const made = ready.map(({ r, i, picks }) =>
      buildRoutine(r.name || t('Imported') + (preview.routines.length > 1 ? ' ' + (i + 1) : ''), picks, { unit: S.unit }))
    useStore.getState().update(s => { for (const r of made) s.routines.push(r) })
    close()
    useUI.getState().toast(t('Added to your plan: {0}', made.map(r => r.name).join(', ')), {
      action: t('Undo'),
      onAction: () => useStore.getState().update(s => { for (const r of made) deleteRoutine(s, r.id) })
    })
    return n
  }

  if (!preview) {
    return <>
      <h3>{t('Import a note')}</h3>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {t('Paste your workout from Notes: one exercise per line, like “Bench press 4x8 80kg”. A title line starts a new routine.')}
      </div>
      <textarea ref={areaRef} onFocus={onFocus} className="input" rows={9} maxLength={NOTE_MAX_CHARS} value={text}
        placeholder={'Push:\nBench press 4x8 80kg\nDips 3x10\n\nPull:\nRow 4x10'}
        onChange={e => setText(e.target.value)} style={{ marginBottom: 14 }} />
      <Button variant="primary" disabled={!text.trim()} onClick={() => setPreview(read(text, list))}>{t('Read my note')}</Button>
    </>
  }

  return <>
    <h3>{t('Import a note')}</h3>
    {!preview.routines.length
      ? <p className="muted" style={{ margin: '12px 0' }}>{t('Nothing recognised in this note.')}</p>
      : preview.routines.map((r, ri) => <section key={r.key} style={{ marginBottom: 16 }}>
        <input className="input" aria-label={t('Name')} value={r.name} maxLength={60}
          placeholder={t('Imported') + (preview.routines.length > 1 ? ' ' + (ri + 1) : '')} onChange={e => rename(ri, e.target.value)} />
        <div className="list" style={{ marginTop: 8 }}>
          {r.items.map((x, ii) => <div key={ii} className="item" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="ss">{x.item.raw}</div>
              {x.candidates.length
                ? <select className="input" aria-label={x.item.name} value={x.choice} onChange={e => choose(ri, ii, +e.target.value)} style={{ marginTop: 4 }}>
                  {x.candidates.map((c, k) => <option key={c.id} value={k}>{exerciseNameText(c)}</option>)}
                  <option value={SKIP}>{t('Skip')}</option>
                </select>
                : <div className="small dim" style={{ marginTop: 4 }}>{t('No match in the library')} · {t('Skip')}</div>}
              <input className="input" data-search="" aria-label={t('Search…')} placeholder={t('Search…')} value={x.q || ''} maxLength={60}
                onChange={e => research(ri, ii, e.target.value)} style={{ marginTop: 4 }} />
              {x.choice !== SKIP && <div className="small dim" style={{ marginTop: 2 }}>{exLine(buildRoutine('', [{ exercise: x.candidates[x.choice], item: x.item }], { unit: S.unit }).ex[0], S.unit)}</div>}
            </div>
          </div>)}
        </div>
      </section>)}
    {preview.ignored > 0 && <p className="small dim">{tn('{0} line left out', '{0} lines left out', preview.ignored)}</p>}
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="ghost" onClick={() => setPreview(null)}>{t('Back')}</Button>
      <Button variant="primary" disabled={!ready.length} onClick={add}>
        {tn('Add {0} routine', 'Add {0} routines', ready.length)}
      </Button>
    </div>
  </>
}

export const noteImportSheet = () => useUI.getState().openSheet(close => <NoteImportSheet close={close} />)

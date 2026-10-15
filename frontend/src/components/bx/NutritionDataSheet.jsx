// "My nutrition data": take it away as a file, bring a file back, or erase it all
// (api/nutrition/portability.js, docs/QUESTIONS.md Q6). The file is the server's export as is;
// an import is validated entry by entry there, so a damaged or edited file can only lose lines.
import { useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { MOBILE, shareExport } from '../../lib/mobile.js'
import { todayISO } from '../../lib/format.js'
import { exportNutrition, importNutrition, eraseNutrition } from '../../lib/nutrition-api.js'
import { Sheet } from './index.jsx'

export default function NutritionDataSheet({ onClose, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)        // { ok, text }
  const [confirmErase, setConfirmErase] = useState(false)
  const fileRef = useRef(null)
  const run = async fn => {
    setBusy(true); setMsg(null)
    try { await fn() } catch { setMsg({ ok: false, text: t('Something went wrong') }) } finally { setBusy(false) }
  }

  const doExport = () => run(async () => {
    const json = JSON.stringify(await exportNutrition(), null, 2)
    const name = 'biscotos-nutrition-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch { /* share sheet dismissed */ } return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
    setMsg({ ok: true, text: t('Exported.') })
  })

  const doImport = file => run(async () => {
    let parsed
    try { parsed = JSON.parse(await file.text()) } catch { setMsg({ ok: false, text: t('That file is not a Biscotos nutrition export.') }); return }
    try {
      const r = await importNutrition(parsed)
      onChanged?.()
      setMsg({ ok: true, text: t('{0} entries added, {1} skipped.', (r.added.log || 0) + (r.added.foods || 0) + (r.added.samples || 0), r.skipped) })
    } catch (e) {
      if (e.status === 400) setMsg({ ok: false, text: t('That file is not a Biscotos nutrition export.') })
      else throw e
    }
  })

  const doErase = () => run(async () => {
    await eraseNutrition()
    setConfirmErase(false)
    onChanged?.()
    setMsg({ ok: true, text: t('Your nutrition data, health imports and Apple Health tokens are erased.') })
  })

  return (
    <Sheet title={t('My nutrition data')} onClose={onClose}>
      <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>
        {t('Your food log, foods, goals and Apple Health imports live on your server, apart from the training backup in Settings.')}
      </p>
      {msg && <div className={msg.ok ? 'bx-card' : 'bx-alert'} role="status" style={{ marginBottom: 'var(--bx-s3)' }}>{msg.text}</div>}

      <button className="bx-btn bx-btn-block bx-tap" disabled={busy} onClick={doExport}>{t('Export as a file')}</button>
      <button className="bx-btn bx-btn-block bx-tap" style={{ marginTop: 'var(--bx-s2)' }} disabled={busy} onClick={() => fileRef.current?.click()}>{t('Import a file')}</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) doImport(f) }} />
      <p className="bx-small bx-dim" style={{ margin: 'var(--bx-s2) 0 var(--bx-s5)' }}>{t('An import adds what is missing and never overwrites an entry you already have.')}</p>

      {!confirmErase
        ? <button className="bx-btn bx-btn-ghost bx-btn-block bx-tap" style={{ color: 'var(--bx-danger)' }} disabled={busy} onClick={() => setConfirmErase(true)}>{t('Erase my nutrition data')}</button>
        : <div className="bx-alert" role="alertdialog" aria-label={t('Erase my nutrition data')}>
            <p style={{ marginBottom: 'var(--bx-s3)' }}>{t('This erases your food log, foods, goals, height, Apple Health imports and tokens, on the server, for good. Export first if you may want them back.')}</p>
            <div style={{ display: 'flex', gap: 'var(--bx-s2)' }}>
              <button className="bx-btn bx-tap" style={{ flex: 1 }} onClick={() => setConfirmErase(false)}>{t('Cancel')}</button>
              <button className="bx-btn bx-tap" style={{ flex: 1, background: 'var(--bx-danger)', color: '#fff', borderColor: 'transparent' }} disabled={busy} onClick={doErase}>{t('Erase')}</button>
            </div>
          </div>}
    </Sheet>
  )
}

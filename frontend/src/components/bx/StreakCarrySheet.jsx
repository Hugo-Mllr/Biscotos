// Biscotos: carry over a streak started in another app (lib/streak-carry.js). One number — the weeks in
// a row the other app shows, up to last week — and Biscotos carries on from it. Saved on the profile
// (S.streakCarry), so it follows the person to every device.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { streakWeeks } from '../../lib/history.js'
import { carryFor, CARRY_MAX_WEEKS } from '../../lib/streak-carry.js'
import { Sheet } from './index.jsx'

export default function StreakCarrySheet({ onClose }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [text, setText] = useState(S.streakCarry?.weeks ? String(S.streakCarry.weeks) : '')
  const typed = /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null
  const carry = typed ? carryFor(typed) : null
  const valid = !!carry && typed <= CARRY_MAX_WEEKS
  // What the streak would be with it: the run of weeks logged here, joined to the carried ones.
  const preview = valid ? streakWeeks({ ...S, streakCarry: carry }) : null

  const save = e => { e.preventDefault(); if (!valid) return; update(s => { s.streakCarry = carryFor(typed) }); onClose() }
  const remove = () => { update(s => { s.streakCarry = null }); onClose() }

  return <Sheet title={t('Continue a streak')} onClose={onClose}>
    <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s3)' }}>
      {t('Started a streak in another app, like Basic-Fit? Enter the weeks in a row it shows, up to last week: Biscotos carries on from there, and this week adds itself when you train.')}
    </p>
    <form onSubmit={save}>
      <label className="bx-field"><span className="bx-label">{t('Weeks in a row')}</span>
        <input className="bx-input" inputMode="numeric" maxLength={3} value={text} onChange={e => setText(e.target.value)} placeholder="12" autoFocus />
      </label>
      {preview != null && <p className="bx-small" style={{ marginBottom: 'var(--bx-s2)' }}>🔥 {t('{0} week streak', preview)}</p>}
      <p className="bx-small bx-dim" style={{ marginBottom: 'var(--bx-s4)' }}>
        {t('It only counts for the streak, not for league points. Friends in your circle see the new number.')}
      </p>
      <button className="bx-btn bx-btn-primary bx-btn-block bx-tap" disabled={!valid}>{t('Save')}</button>
      {S.streakCarry && <button type="button" className="bx-btn bx-btn-ghost bx-btn-block bx-tap" style={{ marginTop: 'var(--bx-s2)', color: 'var(--bx-danger)' }} onClick={remove}>{t('Remove')}</button>}
    </form>
  </Sheet>
}

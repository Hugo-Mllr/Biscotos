// Biscotos: the league at a glance on Home — your place, points and streak this week in your
// circle, or an invitation to start one. Signed in only. A failed read keeps the plain link.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import * as sapi from '../lib/social-api.js'
import { myRow, gapToNext } from '../lib/league.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'

const LAST_CIRCLE = 'bx_league_circle'

export default function LeagueToday() {
  const nav = useNavigate()
  const [state, setState] = useState(null)    // { circle, row, rows } | { none: true }
  useEffect(() => {
    let live = true
    ;(async () => {
      const social = await sapi.loadSocial()
      const circles = social.circles || []
      if (!circles.length) { if (live) setState({ none: true }); return }
      let last = null; try { last = localStorage.getItem(LAST_CIRCLE) } catch { /* private mode */ }
      const circle = circles.find(c => c.id === last) || circles[0]
      const b = await sapi.loadLeaderboard(circle.id)
      if (live) setState({ circle, row: myRow(b.week), rows: b.week.rows })
    })().catch(() => {})
    return () => { live = false }
  }, [])

  const row = state?.row
  const gap = row ? gapToNext(state.rows, row) : null
  return (
    <div className="card tappable lg-card" style={{ cursor: 'pointer' }} {...tappable(() => nav('/league'))}>
      <div className="row between">
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }}><Icon name="trophy" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{state?.circle ? state.circle.name : t('League')}</div>
            <div className="ttl">{state?.none ? t('Challenge your friends')
              : row?.points != null ? t('{0} · {1} pts', '#' + row.rank, fmtNum(row.points))
              : t('League')}</div>
            {row?.points != null && <div className="ss">
              {gap === 0 ? t('You lead the week. Hold on!') : t('{0} points to the next place.', fmtNum(gap))}
            </div>}
          </div>
        </div>
        {row?.streak?.weeks > 0
          ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}><Icon name="flame" /> {row.streak.weeks}</span>
          : <Icon name="chevronRight" className="chev" />}
      </div>
    </div>
  )
}

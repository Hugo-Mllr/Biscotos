// Biscotos: the profile's own badges and the next one to chase (api/social/badges.js). A new badge
// since the last visit is celebrated once with the confetti; the first visit celebrates nothing.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { loadBadges } from '../lib/social-api.js'
import { badgeKey, badgeLabel, newBadges, nextBadges } from '../lib/badges.js'
import Icon from './Icon.jsx'
import Confetti from './Confetti.jsx'

const SEEN = 'gym_badges_seen'
const readSeen = () => { try { const v = JSON.parse(localStorage.getItem(SEEN)); return Array.isArray(v) ? v : null } catch { return null } }
const writeSeen = keys => { try { localStorage.setItem(SEEN, JSON.stringify(keys)) } catch { /* private window: no celebration next time either way */ } }
const iconOf = id => (id === 'streak' ? 'flame' : id === 'records' ? 'trophy' : 'medal')

export default function BadgesCard() {
  const [data, setData] = useState(null)
  const [fresh, setFresh] = useState([])
  useEffect(() => {
    let live = true
    Promise.resolve(loadBadges()).then(d => {
      if (!live || !d || !Array.isArray(d.badges)) return
      setData(d)
      setFresh(newBadges(readSeen(), d.badges))
      writeSeen(d.badges.map(badgeKey))
    }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!data) return null
  const next = nextBadges(data.badges, data.tiers)
  if (!data.badges.length && !next.length) return null
  return <div className="card">
    {fresh.length > 0 && <Confetti />}
    <h3 style={{ margin: '0 0 8px' }}>{t('Badges')}</h3>
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      {data.badges.map(b => <span key={b.id} className={'bx-chip bx-badge'} data-new={fresh.some(f => f.id === b.id) || undefined}>
        <Icon name={iconOf(b.id)} /> {badgeLabel(b)}</span>)}
      {next.map(b => <span key={'n' + b.id} className="bx-chip" style={{ opacity: .45 }}><Icon name={iconOf(b.id)} /> {badgeLabel(b)}</span>)}
    </div>
  </div>
}

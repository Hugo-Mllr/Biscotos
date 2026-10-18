// Biscotos: the way into the ideas box from Home, with how many ideas are open. Signed in only.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { loadIdeas } from '../lib/ideas-api.js'
import { ideasCount } from '../views/Ideas.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'

export default function IdeasToday() {
  const nav = useNavigate()
  const [open, setOpen] = useState(null)
  useEffect(() => {
    let live = true
    loadIdeas().then(b => { if (live) setOpen(b.ideas.filter(i => i.status === 'open').length) }).catch(() => {})
    return () => { live = false }
  }, [])
  return (
    <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/ideas'))}>
      <div className="row between">
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }}><Icon name="sparkles" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{open != null ? ideasCount(open) : t('Ideas')}</div>
            <div className="ttl">{t('Ideas')}</div>
            <div className="ss">{t('Suggest what Biscotos should do next, and +1 your friends’ ideas.')}</div>
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
  )
}

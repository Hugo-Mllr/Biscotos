// Biscotos: "👻 Sam: 100 kg × 5" under an exercise of the workout — a friend's best set to beat
// (lib/ghosts.js). Signed-in profiles in a circle only; nothing shows while there is no ghost.
import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { DEMO } from '../lib/demo.js'
import { createGhostLoader, ghostOf } from '../lib/ghosts.js'
import { loadGhosts } from '../lib/social-api.js'

const loader = createGhostLoader(loadGhosts)

export default function GhostLine({ id }) {
  const user = useStore(s => s.user)
  const unit = useStore(s => s.S.unit) || 'kg'
  const on = !!user && !DEMO && !!id
  useEffect(() => { if (on) loader.ask(id) }, [on, id])
  const list = useSyncExternalStore(loader.subscribe, () => (on ? loader.get(id) : null))
  const g = ghostOf(list, unit)
  if (!g) return null
  const more = g.others > 0 ? ' · ' + tn('+{0} friend', '+{0} friends', g.others) : ''
  return <div className="small dim ghostline" title={t('Best set of a friend · estimated 1RM {0} {1}', fmtNum(g.e1rm), unit)}>
    <span aria-hidden="true">👻 </span>{t('{0}: {1} {2} × {3}', g.name, fmtNum(g.w), unit, g.reps)}{more}
  </div>
}

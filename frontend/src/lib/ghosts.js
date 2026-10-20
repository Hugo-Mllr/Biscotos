// Biscotos: a friend's best set as a ghost to beat, under each exercise of a workout
// (GET /api/social/ghosts). Friends only appear when they turned "My best lifts" on in the league.
//
// ghostOf() is pure: which ghost to show and in which unit. createGhostLoader() asks the server
// for every exercise of the screen in one call (the cards mount one after another, so asks
// made in the same moment are grouped), keeps the answers for the page's life, and never throws.
import { convertWeight } from './units.js'

export const GHOST_TTL_MS = 5 * 60 * 1000
const BATCH_MAX = 30
const LB_PER_KG = 2.2046226218

/**
 * The ghost to show for an exercise: the strongest friend, in the profile's unit.
 * @returns {{ name, w, reps, e1rm, d, others }|null}  w and e1rm in `unit`; others = how many more friends
 */
export function ghostOf(list, unit = 'kg') {
  if (!Array.isArray(list) || !list.length) return null
  const g = list[0]
  if (!g || !(g.kg > 0) || !(g.reps >= 1)) return null
  const conv = v => (unit === 'lb' ? convertWeight(v, 'kg', 'lb') : Math.round(v * 4) / 4)
  return { name: String(g.name || '–'), w: conv(g.kg), reps: g.reps, e1rm: Math.round(unit === 'lb' ? g.e1rm * LB_PER_KG : g.e1rm), d: g.d, others: list.length - 1 }
}

/** One loader per page: get(id) answers from what is known, ask(id) fetches what is not. */
export function createGhostLoader(fetchGhosts, { now = () => Date.now(), wait = fn => setTimeout(fn, 30) } = {}) {
  const known = new Map()          // id → { at, list }
  const queued = new Set()
  const listeners = new Set()
  let timer = null
  const fresh = id => { const k = known.get(id); return k && now() - k.at < GHOST_TTL_MS }
  const flush = async () => {
    timer = null
    const ids = [...queued].slice(0, BATCH_MAX)
    ids.forEach(id => queued.delete(id))
    if (queued.size) timer = wait(flush)
    if (!ids.length) return
    let ghosts = {}
    try { ghosts = (await fetchGhosts(ids))?.ghosts || {} } catch { ghosts = {} }
    const at = now()
    for (const id of ids) known.set(id, { at, list: Array.isArray(ghosts[id]) ? ghosts[id] : [] })
    listeners.forEach(fn => fn())
  }
  return {
    get: id => known.get(id)?.list || null,
    ask(id) {
      if (!id || fresh(id) || queued.has(id)) return
      queued.add(id)
      if (!timer) timer = wait(flush)
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

// Biscotos circles and league: the calls to api/social/routes.js, through lib/api.js like every
// other backend call (Bearer token on the paired app, subpath deployments).
import { api } from './api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const loadSocial = () => api('/api/social')
export const savePrefs = prefs => api('/api/social/prefs', { method: 'PUT', body: JSON.stringify(prefs) })
export const createCircle = (name, prefs) => post('/api/social/circles', { name, prefs }).then(r => r.circle)
export const joinCircle = (code, prefs) => post('/api/social/join', { code, prefs }).then(r => r.circle)
export const leaveCircle = circle => post('/api/social/leave', { circle })
export const renameCircle = (circle, name) => post('/api/social/circles/update', { circle, name }).then(r => r.circle)
export const rotateCode = circle => post('/api/social/circles/update', { circle, rotateCode: true }).then(r => r.circle)
export const removeMember = (circle, member) => post('/api/social/circles/remove', { circle, member }).then(r => r.circle)
export const deleteCircle = circle => post('/api/social/circles/delete', { circle })
export const loadLeaderboard = circle => api('/api/social/leaderboard?' + new URLSearchParams({ circle }))

/** What went wrong, as a key the screen has a sentence for. */
export function socialProblem(e) {
  if (!e) return null
  const code = e.data?.code
  if (code === 'bad-code') return 'bad-code'
  if (code === 'full') return 'full'
  if (code === 'circle-full') return 'circle-full'
  if (e.status === 429) return 'busy'
  if (e.status === 401) return 'signed-out'
  if (e.status === 404) return 'gone'
  return 'unavailable'
}
export const loadFeed = circle => api('/api/social/feed?' + new URLSearchParams({ circle }))
export const react = (circle, event, emoji) => post('/api/social/react', { circle, event, emoji })
export const setShame = (circle, shame) => post('/api/social/circles/update', { circle, shame }).then(r => r.circle)

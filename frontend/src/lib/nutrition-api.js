// Biscotos nutrition: the calls to api/nutrition/routes.js. Everything goes through lib/api.js
// (the only module that talks to the backend), so a paired phone's Bearer token and a subpath
// deployment work here exactly as for the rest of the app.
import { api } from './api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString()

export const loadNutrition = (from, to) => api('/api/nutrition?' + qs({ from, to }))
export const saveSettings = body => api('/api/nutrition/settings', { method: 'PUT', body: JSON.stringify(body) })
export const addEntry = entry => post('/api/nutrition/log', entry).then(r => r.entry)
export const updateEntry = (id, changes) => post('/api/nutrition/log/update', { id, ...changes }).then(r => r.entry)
export const deleteEntry = id => post('/api/nutrition/log/delete', { id })
export const addFood = food => post('/api/nutrition/foods', food).then(r => r.food)
export const deleteFood = id => post('/api/nutrition/foods/delete', { id })
export const searchFoods = (q, lang) => api('/api/food/search?' + qs({ q, lang })).then(r => r.foods || [])
export const foodByBarcode = (code, lang) => api('/api/food/barcode?' + qs({ code, lang })).then(r => r.food)

/** What went wrong with a lookup, as a key the view translates. */
export function lookupProblem(e) {
  if (!e) return null
  if (e.status === 404) return 'not-found'
  if (e.status === 429 || e.data?.code === 'busy') return 'busy'
  if (e.data?.code === 'off') return 'off'
  if (e.status === 401) return 'signed-out'
  return 'unavailable'
}

// Apple Health import (api/health/routes.js, docs/APPLE_HEALTH.md)
export const listHookTokens = () => api('/api/integrations/tokens')
// kind: 'apple-health' (the Shortcut's key, the default) or 'widget' (the iPhone widget's read-only key)
export const createHookToken = (label, kind) => post('/api/integrations/tokens', kind ? { label, kind } : { label })
export const revokeHookToken = id => post('/api/integrations/tokens/revoke', { id }).then(r => r.hook)
export const loadHealthSamples = (from, to) => api('/api/health-samples?' + qs({ from, to })).then(r => r.samples || [])

// Portability (api/nutrition/portability.js): the whole of it as one file, back, or erased.
export const exportNutrition = () => api('/api/nutrition/export')
export const importNutrition = (file, mode = 'merge') => post('/api/nutrition/import', { file, mode })
export const eraseNutrition = () => post('/api/nutrition/erase', { confirm: 'erase' })

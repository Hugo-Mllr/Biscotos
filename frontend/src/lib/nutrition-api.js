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

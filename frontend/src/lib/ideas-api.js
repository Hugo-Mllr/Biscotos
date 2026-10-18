// Biscotos ideas box: the calls to api/ideas/index.js, through lib/api.js like every other backend call.
import { api } from './api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const loadIdeas = () => api('/api/ideas')
export const sendIdea = (title, body) => post('/api/ideas', { title, body }).then(r => r.idea)
export const voteIdea = id => post('/api/ideas/vote', { id }).then(r => r.idea)
export const setIdeaStatus = (id, status) => post('/api/ideas/status', { id, status }).then(r => r.idea)
export const deleteIdea = id => post('/api/ideas/delete', { id })

/** What went wrong, as a key the screen has a sentence for. */
export const ideaProblem = e => (e?.data?.code === 'per-day' ? 'per-day' : 'failed')

// Biscotos: what to tell someone when a request failed. "Could not save. Try again." alone left a
// failure behind a login proxy, an expired session and a server error looking the same; a short
// technical tail ("HTTP 403", "network") lets them say which one it was.
import { t } from './i18n.js'

/** "HTTP 403", "timeout", "network"… for an error thrown by lib/api.js, or '' when there is nothing to say. */
export function failureDetail(e) {
  if (!e) return ''
  if (e.status) return 'HTTP ' + e.status
  if (e.code) return String(e.code)
  if (e.name === 'TypeError') return 'network'
  return ''
}

/** The sentence for a failed save: the generic one with its tail, or the session one for a 401. */
export function saveFailure(e) {
  if (e?.status === 401) return t('Your session has expired. Sign in again.')
  const detail = failureDetail(e)
  return t('Could not save. Try again.') + (detail ? ` (${detail})` : '')
}

import { describe, expect, it } from 'vitest'
import { failureDetail, saveFailure } from './failure.js'

describe('failure', () => {
  it('names what failed, as far as it is known', () => {
    expect(failureDetail(Object.assign(new Error('x'), { status: 403 }))).toBe('HTTP 403')
    expect(failureDetail(Object.assign(new Error('x'), { code: 'timeout' }))).toBe('timeout')
    expect(failureDetail(new TypeError('Failed to fetch'))).toBe('network')
    expect(failureDetail(new Error('?'))).toBe('')
    expect(failureDetail(null)).toBe('')
  })
  it('the generic sentence with its tail; a 401 is a session that expired', () => {
    expect(saveFailure(Object.assign(new Error('x'), { status: 502 }))).toBe('Could not save. Try again. (HTTP 502)')
    expect(saveFailure(new Error('?'))).toBe('Could not save. Try again.')
    expect(saveFailure(Object.assign(new Error('x'), { status: 401 }))).toBe('Your session has expired. Sign in again.')
  })
})

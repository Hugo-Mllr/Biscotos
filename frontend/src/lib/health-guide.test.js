import { describe, expect, it } from 'vitest'
import { SHORTCUT_JSON, guideSteps } from './health-guide.js'

describe('health guide', () => {
  it('the template is the JSON the webhook takes, once the variables are filled in', () => {
    const filled = SHORTCUT_JSON.replace('[Jour]', '2026-10-18').replace(/\[[A-Za-z]+\]/g, '1')
    const body = JSON.parse(filled)
    expect(body.samples.map(s => s.type)).toEqual(['weight', 'steps', 'sleepMin', 'restingHr'])
    expect(body.samples.find(s => s.type === 'sleepMin').unit).toBe('h')
  })

  it('French for fr-*, English for every other language, same steps and copy buttons', () => {
    expect(guideSteps('fr')[0].title).toBe('Crée le Raccourci')
    expect(guideSteps('fr-CA')).toBe(guideSteps('fr'))
    expect(guideSteps('de')).toBe(guideSteps('en'))
    expect(guideSteps(undefined)).toBe(guideSteps('en'))
    expect(guideSteps('fr').map(s => s.copy)).toEqual(guideSteps('en').map(s => s.copy))
    expect(guideSteps('en').filter(s => s.copy).map(s => s.copy)).toEqual(['json', 'url'])
  })
})

import { describe, expect, it } from 'vitest'
import { widgetScript } from './widget-script.js'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const KEY = 'bxh_' + 'K'.repeat(43)   // synthetic

const DATA = {
  v: 1, day: '2026-10-22', accent: 'lime', streak: 6, week: { workouts: 3, planned: 4 },
  kcal: { eaten: 1540, goal: 2450 },
  macros: [{ id: 'protein', eaten: 90, goal: 170 }, { id: 'carbs', eaten: 160, goal: 260 }, { id: 'fat', eaten: 40, goal: null }],
  steps: { d: '2026-10-22', value: 6543, goal: 8000 },
}

// Stand-ins for the few Scriptable objects the script uses; they record what it draws.
function scriptable({ family, runsInWidget = true, respond, files = {} }) {
  const log = { texts: [], images: 0, set: null, presented: null, requests: [], backgroundGradient: false }
  class Stack {
    addText(s) { log.texts.push(String(s)); return {} }
    addImage() { log.images++; return {} }
    addSpacer() {}
    addStack() { return new Stack() }
    layoutVertically() {} layoutHorizontally() {} centerAlignContent() {} setPadding() {}
  }
  class ListWidget extends Stack {
    set backgroundGradient(v) { log.backgroundGradient = !!v }
    present(kind) { log.presented = kind; return Promise.resolve() }
    presentSmall() { return this.present('small') } presentMedium() { return this.present('medium') } presentLarge() { return this.present('large') }
  }
  class Request {
    constructor(url) { this.url = url; log.requests.push(this) }
    async loadJSON() { this.response = { statusCode: 200 }; return respond(this) }
  }
  const store = { ...files }
  const api = {
    ListWidget, Request,
    DrawContext: class { setFillColor() {} fillEllipse() {} setTextColor() {} setFont() {} setTextAlignedCenter() {} drawTextInRect() {} getImage() { return {} } },
    Size: class { constructor(w, h) { this.w = w; this.h = h } },
    Rect: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }) } },
    Color: class { constructor(hex, alpha) { this.hex = hex; this.alpha = alpha } },
    Font: { boldSystemFont: n => ({ n }), systemFont: n => ({ n }) },
    LinearGradient: class {},
    FileManager: { local: () => ({
      documentsDirectory: () => '/docs', joinPath: (a, b) => a + '/' + b,
      fileExists: f => f in store, readString: f => store[f], writeString: (f, s) => { store[f] = s },
    }) },
    Script: { setWidget: w => { log.set = w }, complete: () => { log.complete = true } },
    config: { runsInWidget, widgetFamily: family },
  }
  return { api, log, store }
}

const run = async (opts, args = { base: 'https://biscotos.example/', key: KEY, lang: 'fr' }) => {
  const s = scriptable(opts)
  const names = Object.keys(s.api)
  await new AsyncFunction(...names, widgetScript(args))(...names.map(n => s.api[n]))
  return s
}

describe('widgetScript', () => {
  it('puts the address, the key and the language in, and is valid JavaScript', () => {
    const src = widgetScript({ base: 'https://biscotos.example///', key: KEY, lang: 'fr-FR' })
    expect(src).toContain('const BASE = "https://biscotos.example"')
    expect(src).toContain(`const KEY = "${KEY}"`)
    expect(src).toContain('const LANG = "fr"')
    expect(src).not.toContain('__')
    expect(() => new AsyncFunction(src)).not.toThrow()
    expect(widgetScript({ base: 'x', key: 'k', lang: 'de' })).toContain('const LANG = "en"')
  })

  it('asks the server with the key in the Authorization header, never in the address', async () => {
    const s = await run({ family: 'medium', respond: () => DATA })
    expect(s.log.requests).toHaveLength(1)
    expect(s.log.requests[0].url).toBe('https://biscotos.example/api/hooks/widget')
    expect(s.log.requests[0].headers).toEqual({ Authorization: 'Bearer ' + KEY })
    expect(s.log.requests[0].url).not.toContain(KEY)
  })

  for (const family of ['small', 'medium', 'large', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
    it(`draws the ${family} widget from the summary`, async () => {
      const s = await run({ family, respond: () => DATA })
      expect(s.log.set).not.toBe(null)
      expect(s.log.complete).toBe(true)
      const all = s.log.texts.join(' | ')
      if (family !== 'accessoryCircular') expect(all).toContain('6')               // the streak
      if (family === 'medium' || family === 'large') {
        expect(s.log.images).toBe(2)                                                 // the two rings
        expect(all).toContain('3 / 4 séances')
      }
      if (family === 'large') {
        expect(all).toContain('Protéines')
        expect(all).toMatch(/90 \/ 170 g/)
        expect(all).toMatch(/40 g/)                                                  // a macro without a goal
      }
      if (family === 'accessoryRectangular') expect(all).toMatch(/6\s543 \/ 8\s000 pas/)
    })
  }

  it('in English when asked, and a missing goal or steps does not break it', async () => {
    const s = await run({ family: 'large', respond: () => ({ ...DATA, kcal: { eaten: 0, goal: null }, steps: null }) }, { base: 'https://b', key: KEY, lang: 'en' })
    expect(s.log.texts.join(' | ')).toContain('Protein')
    expect(s.log.texts.join(' | ')).toContain('wk')
  })

  it('shows the last summary, marked offline, when the server cannot be reached', async () => {
    const files = { '/docs/biscotos-widget.json': JSON.stringify(DATA) }
    const s = await run({ family: 'medium', files, respond: () => { throw new Error('offline') } })
    expect(s.log.texts.join(' | ')).toContain('hors ligne')
    expect(s.log.texts.join(' | ')).toContain('3 / 4 séances')
  })

  it('says it could not load when there is nothing to show', async () => {
    const s = await run({ family: 'medium', respond: () => { throw new Error('offline') } })
    expect(s.log.texts).toEqual(['Biscotos : impossible de charger'])
  })

  it('a wrong answer (a 401 page, another version) is not drawn', async () => {
    const s = await run({ family: 'medium', respond: () => ({ error: 'invalid widget key' }) })
    expect(s.log.texts).toEqual(['Biscotos : impossible de charger'])
  })

  it('keeps the summary for next time, without the key in it', async () => {
    const s = await run({ family: 'medium', respond: () => DATA })
    const saved = s.store['/docs/biscotos-widget.json']
    expect(JSON.parse(saved)).toEqual(DATA)
    expect(saved).not.toContain(KEY)
  })

  it('previews in the app when it is not running as a widget', async () => {
    const s = await run({ family: undefined, runsInWidget: false, respond: () => DATA })
    expect(s.log.presented).toBe('medium')
    expect(s.log.set).toBe(null)
  })
})

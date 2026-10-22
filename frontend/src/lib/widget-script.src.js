// Biscotos widget for Scriptable (https://scriptable.app, free). Made by the app:
// Settings → Body & goals → iPhone widget. The address and the key below are yours: revoke the key
// in the app if you lose this phone. Paste this whole script into Scriptable, name it "Biscotos",
// then add a Scriptable widget to the Home Screen or Lock Screen and choose it.
const BASE = "__BASE__"
const KEY = "__KEY__"
const LANG = "__LANG__"

const WORDS = {
  fr: { week: 'sem.', done: 'séances', steps: 'pas', kcal: 'kcal', offline: 'hors ligne', error: 'Biscotos : impossible de charger', protein: 'Protéines', carbs: 'Glucides', fat: 'Lipides', ok: 'Objectif atteint' },
  en: { week: 'wk', done: 'workouts', steps: 'steps', kcal: 'kcal', offline: 'offline', error: 'Biscotos: could not load', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', ok: 'Goal reached' },
}
const W = WORDS[LANG] || WORDS.en
const ACCENTS = { violet: '#bf5af2', lime: '#30d158', sky: '#0a84ff', orange: '#ff9f0a', pink: '#ff375f', red: '#ff453a', teal: '#40c8e0', gold: '#ffd60a' }
const MACRO_COLORS = { protein: '#5ac8fa', carbs: '#ffc94a', fat: '#ff7ab6' }

const num = n => Number(n || 0).toLocaleString(LANG === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 })
const fraction = (v, goal) => (goal > 0 ? Math.min(1, Math.max(0, v / goal)) : 0)

// "#rrggbb" mixed with another by t (0 = a, 1 = b).
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

// A ring as an image: a track, an arc drawn as a string of dots, and a number in the middle.
function ring(size, lineWidth, frac, color, center, small) {
  const dc = new DrawContext()
  dc.size = new Size(size, size)
  dc.opaque = false
  dc.respectScreenScale = true
  const c = size / 2
  const r = (size - lineWidth) / 2
  const dot = (angle, col) => {
    dc.setFillColor(col)
    dc.fillEllipse(new Rect(c + r * Math.cos(angle) - lineWidth / 2, c + r * Math.sin(angle) - lineWidth / 2, lineWidth, lineWidth))
  }
  const steps = 120
  const track = new Color('#ffffff', 0.14)
  for (let i = 0; i < steps; i++) dot(-Math.PI / 2 + (2 * Math.PI * i) / steps, track)
  const n = Math.round(steps * frac)
  const arc = new Color(color)
  for (let i = 0; i < n; i++) dot(-Math.PI / 2 + (2 * Math.PI * i) / steps, arc)
  if (center) {
    dc.setTextColor(new Color('#ffffff'))
    dc.setFont(Font.boldSystemFont(Math.round(size * 0.24)))
    dc.setTextAlignedCenter()
    dc.drawTextInRect(center, new Rect(0, c - size * 0.2, size, size * 0.3))
    if (small) {
      dc.setTextColor(new Color('#ffffff', 0.6))
      dc.setFont(Font.systemFont(Math.round(size * 0.12)))
      dc.drawTextInRect(small, new Rect(0, c + size * 0.07, size, size * 0.2))
    }
  }
  return dc.getImage()
}

function text(stack, str, size, opts) {
  const o = opts || {}
  const t = stack.addText(String(str))
  t.font = o.bold ? Font.boldSystemFont(size) : Font.systemFont(size)
  t.textColor = new Color(o.color || '#ffffff', o.alpha == null ? 1 : o.alpha)
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
  return t
}

function bar(stack, width, frac, color) {
  const track = stack.addStack()
  track.size = new Size(width, 6)
  track.cornerRadius = 3
  track.backgroundColor = new Color('#ffffff', 0.14)
  const fill = track.addStack()
  fill.size = new Size(Math.max(0, Math.round(width * frac)), 6)
  fill.cornerRadius = 3
  fill.backgroundColor = new Color(color)
}

async function load() {
  const cache = FileManager.local()
  const file = cache.joinPath(cache.documentsDirectory(), 'biscotos-widget.json')
  try {
    const req = new Request(BASE + '/api/hooks/widget')
    req.headers = { Authorization: 'Bearer ' + KEY }
    const data = await req.loadJSON()
    if (!req.response || req.response.statusCode !== 200 || !data || data.v !== 1) throw new Error('http')
    cache.writeString(file, JSON.stringify(data))
    return { data, offline: false }
  } catch (e) {
    if (cache.fileExists(file)) return { data: JSON.parse(cache.readString(file)), offline: true }
    return { data: null, offline: true }
  }
}

function build(data, offline, family) {
  const w = new ListWidget()
  w.url = BASE + '/#/home'
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000)
  if (!data) {
    text(w, W.error, 13, { bold: true })
    return w
  }
  const accent = ACCENTS[data.accent] || (/^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : ACCENTS.violet)
  const g = new LinearGradient()
  g.colors = [new Color(mix('#0a0714', accent, 0.1)), new Color(mix('#0a0714', accent, 0.34))]
  g.locations = [0, 1]
  w.backgroundGradient = g
  w.setPadding(12, 12, 12, 12)

  const kcal = data.kcal || { eaten: 0, goal: null }
  const steps = data.steps || null
  const kcalRing = size => ring(size, size * 0.11, fraction(kcal.eaten, kcal.goal), accent, num(kcal.eaten), kcal.goal ? '/ ' + num(kcal.goal) : W.kcal)
  const stepsRing = size => ring(size, size * 0.11, steps ? fraction(steps.value, steps.goal) : 0, '#63e6e2', steps ? num(steps.value) : '–', W.steps)
  const stats = stack => {
    text(stack, '🔥 ' + data.streak + ' ' + W.week, 14, { bold: true })
    stack.addSpacer(3)
    text(stack, data.week.workouts + (data.week.planned ? ' / ' + data.week.planned : '') + ' ' + W.done, 12, { alpha: 0.75 })
    if (offline) { stack.addSpacer(3); text(stack, W.offline, 10, { alpha: 0.5 }) }
  }

  if (family === 'accessoryCircular') {
    w.addImage(ring(56, 6, steps ? fraction(steps.value, steps.goal) : fraction(kcal.eaten, kcal.goal), '#ffffff', steps ? num(steps.value) : num(kcal.eaten)))
    return w
  }
  if (family === 'accessoryInline') {
    text(w, '🔥 ' + data.streak + ' · ' + num(kcal.eaten) + ' ' + W.kcal + (steps ? ' · ' + num(steps.value) + ' ' + W.steps : ''), 12)
    return w
  }
  if (family === 'accessoryRectangular') {
    text(w, '🔥 ' + data.streak + ' ' + W.week + ' · ' + data.week.workouts + ' ' + W.done, 12, { bold: true })
    text(w, num(kcal.eaten) + (kcal.goal ? ' / ' + num(kcal.goal) : '') + ' ' + W.kcal, 12)
    if (steps) text(w, num(steps.value) + ' / ' + num(steps.goal) + ' ' + W.steps, 12)
    return w
  }
  if (family === 'small') {
    const top = w.addStack()
    text(top, '🔥 ' + data.streak + ' ' + W.week, 12, { bold: true })
    w.addSpacer(4)
    const mid = w.addStack()
    mid.addSpacer()
    mid.addImage(kcalRing(88))
    mid.addSpacer()
    w.addSpacer(4)
    text(w, steps ? '👟 ' + num(steps.value) : data.week.workouts + ' ' + W.done, 12, { alpha: 0.8 })
    return w
  }
  // medium and large: the two rings, then the numbers; large adds the macros
  const row = w.addStack()
  row.centerAlignContent()
  row.addImage(kcalRing(96))
  row.addSpacer(10)
  row.addImage(stepsRing(96))
  row.addSpacer(12)
  const col = row.addStack()
  col.layoutVertically()
  stats(col)
  if (family === 'large') {
    w.addSpacer(16)
    for (const m of data.macros) {
      const line = w.addStack()
      line.centerAlignContent()
      text(line, W[m.id], 13, { bold: true, color: MACRO_COLORS[m.id] })
      line.addSpacer()
      text(line, num(m.eaten) + (m.goal ? ' / ' + num(m.goal) : '') + ' g', 13, { alpha: 0.85 })
      w.addSpacer(4)
      bar(w, 290, fraction(m.eaten, m.goal), MACRO_COLORS[m.id])
      w.addSpacer(10)
    }
    w.addSpacer()
  }
  return w
}

const { data, offline } = await load()
const family = config.widgetFamily || 'medium'
const widget = build(data, offline, family)
if (config.runsInWidget) Script.setWidget(widget)
else if (family === 'large') await widget.presentLarge()
else if (family === 'small') await widget.presentSmall()
else await widget.presentMedium()
Script.complete()

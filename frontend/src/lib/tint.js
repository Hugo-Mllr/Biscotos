// Biscotos: the page and card fills take a hint of the accent ("tinted background", Settings →
// Appearance), in the dark and the light theme alike: violet gives an aubergine night and a
// lavender day, blue a navy night and a sky-grey day. Off, the fills are openGym's neutral greys.
//
// The fills are mixed here rather than in CSS so the exact page colour is known for the browser's
// theme-color (the iOS status bar and the Android task switcher). Only a little of the accent goes
// in (at most 12 %), so text contrast on every fill stays what index.css measured for the greys
// (tint.test.js).
import { ACCENTS } from './format.js'
import { cleanHex, mix } from './accent.js'

// Each theme's neutral fills (index.css) and how much of the accent each one takes.
export const BASES = {
  dark: {
    '--bg': ['#000000', 0.07], '--bg-el': ['#0e0e10', 0.08], '--surface': ['#1c1c1e', 0.10],
    '--surface-2': ['#2c2c2e', 0.12], '--surface-3': ['#3a3a3c', 0.12],
  },
  light: {
    '--bg': ['#f2f2f7', 0.09], '--bg-el': ['#f7f7fa', 0.07], '--surface': ['#ffffff', 0.03],
    '--surface-2': ['#ececef', 0.09], '--surface-3': ['#e3e3e8', 0.11],
  },
}
const NAMES = Object.keys(BASES.dark)

/** The accent as '#rrggbb' for a preset key or an own colour; null for anything else. */
export function accentHex(value) {
  return cleanHex(value) || (typeof value === 'string' && Object.hasOwn(ACCENTS, value) ? ACCENTS[value] : null)
}

/** The tinted fills for `value` (accentValue's) in `theme`, or null when there is nothing to mix. */
export function tintVars(value, theme) {
  const hex = accentHex(value)
  if (!hex) return null
  const base = BASES[theme] || BASES.dark
  return Object.fromEntries(NAMES.map(k => [k, mix(base[k][0], hex, base[k][1])]))
}

/** Puts the tinted fills on `el` (or takes them off); returns the page colour for theme-color. */
export function applyTint(el, value, theme, on) {
  const vars = on ? tintVars(value, theme) : null
  for (const k of NAMES) {
    if (vars) el.style.setProperty(k, vars[k]); else el.style.removeProperty(k)
  }
  el.dataset.tint = vars ? 'on' : 'off'
  return vars ? vars['--bg'] : (theme === 'light' ? BASES.light['--bg'][0] : BASES.dark['--bg'][0])
}

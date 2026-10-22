// Biscotos: a short burst of confetti, for a record. Plain DOM and CSS (no dependency): a few dozen
// small pieces fly out of the top of the screen and fall, then the layer removes itself. Nothing at
// all for someone whose phone asks for reduced motion. The pieces are laid out from their index, so
// the same burst always looks the same (and tests need no random numbers).
import { useEffect, useState } from 'react'

const COLORS = ['var(--acc)', 'var(--green)', 'var(--orange)', 'var(--pink)', 'var(--yellow)', 'var(--blue)', 'var(--mint)']
export const CONFETTI_MS = 2600

// A cheap repeatable 0..1 from an index and a salt.
const unit = (i, salt) => { const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x) }

/** The layout of `count` pieces: where they land, how they spin, how long they take. */
export function piecesOf(count = 36) {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    color: COLORS[i % COLORS.length],
    dx: Math.round((unit(i, 1) - 0.5) * 340),            // −170…170 px sideways
    dy: Math.round(260 + unit(i, 2) * 320),              // 260…580 px down
    rot: Math.round((unit(i, 3) - 0.5) * 1440),          // up to two full turns each way
    delay: Math.round(unit(i, 4) * 220),
    ms: Math.round(1300 + unit(i, 5) * 900),
    w: 6 + Math.round(unit(i, 6) * 5),
    h: 9 + Math.round(unit(i, 7) * 6),
    round: i % 4 === 0,
  }))
}

export const prefersReducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export default function Confetti({ count = 36 }) {
  const [on, setOn] = useState(() => !prefersReducedMotion())
  useEffect(() => {
    if (!on) return
    const id = setTimeout(() => setOn(false), CONFETTI_MS)
    return () => clearTimeout(id)
  }, [on])
  if (!on) return null
  return <div className="confetti" aria-hidden="true">
    {piecesOf(count).map(p => <i key={p.key} style={{
      background: p.color, width: p.w, height: p.round ? p.w : p.h, borderRadius: p.round ? '50%' : 2,
      animationDuration: p.ms + 'ms', animationDelay: p.delay + 'ms',
      '--dx': p.dx + 'px', '--dy': p.dy + 'px', '--rot': p.rot + 'deg',
    }} />)}
  </div>
}

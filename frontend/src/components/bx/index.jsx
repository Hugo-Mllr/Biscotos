// Biscotos UI primitives (styles/biscotos.css, docs/DESIGN.md). Small on purpose: a counter
// that rolls, a ring and a bar that draw themselves, and a bottom sheet. All timing comes from
// lib/motion.js, so prefers-reduced-motion turns every one of them into a plain static render.
import { useEffect, useRef, useState } from 'react'
import { duration, ringOffset, tween } from '../../lib/motion.js'

/** Rolls from the previous value to `value` like a scoreboard. */
export function useCountUp(value, name = 'draw') {
  const target = Number(value) || 0
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const total = duration(name)
    const start = from.current
    if (!total || start === target || typeof requestAnimationFrame !== 'function') {
      from.current = target; setShown(target); return
    }
    let raf = 0, t0 = 0
    const step = now => {
      if (!t0) t0 = now
      const v = tween(start, target, now - t0, total)
      from.current = v
      setShown(v)
      if (v !== target) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, name])
  return shown
}

export function CountUp({ value, decimals = 0, className = '' }) {
  const v = useCountUp(value)
  const text = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return <span className={className} aria-label={String(Math.round((Number(value) || 0) * 10 ** decimals) / 10 ** decimals)}>{text}</span>
}

/** True once the first frame has painted — lets a ring or bar animate in from empty. */
function useDrawn() {
  const [drawn, setDrawn] = useState(() => duration('draw') === 0)
  useEffect(() => {
    if (drawn) return
    if (typeof requestAnimationFrame !== 'function') { setDrawn(true); return }
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [drawn])
  return drawn
}

/** A progress ring. `fraction` may exceed 1: the ring stays full and turns ember. */
export function Ring({ fraction, size = 168, stroke = 14, color, children, label }) {
  const drawn = useDrawn()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const over = fraction > 1
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg className={'bx-ring' + (over ? ' is-over' : '')} width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        role="img" aria-label={label} style={color ? { '--c': color } : undefined}>
        <circle className="bx-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="bx-ring-val" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={drawn ? ringOffset(r, fraction) : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  )
}

/** A horizontal macro bar. */
export function Bar({ fraction, color, label }) {
  const drawn = useDrawn()
  const f = Math.max(0, Number(fraction) || 0)
  return (
    <div className={'bx-bar' + (f > 1 ? ' is-over' : '')} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(f, 1) * 100)}>
      <i style={{ width: (drawn ? Math.min(f, 1) * 100 : 0) + '%', '--c': color }} />
    </div>
  )
}

/** Bottom sheet: closes on backdrop tap and on Escape. */
export function Sheet({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="bx-sheet-bg bx" style={{ padding: 0, minHeight: 0 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bx-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="bx-sheet-grip" aria-hidden="true" />
        {title && <h2 className="bx-title" style={{ fontSize: 'var(--bx-fs-xl)', marginBottom: 'var(--bx-s4)' }}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}

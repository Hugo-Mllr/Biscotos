// @vitest-environment happy-dom
// Biscotos builds without the Gym visual media (VITE_EXERCISE_MEDIA=0, docs/QUESTIONS.md Q4): the
// app must then ask for none of those files — no <img>/<video> pointing at exercise-media/, no
// prefetch — and show an exercise like one that has no media.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let Media, Thumb, planMediaUrls, EXERCISE_MEDIA, EXIDX

beforeAll(async () => {
  vi.stubEnv('VITE_EXERCISE_MEDIA', '0')
  vi.resetModules()
  ;({ default: Media, Thumb } = await import('./Media.jsx'))
  ;({ planMediaUrls } = await import('../lib/media-prefetch.js'))
  ;({ EXERCISE_MEDIA, EXIDX } = await import('../lib/exercises.js'))
})
afterAll(() => { vi.unstubAllEnvs(); vi.resetModules() })

const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  return { host, done: () => { act(() => root.unmount()); host.remove() } }
}

describe('exercise media switched off', () => {
  it('reads the build flag', () => {
    expect(EXERCISE_MEDIA).toBe(false)
  })

  it('renders no animation and a neutral thumbnail, requesting nothing', () => {
    const ex = Object.values(EXIDX).find(e => e.gif && e.img)
    const big = render(<Media ex={ex} />)
    expect(big.host.innerHTML).toBe('')
    big.done()
    const thumb = render(<Thumb ex={ex} />)
    expect(thumb.host.querySelector('img, video')).toBe(null)
    expect(thumb.host.querySelector('.thumb-x')).not.toBe(null)
    thumb.done()
  })

  it('prefetches nothing', () => {
    const id = Object.values(EXIDX).find(e => e.gif).id
    expect(planMediaUrls({ routines: [{ ex: [{ id }] }] }, 'https://biscotos.example/')).toEqual([])
  })
})

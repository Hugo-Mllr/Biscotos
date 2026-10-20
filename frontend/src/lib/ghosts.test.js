import { describe, expect, it, vi } from 'vitest'
import { ghostOf, createGhostLoader, GHOST_TTL_MS } from './ghosts.js'

describe('ghostOf', () => {
  it('the strongest friend, in the profile unit, with how many others', () => {
    const list = [{ name: 'Sam', kg: 100, reps: 5, e1rm: 116.7, d: '2026-10-01' }, { name: 'Lou', kg: 90, reps: 5, e1rm: 105, d: '2026-10-02' }]
    expect(ghostOf(list, 'kg')).toEqual({ name: 'Sam', w: 100, reps: 5, e1rm: 117, d: '2026-10-01', others: 1 })
    expect(ghostOf(list, 'lb')).toMatchObject({ w: 220.5, e1rm: 257 })
  })
  it('nothing for no friend or a broken entry', () => {
    expect(ghostOf(null)).toBe(null)
    expect(ghostOf([])).toBe(null)
    expect(ghostOf([{ name: 'x', kg: 0, reps: 5 }])).toBe(null)
  })
})

describe('createGhostLoader', () => {
  const setup = () => {
    let t = 0, pending = []
    const fetchGhosts = vi.fn(async ids => ({ ghosts: Object.fromEntries(ids.filter(i => i === 'bench').map(i => [i, [{ name: 'Sam', kg: 80, reps: 5, e1rm: 93 }]])) }))
    const loader = createGhostLoader(fetchGhosts, { now: () => t, wait: fn => { pending.push(fn); return 1 } })
    const run = async () => { const fns = pending; pending = []; for (const fn of fns) await fn() }
    return { loader, fetchGhosts, run, tick: ms => { t += ms } }
  }
  it('groups the asks of one moment into one call and tells the listeners', async () => {
    const { loader, fetchGhosts, run } = setup()
    const heard = vi.fn()
    loader.subscribe(heard)
    loader.ask('bench'); loader.ask('squat'); loader.ask('bench')
    expect(loader.get('bench')).toBe(null)
    await run()
    expect(fetchGhosts).toHaveBeenCalledTimes(1)
    expect(fetchGhosts).toHaveBeenCalledWith(['bench', 'squat'])
    expect(loader.get('bench')[0].name).toBe('Sam')
    expect(loader.get('squat')).toEqual([])
    expect(heard).toHaveBeenCalledTimes(1)
  })
  it('asks again only once the answer is stale, and a failure counts as no ghost', async () => {
    const { loader, fetchGhosts, run, tick } = setup()
    loader.ask('bench'); await run()
    loader.ask('bench'); await run()
    expect(fetchGhosts).toHaveBeenCalledTimes(1)
    tick(GHOST_TTL_MS + 1)
    fetchGhosts.mockRejectedValueOnce(new Error('offline'))
    loader.ask('bench'); await run()
    expect(fetchGhosts).toHaveBeenCalledTimes(2)
    expect(loader.get('bench')).toEqual([])
  })
  it('splits more than 30 exercises over several calls', async () => {
    const { loader, fetchGhosts, run } = setup()
    for (let i = 0; i < 35; i++) loader.ask('e' + i)
    await run(); await run()
    expect(fetchGhosts.mock.calls.map(c => c[0].length)).toEqual([30, 5])
  })
})

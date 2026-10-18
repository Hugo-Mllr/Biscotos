// @vitest-environment happy-dom
// The ideas box against a stubbed lib/ideas-api.js. Synthetic ideas only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
const api = vi.hoisted(() => ({
  loadIdeas: vi.fn(), sendIdea: vi.fn(), voteIdea: vi.fn(), setIdeaStatus: vi.fn(), deleteIdea: vi.fn(),
  ideaProblem: e => (e?.data?.code === 'per-day' ? 'per-day' : 'failed'),
}))
vi.mock('../lib/ideas-api.js', () => api)

import Ideas from './Ideas.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const byText = (sel, text) => [...host.querySelectorAll(sel)].find(el => el.textContent.includes(text))
const type = (el, value) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const idea = (id, extra = {}) => ({ id, title: 'Idée ' + id, body: '', at: Date.now() - 60000, author: 'Sam Demo', mine: false, votes: 0, voted: false, status: 'open', ...extra })

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset?.()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async box => {
  api.loadIdeas.mockResolvedValue({ github: false, admin: false, limits: { TITLE_MAX: 80, BODY_MAX: 1000 }, ...box })
  act(() => root.render(<Ideas />))
  await flush()
}

describe('Ideas', () => {
  it('lists the box with names and votes, and +1s in one tap', async () => {
    await mount({ ideas: [idea('a', { votes: 2, body: 'Avec un son' }), idea('b', { mine: true })] })
    expect(host.textContent).toContain('Idée a')
    expect(host.textContent).toContain('Avec un son')
    expect(host.textContent).toContain('Sam Demo')
    expect(host.textContent).toContain('You')
    api.voteIdea.mockResolvedValue(idea('a', { votes: 3, voted: true }))
    await act(async () => { byText('button', '+1 2').click() })
    await flush()
    expect(api.voteIdea).toHaveBeenCalledWith('a')
    expect(byText('button', '+1 3').getAttribute('aria-pressed')).toBe('true')
  })

  it('warns that an idea goes public before sending it, when GitHub is on', async () => {
    await mount({ ideas: [], github: true })
    expect(host.textContent).toContain('published anonymously on the project’s public GitHub')
    expect(host.textContent).toContain('No idea yet. Be the first!')
  })

  it('sends an idea and shows it at the top; the button waits for a real title', async () => {
    await mount({ ideas: [idea('a')] })
    const send = byText('button', 'Send')
    expect(send.disabled).toBe(true)
    type(host.querySelector('input'), 'Minuteur de repos')
    type(host.querySelector('textarea'), 'plus fort')
    api.sendIdea.mockResolvedValue(idea('n', { title: 'Minuteur de repos', mine: true }))
    await act(async () => { byText('button', 'Send').click() })
    await flush()
    expect(api.sendIdea).toHaveBeenCalledWith('Minuteur de repos', 'plus fort')
    expect(host.querySelectorAll('li')[0].textContent).toContain('Minuteur de repos')
    expect(host.querySelector('input').value).toBe('')
  })

  it('says the daily limit plainly', async () => {
    await mount({ ideas: [] })
    type(host.querySelector('input'), 'Encore une idée')
    api.sendIdea.mockRejectedValue({ status: 429, data: { code: 'per-day' } })
    await act(async () => { byText('button', 'Send').click() })
    await flush()
    expect(host.textContent).toContain('Five ideas a day at most. Come back tomorrow.')
  })

  it('offers delete on one’s own idea only, and the status buttons to the admin only', async () => {
    await mount({ ideas: [idea('a'), idea('b', { mine: true })] })
    expect(host.querySelectorAll('li')[0].textContent).not.toContain('Delete')
    expect(host.querySelectorAll('li')[1].textContent).toContain('Delete')
    expect(host.textContent).not.toContain('Implemented')
    act(() => root.unmount()); root = createRoot(host)
    await mount({ ideas: [idea('a')], admin: true })
    api.setIdeaStatus.mockResolvedValue(idea('a', { status: 'done' }))
    await act(async () => { byText('button', 'Implemented').click() })
    await flush()
    expect(api.setIdeaStatus).toHaveBeenCalledWith('a', 'done')
    expect(host.querySelector('.tag').textContent).toBe('Implemented')
  })
})

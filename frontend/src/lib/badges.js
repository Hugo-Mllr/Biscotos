// The badges of the profile (api/social/badges.js): which one is new since the last look, and
// which tier comes next. Pure, so the case in Stats stays a thin view.
import { tn } from './i18n.js'

/** 'sessions:50' for { id: 'sessions', tier: 50 }. */
export const badgeKey = b => b.id + ':' + b.tier

export function badgeLabel(b) {
  return b.id === 'sessions' ? tn('{0} session', '{0} sessions', b.tier)
    : b.id === 'streak' ? tn('{0} week', '{0} weeks', b.tier)
    : tn('{0} record', '{0} records', b.tier)
}

/** The badges of `now` that `seen` (an array of keys, or null the first time) does not hold.
 *  The first look is never a celebration: someone with 120 sessions has not just earned them. */
export function newBadges(seen, now) {
  if (!Array.isArray(seen)) return []
  return now.filter(b => !seen.includes(badgeKey(b)))
}

/** The next tier of each kind above the one reached: [{ id, tier }], kinds with nothing left left out. */
export function nextBadges(badges, tiers) {
  const out = []
  for (const id of ['sessions', 'streak', 'records']) {
    const have = badges.find(b => b.id === id)?.tier || 0
    const next = (tiers?.[id] || []).find(t => t > have)
    if (next) out.push({ id, tier: next })
  }
  return out
}

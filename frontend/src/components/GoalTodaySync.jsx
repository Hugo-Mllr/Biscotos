// Biscotos: keeps the day's calculated goal on the server (profile.goalToday) so the iPhone widget can
// show it. It draws nothing. One write when the goal of today changes, none otherwise; a failed write
// is tried again the next time the screen shows a goal, never reported.
import { useEffect, useRef } from 'react'
import { goalTodayPatch } from '../lib/body.js'
import { todayISO } from '../lib/format.js'
import * as napi from '../lib/nutrition-api.js'

export default function GoalTodaySync({ profile, auto, goals, day }) {
  const sent = useRef('')
  const patch = goalTodayPatch({ profile, auto, goals, day, today: todayISO() })
  const key = patch ? JSON.stringify(patch) : ''
  useEffect(() => {
    if (!key || sent.current === key) return
    sent.current = key
    Promise.resolve(napi.saveSettings({ profile: JSON.parse(key) })).catch(() => { sent.current = '' })
  }, [key])
  return null
}

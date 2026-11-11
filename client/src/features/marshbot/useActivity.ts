// Counts how long the assigned engineer really works in one place of an assessment, and which
// content they saw (AS-06 Architecture 5, AC 8 and 10). Called with one line by the workspace
// tab (useAssessmentWorkflow), Checklist and ReviewWorkspace. Sends totals to the gateway's
// /api/assessments/<ref>/assistant/activity with sendBeacon, which survives closing the page.
import { useEffect } from 'react'
import { ACTIVITY_IDLE_MS, ACTIVITY_TICK_MS, SEEN_MS, SEEN_RATIO } from './settings'

// The browser events that count as doing something.
const INTERACTIONS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel'] as const

/** Tracks `place` (e.g. `tab:review`, `checklist`, `section:9`) of assessment `reference` while
    `active` (only the assigned engineer is tracked; an admin's viewing is never counted).
    `seen`: also count elements marked `data-activity-key="<id>"` once they stay on screen. */
export function useActivity(reference: string | null, place: string, active = true, seen = false) {
  useEffect(() => {
    if (!reference || !active) return
    const url = `/api/assessments/${encodeURIComponent(reference)}/assistant/activity`
    // a. State since the last send.
    let engagedMs = 0
    let lastTick = Date.now()
    // Starts at "long ago": opening the place is not yet doing something in it.
    let lastInteraction = -Infinity
    // Opening a place is itself worth one record (e.g. `review`), even with no time in it.
    let touched = true
    const onScreen = new Map<string, number>() // key -> when it came on screen (while visible)
    const total = new Map<string, number>() // key -> ms on screen since the last send
    const visible = () => document.visibilityState !== 'hidden'

    // b. Engaged time: each tick adds the time since the last one, if visible and recently active.
    const tick = () => {
      const now = Date.now()
      if (visible() && now - lastInteraction <= ACTIVITY_IDLE_MS) engagedMs += now - lastTick
      lastTick = now
    }
    const timer = window.setInterval(tick, ACTIVITY_TICK_MS)
    const touch = () => (lastInteraction = Date.now())
    INTERACTIONS.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }))

    // c. Content seen: time on screen is added up per key; only keys that reach SEEN_MS are sent.
    const settle = (key: string, now: number) => {
      const since = onScreen.get(key)
      if (since !== undefined) total.set(key, (total.get(key) ?? 0) + now - since)
    }
    const observer =
      seen && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const now = Date.now()
              for (const entry of entries) {
                const key = (entry.target as HTMLElement).dataset.activityKey
                if (!key) continue
                if (entry.isIntersecting && entry.intersectionRatio >= SEEN_RATIO) {
                  if (visible() && !onScreen.has(key)) onScreen.set(key, now)
                } else {
                  settle(key, now)
                  onScreen.delete(key)
                }
              }
            },
            { threshold: [0, SEEN_RATIO, 1] },
          )
        : null
    // Items load after the screen opens, so new marked elements are picked up as they appear.
    const watch = () =>
      document.querySelectorAll('[data-activity-key]').forEach((el) => observer?.observe(el))
    watch()
    const mutations = observer ? new MutationObserver(watch) : null
    mutations?.observe(document.body, { childList: true, subtree: true })

    // d. Send and reset: on hiding the tab, closing the page and leaving the place.
    const flush = () => {
      tick()
      const now = Date.now()
      for (const key of onScreen.keys()) {
        settle(key, now)
        onScreen.set(key, now) // still showing: keeps counting from now
      }
      const seenMs: Record<string, number> = {}
      total.forEach((ms, key) => ms >= SEEN_MS && (seenMs[key] = Math.round(ms)))
      if (!touched && !engagedMs && !Object.keys(seenMs).length) return
      const body = JSON.stringify({
        places: [{ place, engagedMs: Math.round(engagedMs), seen: seenMs }],
      })
      // Without a beacon (an old browser) nothing is sent, and the totals are simply lost.
      navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))
      engagedMs = 0
      touched = false
      total.clear()
    }
    // A hidden tab stops the clocks; coming back restarts them for what is still on screen.
    const onVisibility = () => {
      if (!visible()) {
        flush()
        onScreen.clear()
        return
      }
      lastTick = Date.now()
      observer?.takeRecords()
      document.querySelectorAll('[data-activity-key]').forEach((el) => {
        observer?.unobserve(el)
        observer?.observe(el) // re-reports whether it is showing
      })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)

    return () => {
      flush()
      window.clearInterval(timer)
      INTERACTIONS.forEach((e) => window.removeEventListener(e, touch, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      observer?.disconnect()
      mutations?.disconnect()
    }
  }, [reference, place, active, seen])
}

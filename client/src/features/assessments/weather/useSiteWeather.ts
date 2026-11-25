// Keeps a site's weather current while it is on screen (CP-62 AC7): read on open, again 10
// minutes after each answer, and at once on Refresh. A hidden tab skips its turn and reads as
// soon as it is shown again. The clock ticks every minute so a reading turns stale on screen
// (AC6). A failed read never keeps the old reading on show: it becomes "Weather unavailable"
// with when the last good reading was taken. Used by SiteWeatherPanel.tsx and RowWeather.tsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSiteWeather, type SiteWeather } from './api'

export const REFRESH_MS = 10 * 60_000
const TICK_MS = 60_000

export type SiteWeatherState = {
  // Null until the first answer.
  weather: SiteWeather | null
  // A read is on its way (the first, a refresh, or the 10-minute one).
  refreshing: boolean
  refresh: () => void
  now: Date
}

/** Returns the weather at the assessment's site, kept current; nothing is read without a reference. */
export function useSiteWeather(reference: string | null): SiteWeatherState {
  // Each read is a round: the timer, Refresh and a tab shown again start the next one.
  const [round, setRound] = useState(0)
  const [answer, setAnswer] = useState<{ reference: string; round: number; weather: SiteWeather }>()
  const [now, setNow] = useState(() => new Date())
  // The last good reading's time and zone, for "Weather unavailable" when the gateway is down.
  const lastGood = useRef<{ reference: string; at: string; timeZone: string | null }>(null)
  // A turn that fell while the tab was hidden.
  const due = useRef(false)

  useEffect(() => {
    if (!reference) return
    const controller = new AbortController()
    const last = lastGood.current?.reference === reference ? lastGood.current : null
    const settle = (weather: SiteWeather) => {
      if (controller.signal.aborted) return
      setAnswer({ reference, round, weather })
      setNow(new Date())
    }
    fetchSiteWeather(reference, controller.signal).then(
      (fresh) => {
        if (fresh.status === 'ok')
          lastGood.current = {
            reference,
            at: fresh.reading.observedAt,
            timeZone: fresh.reading.timeZone,
          }
        // The gateway forgets readings when it restarts; this page may still know the last one.
        settle(
          fresh.status === 'unavailable' && !fresh.lastReadingAt && last
            ? { ...fresh, lastReadingAt: last.at, timeZone: last.timeZone }
            : fresh,
        )
      },
      () =>
        settle({
          status: 'unavailable',
          lastReadingAt: last?.at ?? null,
          timeZone: last?.timeZone ?? null,
          source: null,
        }),
    )
    return () => controller.abort()
  }, [reference, round])

  // The next read, 10 minutes after this answer; held while the tab is hidden.
  useEffect(() => {
    if (!answer) return
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') due.current = true
      else setRound((r) => r + 1)
    }, REFRESH_MS)
    return () => window.clearTimeout(timer)
  }, [answer])

  useEffect(() => {
    const shown = () => {
      if (document.visibilityState !== 'visible') return
      setNow(new Date())
      if (!due.current) return
      due.current = false
      setRound((r) => r + 1)
    }
    const tick = window.setInterval(() => setNow(new Date()), TICK_MS)
    document.addEventListener('visibilitychange', shown)
    return () => {
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [])

  const mine = reference && answer?.reference === reference ? answer : undefined
  const refreshing = !!reference && mine?.round !== round
  const refresh = useCallback(() => {
    due.current = false
    setRound((r) => r + 1)
  }, [])
  return { weather: mine?.weather ?? null, refreshing, refresh, now }
}

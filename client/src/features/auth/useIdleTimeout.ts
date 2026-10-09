// F-07 AC2: signs the browser out after 15 minutes with no user activity.
// Called by Workspace in App.tsx (so it only runs while signed in).
import { useEffect, useRef } from 'react'

// Must match SESSION_TTL_SECONDS in server/src/services/auth.service.ts.
export const IDLE_LIMIT_MS = 15 * 60 * 1000

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const

// Every activity event restarts the clock. Capture phase, because scroll
// events from inner panels don't bubble up to the document. Without this timer, an unattended
// screen would stay open until the next request got a 401 from the gateway.
export function useIdleTimeout(onIdle: () => void, limitMs = IDLE_LIMIT_MS): void {
  // A ref, so a new onIdle function each render doesn't restart the clock.
  const latest = useRef(onIdle)
  useEffect(() => {
    latest.current = onIdle
  })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const restart = () => {
      clearTimeout(timer)
      timer = setTimeout(() => latest.current(), limitMs)
    }
    restart()
    ACTIVITY_EVENTS.forEach((name) =>
      document.addEventListener(name, restart, { passive: true, capture: true }),
    )
    return () => {
      clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((name) =>
        document.removeEventListener(name, restart, { capture: true }),
      )
    }
  }, [limitMs])
}

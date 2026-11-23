// The user's background work (F-11), read from the gateway for the header's
// activity icon, and kept up to date: every 5 seconds while something is
// queued or running, every 30 seconds otherwise (new work usually starts from
// the person's own action, which moves no notification count), and at once
// when asked (the popover opening) or when the tab is shown again. A hidden
// tab doesn't read. The route doesn't extend the session, so this polling
// can't keep an idle tab signed in. Calls api.ts.
//
// A failed read keeps the last rows: the icon is a glance, never an error message.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getBackgroundWork, type BackgroundWorkRow } from './api'

const ACTIVE_MS = 5_000
const IDLE_MS = 30_000

const active = (rows: BackgroundWorkRow[]) =>
  rows.some((r) => r.state === 'running' || r.state === 'queued')

export function useBackgroundWork(): { rows: BackgroundWorkRow[]; reload: () => void } {
  const [rows, setRows] = useState<BackgroundWorkRow[]>([])
  // The last rows read, for choosing the next interval after a failed read too.
  const last = useRef<BackgroundWorkRow[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlight = useRef<AbortController | null>(null)

  const reload = useCallback(function read() {
    clearTimeout(timer.current)
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    getBackgroundWork(controller.signal)
      .then((work) => {
        // An answer without a list is treated as a failed read, never a crash in the header.
        if (!Array.isArray(work?.rows)) return
        last.current = work.rows
        setRows(work.rows)
      })
      .catch(() => {})
      .finally(() => {
        if (controller.signal.aborted || document.visibilityState === 'hidden') return
        timer.current = setTimeout(read, active(last.current) ? ACTIVE_MS : IDLE_MS)
      })
  }, [])

  useEffect(() => {
    reload()
    const onVisible = () => document.visibilityState === 'visible' && reload()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer.current)
      inFlight.current?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])

  return { rows, reload }
}

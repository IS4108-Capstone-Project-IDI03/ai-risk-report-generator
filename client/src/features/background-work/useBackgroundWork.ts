// The user's background work (F-11), read from the gateway for the header's
// activity icon. Calls api.ts. A failed read keeps the last rows: the icon is
// a glance, never an error message.
import { useEffect, useState } from 'react'
import { getBackgroundWork, type BackgroundWorkRow } from './api'

export function useBackgroundWork(): { rows: BackgroundWorkRow[] } {
  const [rows, setRows] = useState<BackgroundWorkRow[]>([])
  useEffect(() => {
    const controller = new AbortController()
    getBackgroundWork(controller.signal)
      // An answer without a list is treated as a failed read, never a crash in the header.
      .then((work) => Array.isArray(work?.rows) && setRows(work.rows))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return { rows }
}

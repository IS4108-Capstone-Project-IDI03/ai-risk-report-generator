import { useCallback, useEffect, useState } from 'react'
import { GatewayError } from '../assessments/api'
import { getClientPage, type ClientPage } from './api'

// Why the page could not load: refused (403, the engineer has no assessment
// for the client), unknown (404), or the gateway unreachable.
export type ClientPageError = { status: number | null; message: string }

// The client page's data (CP-18), for the client open now, or null when no
// client page is open. reload reads it again after a change. What was loaded
// for another client is never shown for this one.
export function useClientPage(id: string | null) {
  const [loaded, setLoaded] = useState<{ id: string; page: ClientPage } | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: ClientPageError } | null>(null)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    getClientPage(id, controller.signal).then(
      (page) => {
        setLoaded({ id, page })
        setFailed(null)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setFailed({
          id,
          error: {
            status: error instanceof GatewayError ? error.status : null,
            message:
              error instanceof GatewayError && error.status !== null
                ? error.message
                : 'The gateway could not be reached. Check your connection and try again.',
          },
        })
      },
    )
    return () => controller.abort()
  }, [id])

  const reload = useCallback(async () => {
    if (!id) return
    const page = await getClientPage(id).catch(() => null)
    if (page) setLoaded({ id, page })
  }, [id])

  return {
    page: loaded?.id === id ? loaded.page : null,
    error: failed?.id === id ? failed.error : null,
    reload,
  }
}

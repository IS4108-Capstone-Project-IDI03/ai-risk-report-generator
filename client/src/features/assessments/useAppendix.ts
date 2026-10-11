// Appendix A's photos for one assessment (GN-07). Used by
// components/AppendixPhotos.tsx. Calls the gateway's /appendix routes (api.ts).
import { useEffect, useRef, useState } from 'react'
import { GatewayError, getAppendix, saveAppendix, type AppendixList } from './api'

type Entry = { photoId: string; caption: string }

// The appendix as it will be once `photos` is saved, so a change shows at once.
function applied(a: AppendixList, photos: Entry[]): AppendixList {
  const byId = new Map(a.available.map((p) => [p.photoId, p]))
  const chosen = new Set(photos.map((p) => p.photoId))
  return {
    selected: photos.flatMap((p) => {
      const photo = byId.get(p.photoId)
      return photo ? [{ ...photo, caption: p.caption }] : []
    }),
    available: a.available.map((p) => ({ ...p, selected: chosen.has(p.photoId) })),
  }
}

// save shows the change at once, then sends the whole ordered list. Saves go
// one after another, so a quick caption edit then a click can't arrive out of
// order and leave the older list saved. Only the last save's answer is shown.
export function useAppendix(reference: string) {
  const [appendix, setAppendix] = useState<AppendixList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    getAppendix(reference, controller.signal).then(
      // Only an appendix from the gateway counts; anything else reads as not loaded.
      (list) => setAppendix(Array.isArray(list?.selected) ? list : null),
      (e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Appendix A could not be loaded.')
      },
    )
    return () => controller.abort()
  }, [reference])

  const save = (photos: Entry[]) => {
    const call = ++latest.current
    setError(null)
    setAppendix((a) => a && applied(a, photos))
    queue.current = queue.current.then(() =>
      saveAppendix(reference, photos).then(
        (saved) => {
          if (call === latest.current) setAppendix(saved)
        },
        (e: unknown) => {
          if (call === latest.current)
            setError(e instanceof GatewayError ? e.message : 'Appendix A was not saved.')
        },
      ),
    )
  }

  return { appendix, error, save }
}

// Loads one gateway answer for a usage screen (EV-04) and reloads when `key`
// changes. A stale answer is dropped (abort), otherwise a slow reply could
// overwrite a newer query's numbers. While reloading, the last answer stays on
// screen (dimmed by the screen), so the layout does not jump.
import { useEffect, useState } from 'react'

export function useLoad<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): { data: T | null; error: unknown; loading: boolean; retry: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  // The key the current answer (or error) is for; loading until it matches.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return
        setData(answer)
        setError(null)
        setLoadedKey(`${key}#${attempt}`)
      },
      (e: unknown) => {
        if (controller.signal.aborted) return
        setError(e)
        setLoadedKey(`${key}#${attempt}`)
      },
    )
    return () => controller.abort()
    // `load` is rebuilt each render; `key` says when the query really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  return {
    data,
    error,
    loading: loadedKey !== `${key}#${attempt}`,
    retry: () => setAttempt((n) => n + 1),
  }
}

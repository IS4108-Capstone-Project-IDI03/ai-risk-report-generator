import { useEffect, useState } from 'react'
import { GatewayError, startCaptureSession, type CaptureSession } from './api'

export type CaptureSessionState =
  | { status: 'starting' }
  | ({ status: 'live' } & CaptureSession)
  // httpStatus is null when the gateway could not be reached at all.
  | { status: 'unavailable'; httpStatus: number | null }

// Starts or resumes the assessment's capture session each time capture opens
// (CP-01). The gateway returns the session in progress rather than starting
// another, so reopening is always safe. Returns null while capture is closed.
export function useCaptureSession(reference: string, open: boolean) {
  const [result, setResult] = useState<CaptureSessionState | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    startCaptureSession(reference, controller.signal).then(
      (capture) => {
        if (!controller.signal.aborted) setResult({ status: 'live', ...capture })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const httpStatus = error instanceof GatewayError ? error.status : null
        setResult({ status: 'unavailable', httpStatus })
      },
    )
    return () => {
      controller.abort()
      setResult(null)
    }
  }, [reference, open, attempt])

  const state: CaptureSessionState | null = open ? (result ?? { status: 'starting' }) : null
  return { state, retry: () => setAttempt((count) => count + 1) }
}

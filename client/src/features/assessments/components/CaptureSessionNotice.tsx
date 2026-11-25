import { Button, Callout } from '../../../design-system'
import type { CaptureSessionState } from '../useCaptureSession'

// What to do when no capture session started, in one plain line (no codes or service names).
function fixFor(httpStatus: number | null): string {
  if (httpStatus === null) return 'Can’t reach the server. Check your connection, then try again.'
  if (httpStatus === 404)
    return 'This assessment isn’t on the server any more. Go back to Assessments and open it again.'
  return 'The server had a problem. Try again in a moment.'
}

// Shown only when no capture session could be started: nothing can be saved or recorded until
// one is, and nothing is kept on this device instead. Try again starts the session again. A
// session starting or running needs no notice: Save waits while it starts.
export function CaptureSessionNotice({
  capture,
  onRetry,
}: {
  capture: CaptureSessionState | null
  onRetry: () => void
}) {
  if (capture?.status !== 'unavailable') return null
  return (
    <div role="alert">
      <Callout
        tone="danger"
        title="Can’t save right now"
        actions={
          <Button variant="secondary" size="sm" iconLeft="refresh-cw" onClick={onRetry}>
            {'Try again'}
          </Button>
        }
      >
        {fixFor(capture.httpStatus)}
      </Callout>
    </div>
  )
}

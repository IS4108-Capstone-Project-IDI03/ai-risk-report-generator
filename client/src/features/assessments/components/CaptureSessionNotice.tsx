import { Button, Callout } from '../../../design-system'
import type { CaptureSessionState } from '../useCaptureSession'

// Why no capture session started, and what to do, in plain words (no codes or service names).
function unavailableCause(
  httpStatus: number | null,
  reference: string,
): { cause: string; next: string } {
  if (httpStatus === null)
    return { cause: "the server can't be reached", next: 'Check your connection, then try again.' }
  if (httpStatus === 404)
    return {
      cause: `${reference} isn't saved on the server`,
      next: 'Open a saved assessment or create one, then try again.',
    }
  return { cause: 'the server had a problem', next: 'Try again in a moment.' }
}

// Says so only when no capture session could be started, as saves then stay
// on this device. A session starting or running needs no notice: the header
// names the assessment, the navigation's live light marks the session, and
// Save waits while it starts.
export function CaptureSessionNotice({
  capture,
  reference,
  onRetry,
}: {
  capture: CaptureSessionState | null
  reference: string
  onRetry: () => void
}) {
  if (capture?.status !== 'unavailable') return null
  const { cause, next } = unavailableCause(capture.httpStatus, reference)
  return (
    <div role="status">
      <Callout
        tone="warning"
        title="Showing sample data"
        actions={
          <Button variant="secondary" size="sm" iconLeft="refresh-cw" onClick={onRetry}>
            {'Try again'}
          </Button>
        }
      >
        {'No capture session was started: '}
        {cause}
        {`. Observations saved now stay on this device. ${next}`}
      </Callout>
    </div>
  )
}

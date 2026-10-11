import type * as React from 'react'
import { Button, Callout } from '../../../design-system'
import type { CaptureSessionState } from '../useCaptureSession'

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

function unavailableCause(
  httpStatus: number | null,
  reference: string,
): { cause: React.ReactNode; next: string } {
  if (httpStatus === null)
    return { cause: 'the gateway could not be reached', next: 'Start the gateway, then try again.' }
  if (httpStatus === 404)
    return {
      cause: (
        <>
          <span style={mono}>{reference}</span>
          {' is not on the server'}
        </>
      ),
      next: 'Seed the sample assessment or create a new one, then try again.',
    }
  return {
    cause: (
      <>
        {'the gateway returned '}
        <span style={mono}>{`HTTP ${httpStatus}`}</span>
      </>
    ),
    next: 'Check the gateway logs, then try again.',
  }
}

// Says so only when no capture session could be started, as saves then stay
// in this demo. A session starting or running needs no notice: the header
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
        {`. Observations saved here stay in this demo. ${next}`}
      </Callout>
    </div>
  )
}

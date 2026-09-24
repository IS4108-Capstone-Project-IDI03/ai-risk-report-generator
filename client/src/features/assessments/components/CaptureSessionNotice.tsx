import type * as React from 'react'
import { Button, Callout } from '../../../design-system'
import { formatDayTime } from '../format'
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

export function CaptureSessionNotice({
  capture,
  reference,
  onRetry,
}: {
  capture: CaptureSessionState | null
  reference: string
  onRetry: () => void
}) {
  if (!capture) return null
  let notice: React.ReactNode
  if (capture.status === 'starting') {
    notice = (
      <Callout tone="info" title="Starting capture session">
        {'Opening the capture session for '}
        <span style={mono}>{reference}</span>
        {'.'}
      </Callout>
    )
  } else if (capture.status === 'live') {
    const { assessment, session, resumed } = capture
    notice = (
      <Callout
        tone={resumed ? 'info' : 'success'}
        title={resumed ? 'Capture session resumed' : 'Capture session started'}
      >
        {(assessment.site?.name ?? 'Site not recorded') + ' · ' + assessment.client + ' · '}
        <span style={mono}>{assessment.reference}</span>
        {'. Started '}
        <span style={mono}>{formatDayTime(new Date(session.startedAt))}</span>
        {'. Saved observations are not yet stored on the server.'}
      </Callout>
    )
  } else {
    const { cause, next } = unavailableCause(capture.httpStatus, reference)
    notice = (
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
    )
  }
  return <div role="status">{notice}</div>
}

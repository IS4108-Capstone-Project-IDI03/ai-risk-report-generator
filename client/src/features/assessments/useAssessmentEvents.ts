// The live connection to one assessment (AS-06, ADR .local-docs/adr/0002): the gateway
// pushes "this changed" events, so no screen polls. Used by MarshBot (`brief`) and by
// Generation and Review (`brief` and `drafting`, GN-13) and the Observations tab (`observations`, CP-24).
// Listens to server/src/routes/assistant-events.routes.ts.
import { useEffect, useRef } from 'react'

type AssessmentEvent = 'brief' | 'drafting' | 'observations'

/** Calls `onChange` whenever the gateway pushes one of `events` for `reference`, all on one
    stream, and after every reconnect, since a change made while the stream was down sent no
    push. The first connect is skipped unless `firstConnect` is set: a caller that has just
    read its data needs no second read, but one that must not miss a push sent before the
    stream opened asks for it. */
export function useAssessmentEvents(
  reference: string,
  events: AssessmentEvent | AssessmentEvent[],
  onChange: () => void,
  { firstConnect = false }: { firstConnect?: boolean } = {},
) {
  // Kept in a ref so a new callback doesn't reopen the stream.
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  // A string, so a new array with the same names doesn't reopen the stream.
  const names = [events].flat().join(',')
  useEffect(() => {
    // jsdom and very old browsers have no EventSource: the screen then just doesn't update live.
    // An empty reference means the caller has no assessment open, so there is nothing to follow.
    if (!reference || typeof EventSource === 'undefined') return
    const source = new EventSource(
      `/api/assessments/${encodeURIComponent(reference)}/assistant/events`,
    )
    let connected = false
    for (const name of names.split(',')) source.addEventListener(name, () => latest.current())
    // Without the skip, a screen that has just read its data would read it twice.
    source.addEventListener('open', () => {
      if (connected || firstConnect) latest.current()
      connected = true
    })
    // EventSource retries a dropped stream by itself. A refused one (401 once the session
    // is gone) is CLOSED for good: stop, so it never hammers the gateway.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close()
    }
    return () => source.close()
  }, [reference, names, firstConnect])
}

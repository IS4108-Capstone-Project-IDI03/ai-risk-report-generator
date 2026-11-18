// The assessment's drafting state, kept live (GN-13). Reads it once, then again each
// time the gateway pushes that drafting moved on (`drafting`) or that the engineer's input
// changed (`brief`: a recording finished, an OFI accepted, figures entered), so a refresh
// or a return shows the same thing. Used by the Generation screen and by Review.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAssessmentEvents } from '../useAssessmentEvents'
import { getGeneration } from './api'
import type { GenerationDto } from './types'

/** Returns the drafting state (null until read), a load error, and `setGeneration` for a
    state a call has just returned. */
export function useGeneration(reference: string) {
  const [generation, setState] = useState<GenerationDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The read in flight. A newer read, or a state a POST returned, cancels it: without this
  // an older reply landing last would put a finished part back to "drafting", and no later
  // push would come to correct it.
  const inFlight = useRef<AbortController | null>(null)

  const read = useCallback(() => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    getGeneration(reference, controller.signal).then(
      (state) => {
        if (controller.signal.aborted) return
        setState(state)
        setLoadError(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : 'The drafting progress could not be loaded.',
          )
      },
    )
  }, [reference])

  useEffect(() => {
    read()
    return () => inFlight.current?.abort()
  }, [read])

  // Also on the first connect: a push sent between the read above and the stream opening
  // would otherwise be missed.
  useAssessmentEvents(reference, ['brief', 'drafting'], read, { firstConnect: true })

  // A state a call just returned is newer than any read still on its way.
  const setGeneration = useCallback((state: GenerationDto) => {
    inFlight.current?.abort()
    setState(state)
  }, [])

  return { generation, setGeneration, loadError }
}

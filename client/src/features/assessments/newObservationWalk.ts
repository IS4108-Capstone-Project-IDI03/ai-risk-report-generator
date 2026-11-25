// F-12: what the New Observation form does for its walkthrough ("Add an observation"): opens the
// location picker for step 1, types the sample note, and takes over when there is no microphone. Called by screens/SiteObservation.tsx.
// Calls the walkthrough player (tell, next) and site-walk/walkSteps.ts.
import { useEffect, useRef } from 'react'
import { useWalkthroughs } from '../walkthrough/engine'
import { next, tell } from '../walkthrough/player'
import { signal } from '../walkthrough/signals'
import { useWalkStep } from '../site-walk/walkSteps'
import { NO_MICROPHONE } from './new-observation.walkthroughs'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'

// The sentence the walkthrough uses (its words quote it).
export const SAMPLE_SENTENCE = 'Pallets are stored in front of the fire hose reel.'

/** Drives the form for the walkthrough playing now; returns nothing. */
export function useNewObservationWalk(v: AssessmentWorkflow): void {
  const add = useWalkStep('new-observation')
  // The workflow makes new functions on every render; the effects below read the latest ones from
  // here, so each runs once per step and not on every render (setting the note would loop).
  const form = useRef(v)
  useEffect(() => {
    form.current = v
  })
  const error = v.fVoiceError
  const state = useRef({ pickerOpened: false, micError: error })

  // a. Step 1 points at the open picker. Without this a replay (the location is already chosen, so
  // the picker is shut) would find nothing to highlight and the walkthrough would stop.
  useEffect(() => {
    if (add !== 1) return void (state.current.pickerOpened = false)
    if (state.current.pickerOpened) return
    state.current.pickerOpened = true
    if (!form.current.locSheetOpen) form.current.openLocations()
  }, [add])

  // c. No microphone (or it was refused) while step 4 waits for a recording: MarshBot says so, the
  // sentence is typed into the Note tab for the person, and the walkthrough goes on after OK. Only
  // an error that appeared during the step counts, not one left over from before it. It goes on
  // two steps (past "That's your recording": there is none), so the later steps keep their numbers.
  useEffect(() => {
    if (add !== 4) return void (state.current.micError = error)
    if (!error || error === state.current.micError) return
    state.current.micError = error
    form.current.modeNote()
    form.current.setFNote(SAMPLE_SENTENCE)
    tell(NO_MICROPHONE, 'concerned', () => {
      next(true)
      next(true)
    })
  }, [add, error])
}

/** Tells the walkthroughs an observation was saved on `reference`; the practice assessment's saves do not count toward the site walk offer. */
export function observationSaved(reference: string): void {
  signal('observation-saved')
  if (reference !== useWalkthroughs.getState().record.practice) signal('observation-saved-by-hand')
}

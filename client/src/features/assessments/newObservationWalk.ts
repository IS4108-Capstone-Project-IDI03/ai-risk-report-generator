// F-12: what the New Observation form does for its two walkthroughs ("Add an observation" and "Use
// note codes and Split note"): opens the location picker for step 1 of the first (and keeps it
// shut for the second), types the sample note, and takes over when there is no microphone. Called by screens/SiteObservation.tsx.
// Calls the walkthrough player (tell, next) and site-walk/walkSteps.ts.
import { useEffect, useRef } from 'react'
import { useWalkthroughs } from '../walkthrough/engine'
import { next, tell } from '../walkthrough/player'
import { signal } from '../walkthrough/signals'
import { useWalkStep } from '../site-walk/walkSteps'
import { NO_MICROPHONE } from './new-observation.walkthroughs'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'

// The sentence both walkthroughs use (the words quote it).
export const SAMPLE_SENTENCE = 'Pallets are stored in front of the fire hose reel.'
// Coded lines are sorted without the AI; the last line has no code, so the AI has one to sort.
export const SAMPLE_NOTE = [
  'F: ' + SAMPLE_SENTENCE,
  'IR: When was the sprinkler system last tested?',
  'Move the pallets at least 1 m clear of the hose reel.',
].join('\n')

/** Drives the form for the walkthrough playing now; returns nothing. */
export function useNewObservationWalk(v: AssessmentWorkflow): void {
  const add = useWalkStep('new-observation')
  const split = useWalkStep('split-note')
  // The workflow makes new functions on every render; the effects below read the latest ones from
  // here, so each runs once per step and not on every render (setting the note would loop).
  const form = useRef(v)
  useEffect(() => {
    form.current = v
  })
  const error = v.fVoiceError
  const state = useRef({ pickerOpened: false, noteTyped: false, micError: error })

  // a. Step 1 points at the open picker. Without this a replay (the location is already chosen, so
  // the picker is shut) would find nothing to highlight and the walkthrough would stop.
  useEffect(() => {
    if (add !== 1) return void (state.current.pickerOpened = false)
    if (state.current.pickerOpened) return
    state.current.pickerOpened = true
    if (!form.current.locSheetOpen) form.current.openLocations()
  }, [add])

  // b0. The form opens "Where are you?" by itself while no location is chosen. Only "Add an
  // observation" step 1 wants it open: for Split note it would cover the note box (and fill a phone's screen).
  const pickerOpen = v.locSheetOpen
  useEffect(() => {
    if (split && pickerOpen) form.current.closeLocations()
  }, [split, pickerOpen])

  // b. Split note: the form is given its sample note as the walkthrough starts, on the Note tab.
  useEffect(() => {
    if (split !== 1) return void (state.current.noteTyped = false)
    if (state.current.noteTyped) return
    state.current.noteTyped = true
    form.current.modeNote()
    form.current.setFNote(SAMPLE_NOTE)
  }, [split])

  // c. No microphone (or it was refused) while step 3 waits for a recording: MarshBot says so, the
  // sentence is typed into the Note tab for the person, and the walkthrough goes on after OK. Only
  // an error that appeared during the step counts, not one left over from before it.
  useEffect(() => {
    if (add !== 3) return void (state.current.micError = error)
    if (!error || error === state.current.micError) return
    state.current.micError = error
    form.current.modeNote()
    form.current.setFNote(SAMPLE_SENTENCE)
    tell(NO_MICROPHONE, 'concerned', () => next(true))
  }, [add, error])
}

/** Tells the walkthroughs an observation was saved on `reference`; the practice assessment's saves do not count toward the site walk offer. */
export function observationSaved(reference: string): void {
  signal('observation-saved')
  if (reference !== useWalkthroughs.getState().record.practice) signal('observation-saved-by-hand')
}

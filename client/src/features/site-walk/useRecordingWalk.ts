// F-12: what the site walk recorder tells the "Record a site walk" walkthrough, and does for it when
// there is no microphone. Called by screens/Recording.tsx. Calls walkSteps.ts and the walkthrough player.
import { useEffect, useRef } from 'react'
import { useAssessmentEvents } from '../assessments/useAssessmentEvents'
import { askFor, next } from '../walkthrough/player'
import { signal } from '../walkthrough/signals'
import type { WalkStatus } from './api'
import type { Phase } from './useWalkRecorder'
import { useSignalAtStep, useWalkStep } from './walkSteps'
import { NO_MICROPHONE_WALK } from './walkthroughs'

// The walkthrough's sentence, typed into the note box when the microphone cannot be used.
export const SAMPLE_WALK_NOTE =
  'Block A, Level 1, loading bay. Pallets are stored in the fire lane.'
// The name given to the practice walk (the words say it is already named).
export const PRACTICE_WALK_NAME = 'Practice walk'

/** Raises the recorder's signals for the walkthrough; returns whether it is playing (so the screen names the walk for the person). */
export function useRecordingWalk(opts: {
  phase: Phase
  finished: boolean
  status: WalkStatus | undefined
  micProblem: string | null
  typeSample: (text: string) => void
  reference: string
  reread: () => void
}): boolean {
  const { phase, finished, status, micProblem, typeSample, reference, reread } = opts
  const at = useWalkStep('site-walk')
  // The try-it waits on the finished walk being read. The gateway pushes when that is done (the
  // MarshBot re-check that follows it), so the walk is read again then: no polling. Only while the
  // walkthrough plays, so a real walk's "Walk finished" screen stays as it was. `firstConnect`
  // covers a push sent before the stream opened.
  const reading = at > 0 && finished && status !== 'ready' && status !== 'failed'
  useAssessmentEvents(reading ? reference : '', 'brief', reread, { firstConnect: true })
  const latest = useRef(typeSample)
  useEffect(() => {
    latest.current = typeSample
  })
  const seen = useRef(micProblem)

  // a. The microphone is open and the clock is running: step 2 moves its highlight to Save recording.
  useEffect(() => {
    if (phase === 'recording') signal('site-walk-recording-started')
  }, [phase])
  // b. Finish walk went through.
  useEffect(() => {
    if (finished) signal('site-walk-finished')
  }, [finished])
  // c. The proposal is ready, or reading failed (the walk shows its own "Couldn't finish" and the
  // try-it ends with MarshBot's line instead of waiting).
  useSignalAtStep('site-walk-proposal-ready', status === 'ready', 'site-walk', 7)
  useSignalAtStep('try-it-failed', status === 'failed', 'site-walk', 7)
  // d. No microphone while step 2 waits for a recording: MarshBot says so and the sentence is typed
  // into the note box for the person to add.
  useEffect(() => {
    if (at !== 2) return void (seen.current = micProblem)
    if (!micProblem || micProblem === seen.current) return
    seen.current = micProblem
    latest.current(SAMPLE_WALK_NOTE)
    // The line asks for a press on Add note, so the note box is lit and usable until the note is
    // in; then the walkthrough goes on at Finish walk (past the "recording saved" result, which
    // there is none of, and the camera and note steps).
    askFor(NO_MICROPHONE_WALK, 'concerned', 'site-walk.notes', 'site-walk-note-added', () => {
      next(true)
      next(true)
      next(true)
      next(true)
    })
  }, [at, micProblem])
  return at > 0
}

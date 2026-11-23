// A tiny emitter features call when something finishes, so a walkthrough can move on (F-12).
// Called by feature screens (signal) and by engine.ts (onSignal, onAnySignal). No polling: walkthroughs react to these.

// Every signal name, kebab-case and past tense. Add yours here.
export const SIGNALS = [
  'try-it-failed', // a feature's AI call failed during a try-it; the engine ends it with the "didn't work" line
  'sample-email-wanted', // the new-docs walkthrough's "Use the sample email" was pressed; the upload area adds the sample (new-assessment/components/UploadArea.tsx)
  'documents-form-opened', // the form opened after reading documents (screens/NewAssessment.tsx)
  'assessment-created-by-form', // a real Create from the hand-filled form (screens/NewAssessment.tsx)
  'assessment-created-from-documents', // a real Create from a form filled in by reading documents
  'chat-answer-finished', // the chat's answer has finished being written (chat/components/AnswerBar.tsx)
  'ask-question-sent', // a question was sent from the Ask tab (assessments/ask/useAsk.ts)
  'ask-answer-finished', // the Ask answer has finished arriving, checked line by line (assessments/ask/useAsk.ts)
  'finding-accepted', // an Accept on a finding has been saved (assessments/screens/ReviewWorkspace.tsx, decide)
  'ofi-accepted', // the OFI accepts the engineer pressed have been saved (assessments/components/OfiReviewPanel.tsx)
  'figures-confirmed', // Section 4's or 5's figures were saved, i.e. confirmed (assessments/useFigures.ts)
  'observation-location-chosen', // the loading bay was chosen on New Observation (assessments/components/LocationSheet.tsx)
  'observation-recording-stopped', // a recording was kept on New Observation (assessments/components/CaptureVoicePanel.tsx)
  'observation-saved', // an observation was saved on New Observation (assessments/newObservationWalk.ts, observationSaved)
  'observation-saved-by-hand', // the same, on a real assessment only: counts toward the site walk offer
  'observation-category-confirmed', // an observation's Category Confirm was saved (assessments/components/ObservationDetails.tsx)
  'observation-reading-finished', // the observation just saved is amber, its suggestion in (assessments/components/ObservationRow.tsx)
  'note-split-opened', // Split note's parts are showing (assessments/components/SplitNotePanel.tsx)
  'site-walk-recording-started', // the recorder's microphone is open (site-walk/useRecordingWalk.ts)
  'site-walk-recording-saved', // Save recording kept the recording (site-walk/screens/Recording.tsx)
  'site-walk-note-added', // a typed note was added to the walk (site-walk/screens/Recording.tsx); the no-microphone path waits on it
  'site-walk-finished', // Finish walk went through (site-walk/useRecordingWalk.ts)
  'site-walk-proposal-ready', // the finished walk's proposal is ready (site-walk/useRecordingWalk.ts)
  'marshbot-turn-shown', // MarshBot's newest pushed turn on the Overview is all shown, its replies too (marshbot/screens/MarshBotOverview.tsx)
  'practice-changed', // the practice assessment was set up again or reset (walkthrough/player.ts, engine.ts); the assessments list re-reads
  'proposal-created', // Create all added the proposal to the assessment (site-walk/screens/Review.tsx)
] as const

const listeners = new Map<string, Set<(detail: unknown) => void>>()
const anyListeners = new Set<(name: string, detail: unknown) => void>()

/** Tells every listener that `name` happened; returns nothing. */
export function signal(name: string, detail?: unknown): void {
  for (const fn of [...(listeners.get(name) ?? [])]) fn(detail)
  for (const fn of [...anyListeners]) fn(name, detail)
}

/** Listens for `name`; returns the function that stops listening. */
export function onSignal(name: string, fn: (detail: unknown) => void): () => void {
  const set = listeners.get(name) ?? new Set()
  set.add(fn)
  listeners.set(name, set)
  return () => set.delete(fn)
}

/** Listens for every signal (the engine counts them for "other way" offers); returns the stop function. */
export function onAnySignal(fn: (name: string, detail: unknown) => void): () => void {
  anyListeners.add(fn)
  return () => anyListeners.delete(fn)
}

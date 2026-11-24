// MarshBot's fixed lines and the walkthrough's own messages (F-12): one line in the corner with OK
// (tell), and a line beside one control a screen's fallback asks the person to use (askFor).
// Called by play.ts, offers.ts and the screens' fallbacks (newObservationWalk.ts, useRecordingWalk.ts). Calls run.ts, state.ts.
import type { Mood } from '../marshbot/types'
import { bringIntoView } from './placement'
import { run, stopListening } from './run'
import { findTarget } from './settle'
import { calm, set } from './state'
import { onSignal } from './signals'

// Fixed words (spec, "Copy rules"). Never reworded.
export const LOST =
  "I'm sorry, I can't find what I wanted to show you on this screen, so I'll stop here. You can replay this walkthrough from **Settings** whenever you like."
export const ALL_DONE =
  "And that's all of them! You can replay any of these from **Settings** whenever you like."
// Said when a walkthrough would have to leave a screen with unsaved work (new line, F-12 Check).
export const BUSY =
  "It looks like you have unsaved work here, so I won't take you away from it. Once it's saved, you can play this walkthrough from **Settings** whenever you like."
// The spec's "fails part-way" line, used when a try-it has no line of its own or the practice assessment can't be made.
export const CANT_RUN =
  "I'm sorry, that didn't work this time. You can replay this walkthrough from **Settings** whenever you like."
export const LATER_MS = 250 // typing dots before every message after a walkthrough's first

/** Shows one message in the bottom-right corner with an OK (or the given answers); no dimming. */
export function tell(say: string, mood: Mood, onOk?: () => void) {
  // The step's own listeners go, as in askFor: one landing now would take this message away.
  stopListening()
  set({
    bubble: {
      key: `tell:${++run.gen}`,
      say,
      mood,
      place: 'corner',
      answers: [{ label: 'OK', act: () => (set({ bubble: null }), onOk?.()) }],
      closable: false,
      typing: calm() ? 0 : LATER_MS,
    },
    targets: null,
    dim: false,
    ring: 'off',
    nav: false,
    quiet: false,
  })
}

/** Says a line beside the control tagged `tag`, which alone can be used, until signal `until`
    fires; then runs `then`. For a screen's own fallback that asks the person to do something (the
    site walk with no microphone: "type the sentence and press Add note"). Returns nothing. */
export function askFor(say: string, mood: Mood, tag: string, until: string, then: () => void) {
  if (!run.def) return
  const g = ++run.gen
  stopListening()
  const el = findTarget(tag)
  if (el) bringIntoView([el], { w: window.innerWidth, h: window.innerHeight })
  set({
    bubble: {
      key: `ask:${g}`,
      say,
      mood,
      place: 'target',
      closable: true,
      typing: calm() ? 0 : LATER_MS,
    },
    targets: [tag],
    apart: false,
    end: false,
    dim: true,
    ring: 'on',
    nav: false,
    quiet: false,
  })
  run.stops.push(onSignal(until, () => g === run.gen && then()))
}

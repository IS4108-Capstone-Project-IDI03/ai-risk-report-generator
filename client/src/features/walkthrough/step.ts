// Showing one step (F-12): its `open` presses, the settle rule, the cut-out and then MarshBot's
// bubble; Next, Back and a question's answers. A hands-on step is handed to hands.ts.
// Called by player.ts (next, back) and, through run.ts's seam, by play.ts and hands.ts. Calls run.ts, hands.ts, play.ts, state.ts.
import { toast } from '../../design-system'
import { FIRST_MESSAGE_MS } from '../marshbot/settings'
import { armActions, quiet } from './hands'
import { LATER_MS } from './messages'
import { bringIntoView } from './placement'
import { finish, lost, playQueue } from './play'
import {
  admin,
  AFTER_PRESS_MS,
  forget,
  needed,
  onScreen,
  run,
  seam,
  skipsOpen,
  stopListening,
  tagsOf,
} from './run'
import { SHUT_MS } from './spotlight'
import { findTarget, settle, SETTLE_MS } from './settle'
import { signal } from './signals'
import { calm, fill, get, set, sleep, type BubbleView } from './state'
import type { AnswerThen, StepDef } from './types'

// A press that opens another screen waits for the cut-out to fade shut first (spotlight.ts SHUT_MS)
// plus a frame or two for the host to measure "no target" and start that fade.
const SHUT_START_MS = 40

const typing = () => (calm() ? 0 : run.firstMessage ? FIRST_MESSAGE_MS : LATER_MS)

/** Shows the step at run.index: its open presses, the settle rule, the cut-out, then the bubble. */
async function showStep(): Promise<void> {
  const g = ++run.gen
  stopListening()
  const step = run.steps[run.index]
  const patience = run.afterPress ? AFTER_PRESS_MS : SETTLE_MS
  run.afterPress = false
  set({ bubble: null, ring: 'off', nav: !!step.nav, quiet: false })
  // a. Presses what must be open first (a tab, a menu), each once it has settled. Not a press
  // skipsOpen leaves out (run.ts): it could close what is open, or look for a Back button that is
  // no longer there and end the walkthrough.
  const wanted = needed(tagsOf(step))
  const done = run.opened === run.index // pressed already, while the app answered the step before (quiet)
  const opens = !done && !!step.open?.some((tag) => !skipsOpen(wanted, tag))
  // A press that changes the screen: the cut-out fades shut first and stays shut until the next
  // target is measured. Without this the new screen showed through the old cut-out for a moment.
  if (opens && get().dim && get().targets) {
    set({ targets: null })
    await sleep(SHUT_MS + SHUT_START_MS)
    if (g !== run.gen) return
  }
  let pressed = false
  for (const tag of done ? [] : (step.open ?? [])) {
    if (skipsOpen(wanted, tag)) continue
    const [el] = (await settle([tag], patience)) ?? []
    if (g !== run.gen) return
    if (!el) return lost()
    el.click()
    pressed = true
  }
  // The press's screen is drawn first (React draws after this task): without this the old target
  // still counts as on screen, and the cut-out glides across the new screen instead of fading.
  if (pressed) await sleep(0)
  if (g !== run.gen) return
  // b. The settle rule. Between screens the highlight fades out while the dimming stays.
  const tags = tagsOf(step)
  const before = get().targets
  const sameScreen = !!before && before.every(findTarget)
  const shutAt = performance.now()
  if (tags.length) {
    if (!sameScreen) set({ targets: null })
    const els = await settle(needed(tags), patience)
    if (g !== run.gen) return
    if (!els) {
      if (!step.optional) return lost()
      run.steps.splice(run.index, 1) // skipped, and the bar renumbers
      if (run.index >= run.steps.length) return finish('played')
      return showStep()
    }
    // c. Between screens, the old cut-out's time to fade shut (spotlight.ts), or the new one would
    // open over it half-shut.
    if (before && !sameScreen) await sleep(Math.max(0, SHUT_MS - (performance.now() - shutAt)))
    if (g !== run.gen) return
    const lit = onScreen(tags)
    // Both axes, before the highlight is measured: a tab scrolled away sideways, a union taller than the window.
    bringIntoView(
      lit.map(findTarget).filter((el) => el !== null),
      { w: window.innerWidth, h: window.innerHeight },
      step.show === 'end',
    )
    set({
      targets: lit,
      apart: !!step.apart,
      end: step.show === 'end',
      dim: !run.def!.bare,
    })
    // The cut-out glides (same screen, 320 ms) or fades open (new screen, 180 ms; spotlight.ts) first.
    if (!calm()) await sleep(sameScreen ? 320 : 180)
  } else set({ targets: null, apart: false, end: false, dim: true })
  if (g !== run.gen) return
  // d. The message, then what moves the step on. A toast still showing from the person's last
  // action goes: they saw it in the quiet time, and MarshBot now says what happened (not on the
  // first step, whose toast is about the practice assessment just set up).
  if (run.index > 0) toast.dismiss()
  set({
    bubble: viewOf(step),
    running: { id: run.def!.id, at: run.index + 1, total: run.steps.length },
  })
  run.firstMessage = false
  const early = run.heard
  forget()
  if (step.do) armActions(step, g, early)
}

// The bubble for a step: its words for this role, where it sits, the stepper or its answers.
function viewOf(step: StepDef): BubbleView {
  const d = run.def!
  const say = admin() && step.sayAdmin ? step.sayAdmin : step.say
  const question = !!step.answers
  return {
    key: `${d.id}:${run.index}`,
    say: fill(say),
    mood: step.mood ?? 'idle',
    place: step.card || !tagsOf(step).length ? 'card' : d.bare ? 'bare' : 'target',
    step:
      question || d.bare
        ? undefined
        : {
            at: run.index + 1,
            total: run.steps.length,
            hands: !!step.do,
            noBack: !canGoBack(),
          },
    answers: question
      ? step.answers!.map((a) => ({
          label: (admin() && a.labelAdmin) || a.label,
          act: () => answer((admin() && a.thenAdmin) || a.then),
        }))
      : d.bare
        ? [{ label: 'OK', act: () => finish('played') }]
        : undefined,
    // Skip shows on every step; a card's own buttons are its way out (spec, "Skip").
    closable: !step.card && !d.bare,
    typing: typing(),
  }
}

/** Moves to the next step, or finishes on the last; Next does nothing while it is greyed. */
export function next(force = false) {
  const view = get().bubble
  // Not while the next step is still settling (no bubble yet): a second quick press of the arrow
  // key would otherwise skip the step that is about to show, a hands-on one included.
  if (!run.def || (!force && (!view || view.step?.hands))) return
  if (run.index >= run.steps.length - 1) return finish('played')
  run.index += 1
  void showStep()
}

// Back shows the step before again, which must still be possible: not when this step opened
// something (a tab, a page: the one before may no longer be on screen), and not into a step whose
// action is used up (it would wait for ever, or press a button that is gone and end the walkthrough).
function canGoBack(): boolean {
  if (run.index === 0) return false
  const before = run.steps[run.index - 1]
  return !run.steps[run.index].open?.length && !before.do
}

/** Goes back one step, where that is possible (see canGoBack) and a step is showing. */
export function back() {
  if (!run.def || !get().bubble || !canGoBack()) return
  run.index -= 1
  void showStep()
}

// A question's answer: carry on, finish, skip, set the app working, or play another walkthrough.
function answer(then: AnswerThen) {
  if (then === 'next') return next(true)
  if (then === 'end') return finish('played')
  if (then === 'skip') return finish('skipped')
  if ('emit' in then) {
    // An answer that sets the app working (Use the sample email): the walkthrough steps aside first.
    const step = run.steps[run.index]
    if (step.until) void quiet(step, run.gen)
    signal(then.emit)
    return step.until ? undefined : next(true)
  }
  return finish('played', () => playQueue([then.play]))
}

// The seam: play.ts and hands.ts reach the next step through run.ts, not by importing this file.
seam.showStep = () => void showStep()
seam.next = next

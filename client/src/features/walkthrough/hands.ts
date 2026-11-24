// Hands-on steps (F-12): the person's actions in order, then the quiet wait while the app answers,
// with nothing of the walkthrough on screen, until its result is ready and has shown for a second.
// Called by step.ts (armActions, quiet). Calls run.ts, play.ts (endings), settle.ts, signals.ts, state.ts.
import { failedPartWay, lost, tooSlow } from './play'
import {
  AFTER_PRESS_MS,
  after,
  listen,
  needed,
  QUIET_MS,
  run,
  seam,
  skipsOpen,
  stopListening,
  tagsOf,
} from './run'
import { findTarget, settle, SETTLE_MS } from './settle'
import { onAnySignal, onSignal } from './signals'
import { get, screenNow, set, sleep, whenScreenNot } from './state'
import type { StepDef } from './types'

// The longest the walkthrough waits on the app's answer with nothing on screen, unless the
// walkthrough's own fail.slow says otherwise. Without a limit an answer that never comes (stopped,
// stalled) left it invisible but running: offers blocked, and Esc anywhere skipped it.
const QUIET_LIMIT_MS = 90_000

/** Arms a hands-on step: the person does its actions in order. A single press keeps the spotlight
    until the press; with more to do (choose, type, record) the spotlight goes at the first press or
    key inside the cut-out and the bubble stays, unmoved, for the instructions. Once the last action
    has landed, quiet() takes over. `early`: signals raised before the step showed. Returns nothing. */
export function armActions(step: StepDef, g: number, early: Set<string> | null) {
  const actions = step.do!
  let k = 0
  const arm = () => {
    const action = actions[k]
    const done = () => {
      stopListening()
      k += 1
      if (k < actions.length) arm()
      else void quiet(step, g)
    }
    if ('press' in action)
      // Capture phase, so the press is seen even if the control stops it bubbling; it still goes through.
      listen('click', (e) => {
        if ((e.target as Element | null)?.closest?.(`[data-walk="${CSS.escape(action.press)}"]`))
          done()
      })
    else {
      run.stops.push(onSignal(action.signal, done))
      if (k === 0 && early?.has(action.signal)) after(QUIET_MS, done)
    }
    if (actions.length > 1 || !('press' in action)) {
      // Without this a menu opening outside the cut-out could not be used, and every scroll moved it.
      const letGo = (e: Event) => {
        if (e instanceof KeyboardEvent && /^(Tab|Shift|Control|Alt|Meta)$/.test(e.key)) return
        const { dim, targets, bubble } = get()
        const inside = (targets ?? []).some((t) => findTarget(t)?.contains(e.target as Node))
        if (!dim || !inside) return
        set({ dim: false, ring: 'off', bubble: bubble && { ...bubble, rushed: true } })
      }
      listen('pointerdown', letGo)
      listen('keydown', letGo)
    }
  }
  set({ ring: 'on' })
  arm()
}

/** The person's part of a hands-on step is done. In order:
    a. MarshBot's bubble and the spotlight leave at once; from here the app's own screen shows alone.
    b. With an `until`: the next step's `open` presses a second in (so the person watches the app
       work on the right screen), then the app's "result is ready" signal (heard early or now).
    c. That result stays on screen QUIET_MS alone; then the next step, after the settle rule. */
export async function quiet(step: StepDef, g: number) {
  // A message has replaced the step since (tell, askFor): it stays, and so does its OK.
  if (g !== run.gen) return
  set({
    bubble: null,
    targets: null,
    dim: false,
    ring: 'off',
    apart: false,
    end: false,
    quiet: true,
  })
  run.afterPress = true
  const caught = new Set<string>()
  run.heard = caught
  run.stopHearing = onAnySignal((name) => caught.add(name))
  let readyAt = performance.now()
  if (step.until) {
    run.waiting = run.index
    const following = run.steps[run.index + 1]
    let pressed = false
    if (following?.open?.length) {
      // The person may leave this screen before the engine's own press (play.ts, screenGone).
      // Without this the search for a Back button that had gone reset the practice assessment and
      // started the walkthrough again, seconds after they had left.
      run.watching = screenNow.current?.key ?? null
      await sleep(QUIET_MS)
      if (g !== run.gen) return
      // Not a press skipsOpen leaves out (the person pressed Back themselves): the search for a
      // Back button that is gone would end the walkthrough (showStep's own rule).
      const wanted = needed(tagsOf(following))
      const from = screenNow.current?.key ?? null
      for (const tag of following.open) {
        if (skipsOpen(wanted, tag)) continue
        const [el] = (await settle([tag], AFTER_PRESS_MS)) ?? []
        if (g !== run.gen) return
        if (!el) return lost()
        // The engine's own press leaves this screen: not the person leaving.
        run.watching = null
        el.click()
        pressed = true
      }
      run.opened = run.index + 1
      // The screen the press opened is the one the person may leave (the Observations list), once
      // it says it is showing. Without this the old screen was watched, and leaving the list went
      // unnoticed until the time limit. The wait for the answer starts meanwhile.
      if (pressed)
        void whenScreenNot(from, SETTLE_MS).then(() => {
          if (g === run.gen && run.waiting !== null) run.watching = screenNow.current?.key ?? null
        })
    }
    if (!caught.has(step.until)) {
      const until = step.until
      // The person leaving this screen now ends it as a skip (play.ts, screenGone); after the
      // engine's own press, the new screen once it shows (above).
      if (!pressed) run.watching = screenNow.current?.key ?? null
      // The app is slower than usual, or its answer never comes: fail.slow's line (the walkthrough
      // ends, the work goes on), else failedPartWay (a hands-on step shows again; a try-it ends).
      const slow = run.def!.fail?.slow
      after(slow?.afterMs ?? QUIET_LIMIT_MS, () => {
        if (g !== run.gen || run.waiting === null) return
        if (slow) tooSlow(slow.say)
        else failedPartWay()
      })
      await new Promise<void>((ready) => run.stops.push(onSignal(until, () => ready())))
    }
    if (g !== run.gen) return
    run.watching = null
    run.waiting = null
    readyAt = performance.now()
  }
  await sleep(Math.max(0, readyAt + QUIET_MS - performance.now()))
  if (g !== run.gen) return
  seam.next(true)
}

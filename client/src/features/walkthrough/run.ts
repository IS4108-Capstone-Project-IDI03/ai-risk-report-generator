// The playing walkthrough's shared state (F-12): which walkthrough and step, the step number every
// async piece checks (`gen`), the listeners to stop, and the small helpers the player's parts share.
// Read and written by play.ts, step.ts, hands.ts and messages.ts. Calls state.ts and settle.ts.
import { findTarget } from './settle'
import { get, set } from './state'
import type { StepDef, WalkthroughDef } from './types'

// Once the person's part of a hands-on step is done, the app's result stays on screen this long, with
// nothing of the walkthrough over it, before MarshBot speaks again (and the settle rule still holds).
export const QUIET_MS = 1000
// The person's last press may be loading a screen (a row opening its page): the next settle waits this long.
export const AFTER_PRESS_MS = 8000

// The one record of what is playing. Its fields are written in place by the player's parts.
export const run = {
  def: null as WalkthroughDef | null,
  steps: [] as StepDef[], // this role's steps, less optional ones that were not found
  index: 0,
  queue: [] as string[], // still to play after the current one
  queueSize: 0,
  firstMessage: true,
  // Bumped on every step change and ending: async work started for an older step stops when it sees a newer number.
  gen: 0,
  stops: [] as (() => void)[],
  // The person's last press may be loading a screen: the next settle waits AFTER_PRESS_MS.
  afterPress: false,
  // The walkthrough the practice assessment was last reset for (play.ts, lost); cleared by a new play.
  retried: null as string | null,
  // Signals raised since the person's part of a step was done: the app's answer can come before
  // anything listens for it, and without this the walkthrough would wait for ever.
  heard: null as Set<string> | null,
  stopHearing: () => {},
  // The step whose `open` presses were made during the quiet time before it (hands.ts, quiet).
  opened: -1,
  // A hands-on step waiting quietly for the app's answer (hands.ts, quiet): a refusal shows it again.
  waiting: null as number | null,
  // The screen showing while the walkthrough waits on the app's answer: the person leaving it skips.
  watching: null as string | null,
}

// The two calls that go back up the chain (hands.ts and play.ts reach the step that shows next).
// step.ts fills them in; without this seam the parts would import each other in a circle.
export const seam = {
  showStep: (): void => undefined,
  next: (force?: boolean): void => void force,
}

/** Returns whether the signed-in person is a knowledge admin. */
export const admin = () => get().role === 'knowledge_admin'
/** Returns whether the step is for the signed-in role. */
export const forRole = (step: StepDef) => !step.only || step.only === get().role
/** Returns the tag or tags as a list. */
export const asList = (tags: string | string[] | undefined) =>
  tags === undefined ? [] : [tags].flat()
// A tag ending in "?" is optional (types.ts): `needed` are the ones a step waits for, `onScreen`
// every tag that is there now, optional ones included.
const plain = (tag: string) => tag.replace(/\?$/, '')
/** Returns the tags a step must find (not the optional ones). */
export const needed = (tags: string[]) => tags.filter((t) => !t.endsWith('?'))
/** Returns the tags to light now: every required one, and the optional ones on the screen. */
export const onScreen = (tags: string[]) =>
  tags.filter((t) => !t.endsWith('?') || findTarget(plain(t))).map(plain)

/** Returns the tags a step's highlight goes round: a hands-on step's first action, else its target. */
export function tagsOf(step: StepDef): string[] {
  const first = step.do?.[0]
  if (first && 'press' in first) return [first.press]
  if (first?.at) return [first.at]
  return asList(step.target)
}

/** Returns whether a step's `open` press is left out: what the step points at (`wanted`) already
    shows and the press would change nothing or undo it, as its control has gone (the app went
    there by itself) or is already the current or open one (a rail row, a tab, a toggle). A control
    that is not current is still pressed: the Review walkthrough's first finding also shows on
    Section 6, and without the press the step lit that one, whose Accept is already gone. */
export function skipsOpen(wanted: string[], tag: string): boolean {
  if (!wanted.length || !wanted.every((t) => findTarget(t))) return false
  const el = findTarget(tag)
  if (!el) return true
  const current = el.getAttribute('aria-current')
  if (current !== null && current !== 'false') return true
  return ['aria-expanded', 'aria-selected', 'aria-pressed', 'aria-checked'].some(
    (name) => el.getAttribute(name) === 'true',
  )
}

/** Stops every listener and timer of the step showing now; returns nothing. */
export function stopListening() {
  run.stops.forEach((stop) => stop())
  run.stops = []
}

/** Forgets the signals heard early (a step has shown, or the walkthrough ended or started); without
    this a skipped walkthrough's answer could move the next one on. Returns nothing. */
export function forget() {
  run.stopHearing()
  run.heard = null
  run.waiting = null
  run.watching = null
}

/** Runs `fn` after `ms` unless the step changes first; returns nothing. */
export function after(ms: number, fn: () => void) {
  const timer = setTimeout(fn, ms)
  run.stops.push(() => clearTimeout(timer))
}

/** Adds a capture-phase listener on the document until the step changes; returns nothing. */
export function listen<K extends keyof DocumentEventMap>(
  type: K,
  fn: (e: DocumentEventMap[K]) => void,
) {
  document.addEventListener(type, fn, true)
  run.stops.push(() => document.removeEventListener(type, fn, true))
}

/** Clears what is playing and everything drawn for it (nothing is recorded); returns nothing. */
export function end() {
  run.gen += 1
  run.afterPress = false
  run.opened = -1
  stopListening()
  forget()
  run.def = null
  set({
    running: null,
    bubble: null,
    targets: null,
    apart: false,
    end: false,
    dim: false,
    ring: 'off',
    nav: false,
    quiet: false,
  })
}

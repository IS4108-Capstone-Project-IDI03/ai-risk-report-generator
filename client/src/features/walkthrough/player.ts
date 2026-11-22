// Plays walkthroughs (F-12): one step at a time after the settle rule, hands-on and waiting steps,
// answers, Skip and Finish, and a queue played in order with a question between two.
// Called by engine.ts (play), offers.ts (start) and WalkthroughHost (next, back, skip). Calls state.ts, settle.ts, api.ts.
import { toast } from '../../design-system'
import { FIRST_MESSAGE_MS } from '../marshbot/settings'
import type { Mood } from '../marshbot/types'
import { checkTryIt, setUpPractice } from './api'
import { onSignal, signal } from './signals'
import { bringIntoView } from './placement'
import { findTarget, settle, SETTLE_MS } from './settle'
import {
  atPlace,
  calm,
  defFor,
  fill,
  get,
  go,
  needsPractice,
  noteScreen,
  placePath,
  screenNow,
  whenReady,
  saveQuietly,
  set,
  sleep,
  type BubbleView,
} from './state'
import type { AnswerThen, StepDef, WalkthroughDef } from './types'

// Fixed words (spec, "Copy rules"). Never reworded.
export const LOST =
  "I can't find that on this screen right now, so I'll stop here. You can replay this walkthrough from **Settings** whenever you like."
export const ALL_DONE =
  "And that's all of them! You can replay any of these from **Settings** whenever you like."
// Said when a walkthrough would have to leave a screen with unsaved work (new line, F-12 Check).
export const BUSY =
  "I'll wait until you've finished what you're doing here. You can play this walkthrough from **Settings** whenever you like."
// The spec's "fails part-way" line, used when a try-it has no line of its own or the practice assessment can't be made.
const CANT_RUN =
  "I'm sorry, that didn't work this time. You can replay this walkthrough from Settings whenever you like."
const LATER_MS = 250 // typing dots before every message after a walkthrough's first
const LANDED_MS = 260 // the ring stays green this long before the next step

let def: WalkthroughDef | null = null
let steps: StepDef[] = [] // this role's steps, less optional ones that were not found
let index = 0
let queue: string[] = [] // still to play after the current one
let queueSize = 0
let firstMessage = true
// Bumped on every step change and ending: async work started for an older step stops when it sees a newer number.
let gen = 0
let stops: (() => void)[] = []
// The person's last press may be loading a screen (a row opening its page): the next settle waits longer.
let afterPress = false
const AFTER_PRESS_MS = 8000
// The walkthrough the practice assessment was last reset for (see lost()); cleared by a new play.
let retried: string | null = null

const admin = () => get().role === 'knowledge_admin'
const forRole = (step: StepDef) => !step.only || step.only === get().role
const typing = () => (calm() ? 0 : firstMessage ? FIRST_MESSAGE_MS : LATER_MS)
const asList = (tags: string | string[] | undefined) => (tags === undefined ? [] : [tags].flat())
// A tag ending in "?" is optional (types.ts): `needed` are the ones a step waits for, `onScreen`
// every tag that is there now, optional ones included.
const plain = (tag: string) => tag.replace(/\?$/, '')
const needed = (tags: string[]) => tags.filter((t) => !t.endsWith('?'))
const onScreen = (tags: string[]) =>
  tags.filter((t) => !t.endsWith('?') || findTarget(plain(t))).map(plain)

function stopListening() {
  stops.forEach((stop) => stop())
  stops = []
}

/** Returns the id of the walkthrough playing now, or null. */
export const current = () => def

/** Shows one message in the bottom-right corner with an OK (or the given answers); no dimming. */
export function tell(say: string, mood: Mood, onOk?: () => void) {
  set({
    bubble: {
      key: `tell:${++gen}`,
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
  })
}

/** Says a line beside the control tagged `tag`, which alone can be used, until signal `until`
    fires; then runs `then`. For a screen's own fallback that asks the person to do something (the
    site walk with no microphone: "type the sentence and press Add note"). Returns nothing. */
export function askFor(say: string, mood: Mood, tag: string, until: string, then: () => void) {
  if (!def) return
  const g = ++gen
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
  })
  stops.push(onSignal(until, () => g === gen && then()))
}

/** Plays the walkthroughs in order (Settings, "Show me"); replaces anything playing. `stay` plays
    the first where the person is (the Welcome, which starts by itself on whatever home screen loaded). */
export function playQueue(ids: string[], stay = false) {
  if (def) end()
  retried = null
  queue = ids.slice(1)
  queueSize = ids.length
  void start(ids[0], stay)
}

// Sets up (or resets) the practice assessment; returns its reference, or null when that failed. The
// record is written before the caller can stop: a walkthrough replaced meanwhile would otherwise
// lose the reference and make a second one. The signal has the assessments list read again, as
// its screens open view-only for an assessment the list does not hold.
export async function freshPractice(): Promise<string | null> {
  const reference = await setUpPractice().catch(() => null)
  if (!reference) return null
  set(({ record }) => ({ record: { ...record, practice: reference } }))
  signal('practice-changed')
  return reference
}

// Returns whether starting the walkthrough opens its own place: not when it plays where the person
// is. A hands-on one plays here only on the practice assessment; a place reached by presses
// (`open`: the Proposals list, then its first walk) is only "here" when its own screen shows, as
// the URL alone matches the list too and step 1 would never be found.
function leavesFor(found: WalkthroughDef, stay: boolean): boolean {
  const itsScreen = screenNow.current?.key === found.screen
  const here = needsPractice(found)
    ? atPlace(found.place) && (!found.place.open?.length || itsScreen)
    : itsScreen
  return !here && !stay
}

/** Starts one walkthrough: the try-it check, then its place, then its first step. */
export async function start(id: string, stay = false): Promise<void> {
  const found = defFor(id)
  if (!found) return carryOn()
  const g = ++gen
  stopListening()
  // Opening the walkthrough's own place would leave the screen the person is on. Over unsaved work
  // that is refused: a note typed on a real assessment would be carried into the practice form.
  if (leavesFor(found, stay) && screenNow.current?.hold === 'unsaved') {
    queue = []
    return tell(BUSY, 'idle')
  }
  // a. A try-it first asks whether its AI services are working (Architecture 7).
  if (found.kind === 'ai') {
    const ok = await checkTryIt(id).catch(() => false)
    // Something newer started (or the person signed out) while the check ran: this one stops,
    // pass or fail. Without this a slow check would start its walkthrough over the newer one.
    if (g !== gen) return
    if (!ok) return tell(found.fail?.replay ?? CANT_RUN, 'concerned', carryOn)
  }
  // b. Plays where the person is when that is its screen (and, for hands-on, the practice assessment).
  const opens = leavesFor(found, stay)
  // c. Hands-on walkthroughs never touch a real assessment, and a replay of a tell-only one opens the
  // practice assessment when that is its place: without one, it is set up again first.
  const usesPractice = needsPractice(found) || (opens && found.place.path.includes('{practice}'))
  if (usesPractice && !get().record.practice) {
    const reference = await freshPractice()
    if (g !== gen) return
    if (!reference) return lost()
    toast.info('Practice assessment set up again')
  }
  def = found
  steps = found.steps.filter(forRole)
  index = 0
  firstMessage = true
  set({ running: { id, at: 1, total: steps.length } })
  // d. Otherwise: its path, then each `open` tag pressed as it settles, and only then the wait for
  // its screen to say it is ready (each wait up to 4 s).
  if (opens) {
    // The old screen's "ready" no longer counts; a screen that never reports is left to the settle rule.
    if (go(placePath(found.place))) noteScreen(null)
    for (const tag of found.place.open ?? []) {
      const [el] = (await settle([tag])) ?? []
      if (g !== gen) return
      if (!el) return lost()
      el.click()
    }
    await whenReady(found.screen, SETTLE_MS)
    if (g !== gen) return
  }
  if (g === gen) void showStep()
}

// The tags a step's highlight goes round: a hands-on step's first action, else its target.
function tagsOf(step: StepDef): string[] {
  const first = step.do?.[0]
  if (first && 'press' in first) return [first.press]
  if (first?.at) return [first.at]
  return asList(step.target)
}

async function showStep(): Promise<void> {
  const g = ++gen
  stopListening()
  const step = steps[index]
  const patience = afterPress ? AFTER_PRESS_MS : SETTLE_MS
  afterPress = false
  set({ bubble: null, ring: 'off', nav: !!step.nav })
  // a. Presses what must be open first (a tab, a menu), each once it has settled. Not when what the
  // step points at is already showing (the screen went there by itself, or a replay): a press then
  // could close what is open, or look for a Back button that is no longer there and end the walkthrough.
  const wanted = needed(tagsOf(step))
  for (const tag of step.open ?? []) {
    if (wanted.length && wanted.every((t) => findTarget(t))) break
    const [el] = (await settle([tag], patience)) ?? []
    if (g !== gen) return
    if (!el) return lost()
    el.click()
  }
  // b. The settle rule. Between screens the highlight fades out while the dimming stays.
  const tags = tagsOf(step)
  const before = get().targets
  const sameScreen = !!before && before.every(findTarget)
  if (tags.length) {
    if (!sameScreen) set({ targets: null })
    const els = await settle(needed(tags), patience)
    if (g !== gen) return
    if (!els) {
      if (!step.optional) return lost()
      steps.splice(index, 1) // skipped, and the bar renumbers
      if (index >= steps.length) return finish('played')
      return showStep()
    }
    const lit = onScreen(tags)
    // Both axes, before the highlight is measured: a tab scrolled away sideways, a union taller than the window.
    bringIntoView(
      lit.map(findTarget).filter((el) => el !== null),
      { w: window.innerWidth, h: window.innerHeight },
      step.show === 'end',
    )
    set({ targets: lit, apart: !!step.apart, end: step.show === 'end', dim: !def!.bare })
    // The highlight glides (same screen, 320 ms) or fades in (new screen, 180 ms) first.
    if (!calm()) await sleep(sameScreen ? 320 : 180)
  } else set({ targets: null, apart: false, end: false, dim: true })
  if (g !== gen) return
  // c. The message, then what moves the step on.
  set({ bubble: viewOf(step), running: { id: def!.id, at: index + 1, total: steps.length } })
  firstMessage = false
  if (step.do) armActions(step, g)
  if (step.wait) {
    stops.push(onSignal(step.wait, () => g === gen && void landed(g)))
    // The AI is slower than usual: the try-it's own line, and the walkthrough ends (the work goes on).
    const slow = def!.fail?.slow
    if (slow) {
      const timer = setTimeout(() => g === gen && tooSlow(slow.say), slow.afterMs)
      stops.push(() => clearTimeout(timer))
    }
  }
}

// A waiting step ran out of time: recorded as played (the person did every step of theirs), so it is
// not offered again, and nothing queued after it starts by itself.
function tooSlow(say: string) {
  const done = def!
  end()
  queue = []
  saveQuietly({ seen: { [done.id]: 'played' } })
  tell(say, 'idle')
}

function viewOf(step: StepDef): BubbleView {
  const d = def!
  const say = admin() && step.sayAdmin ? step.sayAdmin : step.say
  const question = !!step.answers
  return {
    key: `${d.id}:${index}`,
    say: fill(say),
    mood: step.mood ?? (step.wait ? 'thinking' : 'idle'),
    place: step.card || !tagsOf(step).length ? 'card' : d.bare ? 'bare' : 'target',
    step:
      question || d.bare
        ? undefined
        : {
            at: index + 1,
            total: steps.length,
            turn: step.do ? 'hands' : step.wait ? 'wait' : undefined,
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

// A hands-on step: only the highlighted control works; each action moves the highlight to the next.
function armActions(step: StepDef, g: number) {
  const actions = step.do!
  let k = 0
  const arm = () => {
    const action = actions[k]
    const done = () => {
      stopListening()
      k += 1
      if (k < actions.length) void moveTo(k)
      else {
        afterPress = true
        void landed(g)
      }
    }
    if ('press' in action) {
      // Capture phase, so the press is seen even if the control stops it bubbling; it still goes through.
      const onClick = (e: MouseEvent) => {
        if ((e.target as Element | null)?.closest?.(`[data-walk="${CSS.escape(action.press)}"]`))
          done()
      }
      document.addEventListener('click', onClick, true)
      stops.push(() => document.removeEventListener('click', onClick, true))
    } else stops.push(onSignal(action.signal, done))
  }
  // Listens at once (a signal can follow a press within the same moment), then moves the highlight once its target has settled.
  const moveTo = async (at: number) => {
    arm()
    const action = actions[at]
    const tags = 'press' in action ? [action.press] : asList(action.at ?? step.target)
    if (!tags.length) return
    // The second and later actions follow a press that may have opened a screen: 8 s, not 4.
    const found = await settle(needed(tags), AFTER_PRESS_MS)
    if (g !== gen || k !== at) return
    if (!found) return lost()
    set({ targets: onScreen(tags), apart: false, end: false })
  }
  set({ ring: 'on' })
  arm()
}

// The step's action landed (or its AI finished): the ring turns green, the bar fills, MarshBot is pleased.
async function landed(g: number) {
  const view = get().bubble
  if (view?.step)
    set({ ring: 'done', bubble: { ...view, mood: 'pleased', step: { ...view.step, done: true } } })
  await sleep(LANDED_MS)
  if (g === gen) next(true)
}

/** Moves to the next step, or finishes on the last; Next does nothing while it is greyed. */
export function next(force = false) {
  const view = get().bubble
  // Not while the next step is still settling (no bubble yet): a second quick press of the arrow
  // key would otherwise skip the step that is about to show, a hands-on one included.
  if (!def || (!force && (!view || view.step?.turn))) return
  if (index >= steps.length - 1) return finish('played')
  index += 1
  void showStep()
}

// Back shows the step before again, which must still be possible: not when this step opened
// something (a tab, a page: the one before may no longer be on screen), and not into a step whose
// action is used up or whose AI has already answered (it would wait for ever, or press a button
// that is gone and end the walkthrough).
function canGoBack(): boolean {
  if (index === 0) return false
  const before = steps[index - 1]
  return !steps[index].open?.length && !before.do && !before.wait
}

/** Goes back one step, where that is possible (see canGoBack) and a step is showing. */
export function back() {
  if (!def || !get().bubble || !canGoBack()) return
  index -= 1
  void showStep()
}

/** Skips the walkthrough (the round close, Esc, browser Back): recorded, with a Replay toast. */
export function skip() {
  if (def) finish('skipped')
  // Nothing playing but the store says so (only seen after a hot reload replaced this module): clear it.
  else if (get().running) end()
}

function answer(then: AnswerThen) {
  if (then === 'next') return next(true)
  if (then === 'end') return finish('played')
  if (then === 'skip') return finish('skipped')
  if ('emit' in then) {
    signal(then.emit)
    return next(true)
  }
  return finish('played', () => playQueue([then.play]))
}

/** A try-it's AI failed part-way (signal 'try-it-failed'): it ends unrecorded with its own line. */
export function failedPartWay() {
  if (def?.kind !== 'ai') return
  const line = def.fail?.partway ?? CANT_RUN
  end()
  queue = []
  tell(line, 'concerned')
}

// The walkthrough ends without being recorded, so it is offered again: its target never appeared.
// On the practice assessment the usual reason is that an earlier run used it up (the one amber
// observation is already confirmed, the sample walk already created): it is reset and the
// walkthrough starts again, once.
function lost() {
  const was = def
  end()
  if (was && needsPractice(was) && retried !== was.id) {
    retried = was.id
    return void playAgain(was.id)
  }
  queue = []
  tell(LOST, 'concerned')
}

async function playAgain(id: string) {
  const g = gen
  const reference = await freshPractice()
  if (g !== gen) return
  if (!reference) return void ((queue = []), tell(LOST, 'concerned'))
  toast.info('Practice assessment reset')
  void start(id)
}

/** Stops everything without recording anything (sign-in, sign-out); returns nothing. */
export function stopAll() {
  queue = []
  queueSize = 0
  end()
}

// Clears what is playing and everything drawn for it.
function end() {
  gen += 1
  afterPress = false
  stopListening()
  def = null
  set({
    running: null,
    bubble: null,
    targets: null,
    apart: false,
    end: false,
    dim: false,
    ring: 'off',
    nav: false,
  })
}

/** Records how the walkthrough ended, then plays the next in the queue (asking first) or `after`. */
export function finish(state: 'played' | 'skipped', after?: () => void) {
  const done = def
  if (!done) return // a second press of a button that already finished it
  end()
  saveQuietly({ seen: { [done.id]: state }, ...(done.id === 'welcome' ? { welcome: true } : {}) })
  if (state === 'skipped') {
    queue = []
    toast.info('Walkthrough skipped', {
      action: { label: 'Replay', onClick: () => playQueue([done.id]) },
    })
    return
  }
  if (after) {
    queue = []
    return after()
  }
  const upNext = queue[0] && defFor(queue[0])
  if (upNext) {
    // Assumption: the walkthroughs' names stand in for {previous} and {next}.
    set({
      bubble: {
        key: `between:${++gen}`,
        say: `That's **${done.name}** done. Next up is **${upNext.name}**.\n\nShall we carry on?`,
        mood: 'idle',
        place: 'corner',
        answers: [
          { label: 'Carry on', act: () => (set({ bubble: null }), carryOn()) },
          { label: 'Stop here', act: () => ((queue = []), set({ bubble: null })) },
        ],
        closable: false,
        typing: calm() ? 0 : LATER_MS,
      },
    })
    return
  }
  if (queueSize > 1) tell(ALL_DONE, 'pleased')
  queueSize = 0
}

// Starts the next walkthrough in the queue, if any.
function carryOn() {
  const id = queue.shift()
  if (id) void start(id)
}

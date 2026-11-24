// Starting and ending walkthroughs (F-12): the try-it check and the walkthrough's place, a queue
// played in order with a question between two, Skip and Finish, and the endings when something
// goes wrong (a target never found, an answer refused or too slow, the person leaving the screen).
// Called by player.ts (the public calls), step.ts and hands.ts. Calls run.ts, messages.ts, state.ts, api.ts.
import { toast } from '../../design-system'
import { checkTryIt, setUpPractice } from './api'
import { BUSY, CANT_RUN, LATER_MS, LOST, ALL_DONE, tell } from './messages'
import { end, forget, forRole, needed, run, seam, stopListening, tagsOf } from './run'
import { findTarget, settle, SETTLE_MS } from './settle'
import { signal } from './signals'
import {
  atPlace,
  calm,
  defFor,
  get,
  go,
  needsPractice,
  noteScreen,
  placePath,
  saveQuietly,
  screenNow,
  set,
  whenReady,
} from './state'
import type { WalkthroughDef } from './types'

// A screen's own remount (a route that gains an id) leaves and shows it again within this time.
const REMOUNT_MS = 300

/** Returns the walkthrough playing now, or null. */
export const current = () => run.def

/** Plays the walkthroughs in order (Settings, "Show me"); replaces anything playing. `stay` plays
    the first where the person is (the Welcome, which starts by itself on whatever home screen loaded). */
export function playQueue(ids: string[], stay = false) {
  if (run.def) end()
  run.retried = null
  run.queue = ids.slice(1)
  run.queueSize = ids.length
  void start(ids[0], stay)
}

/** Sets up (or resets) the practice assessment; returns its reference, or null when that failed.
    The record is written before the caller can stop: a walkthrough replaced meanwhile would
    otherwise lose the reference and make a second one. The signal has the assessments list read
    again, as its screens open view-only for an assessment the list does not hold. */
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
  const g = ++run.gen
  stopListening()
  forget()
  // Opening the walkthrough's own place would leave the screen the person is on. Over unsaved work
  // that is refused: a note typed on a real assessment would be carried into the practice form.
  if (leavesFor(found, stay) && screenNow.current?.hold === 'unsaved') {
    run.queue = []
    return tell(BUSY, 'idle')
  }
  // a. A try-it first asks whether its AI services are working (Architecture 7).
  if (found.kind === 'ai') {
    const ok = await checkTryIt(id).catch(() => false)
    // Something newer started (or the person signed out) while the check ran: this one stops,
    // pass or fail. Without this a slow check would start its walkthrough over the newer one.
    if (g !== run.gen) return
    if (!ok) return tell(found.fail?.replay ?? CANT_RUN, 'concerned', carryOn)
  }
  // b. Plays where the person is when that is its screen (and, for hands-on, the practice assessment).
  const opens = leavesFor(found, stay)
  // c. Hands-on walkthroughs never touch a real assessment, and a replay of a tell-only one opens the
  // practice assessment when that is its place: without one, it is set up again first.
  const usesPractice = needsPractice(found) || (opens && found.place.path.includes('{practice}'))
  if (usesPractice && !get().record.practice) {
    const reference = await freshPractice()
    if (g !== run.gen) return
    if (!reference) return lost()
    toast.info('Practice assessment set up again')
  }
  run.def = found
  run.steps = found.steps.filter(forRole)
  run.index = 0
  run.firstMessage = true
  set({ running: { id, at: 1, total: run.steps.length } })
  // d. Otherwise: its path, then each `open` tag pressed as it settles, and only then the wait for
  // its screen to say it is ready (each wait up to 4 s).
  if (opens) {
    // The old screen's "ready" no longer counts; a screen that never reports is left to the settle rule.
    if (go(placePath(found.place))) noteScreen(null)
    for (const tag of found.place.open ?? []) {
      const [el] = (await settle([tag])) ?? []
      if (g !== run.gen) return
      if (!el) return lost()
      el.click()
    }
    await whenReady(found.screen, SETTLE_MS)
    if (g !== run.gen) return
  }
  if (g === run.gen) seam.showStep()
}

// Starts the next walkthrough in the queue, if any.
function carryOn() {
  const id = run.queue.shift()
  if (id) void start(id)
}

/** Records how the walkthrough ended, then plays the next in the queue (asking first) or `after`. */
export function finish(state: 'played' | 'skipped', after?: () => void) {
  const done = run.def
  if (!done) return // a second press of a button that already finished it
  end()
  saveQuietly({ seen: { [done.id]: state }, ...(done.id === 'welcome' ? { welcome: true } : {}) })
  if (state === 'skipped') {
    run.queue = []
    toast.info('Walkthrough skipped', {
      action: { label: 'Replay', onClick: () => playQueue([done.id]) },
    })
    return
  }
  if (after) {
    run.queue = []
    return after()
  }
  const upNext = run.queue[0] && defFor(run.queue[0])
  if (upNext) {
    // Assumption: the walkthroughs' names stand in for {previous} and {next}.
    set({
      bubble: {
        key: `between:${++run.gen}`,
        say: `That's **${done.name}** done. Next up is **${upNext.name}**.\n\nShall we carry on?`,
        mood: 'idle',
        place: 'corner',
        answers: [
          { label: 'Carry on', act: () => (set({ bubble: null }), carryOn()) },
          { label: 'Stop here', act: () => ((run.queue = []), set({ bubble: null })) },
        ],
        closable: false,
        typing: calm() ? 0 : LATER_MS,
      },
    })
    return
  }
  if (run.queueSize > 1) tell(ALL_DONE, 'pleased')
  run.queueSize = 0
}

/** Skips the walkthrough (the round close, Esc, browser Back): recorded, with a Replay toast. */
export function skip() {
  if (run.def) finish('skipped')
  // Nothing playing but the store says so (only seen after a hot reload replaced this module): clear it.
  else if (get().running) end()
}

/** Stops everything without recording anything (sign-in, sign-out); returns nothing. */
export function stopAll() {
  run.queue = []
  run.queueSize = 0
  end()
}

/** The walkthrough ends without being recorded, so it is offered again: its target never appeared.
    On the practice assessment the usual reason is that an earlier run used it up (the one amber
    observation is already confirmed, the sample walk already created): it is reset and the
    walkthrough starts again, once. Returns nothing. */
export function lost() {
  const was = run.def
  end()
  if (was && needsPractice(was) && run.retried !== was.id) {
    run.retried = was.id
    return void playAgain(was.id)
  }
  run.queue = []
  tell(LOST, 'concerned')
}

async function playAgain(id: string) {
  const g = run.gen
  const reference = await freshPractice()
  if (g !== run.gen) return
  if (!reference) return void ((run.queue = []), tell(LOST, 'concerned'))
  toast.info('Practice assessment reset')
  void start(id)
}

/** The app's answer took too long (fail.slow): recorded as played (the person did every step of
    theirs), so it is not offered again, and nothing queued after it starts by itself. */
export function tooSlow(say: string) {
  const done = run.def!
  end()
  run.queue = []
  saveQuietly({ seen: { [done.id]: 'played' } })
  tell(say, 'idle')
}

/** A try-it's AI failed part-way (signal 'try-it-failed'): it ends unrecorded with its own line. A
    hands-on step whose answer was refused or never came while it waited (the Overview's reply)
    shows again with the same words, so the person can act again, when its control is there to
    press; else it ends with the same line (the app is still busy with the first try). */
export function failedPartWay() {
  const { def } = run
  const again = run.waiting !== null && needed(tagsOf(run.steps[run.waiting])).every(findTarget)
  if (def && def.kind !== 'ai' && run.waiting !== null && again) {
    run.index = run.waiting!
    run.opened = -1 // the next step's open presses are made again on the next wait
    return seam.showStep()
  }
  if (!def || (def.kind !== 'ai' && run.waiting === null)) return
  const line = def.fail?.partway ?? CANT_RUN
  end()
  run.queue = []
  tell(line, 'concerned')
}

/** The screen `key` has gone (useWalkthroughScreen's cleanup). While the walkthrough waits on the
    app's answer on it, the person has left by one of the app's own links: it ends as a skip. A
    remount of the same screen (it shows again at once) does not count. Returns nothing. */
export function screenGone(key: string) {
  if (!run.def || run.watching !== key) return
  const g = run.gen
  setTimeout(() => {
    if (g === run.gen && run.watching === key && screenNow.current?.key !== key) finish('skipped')
  }, REMOUNT_MS)
}

// The walkthrough engine's public API (F-12): every other part (screens, Settings, the host) codes
// against exactly these. The store lives in state.ts; playing in player.ts; offers in offers.ts.
// Called by WalkthroughHost, useWalkthroughScreen and the Settings section. Calls api.ts.
import type { Session } from '../auth/api'
import * as api from './api'
import {
  resetOffers,
  screenLeft as leftScreen,
  screenShown as shownScreen,
  signalled,
} from './offers'
import {
  current,
  failedPartWay,
  freshPractice,
  playQueue,
  screenGone,
  skip,
  stopAll,
} from './player'
import { onAnySignal, onSignal, signal } from './signals'
import {
  defFor,
  get,
  go,
  navigatingItself,
  NOT_LOADED,
  resetStore,
  save,
  set,
  useWalkthroughs,
} from './state'
import type { Hold } from './state'
import type { WalkthroughRecord } from './types'

export type { WalkthroughRecord }
export { useWalkthroughs }

/** Loads the signed-in person's record and starts listening (Back/Forward, signals); returns the stop function. */
export function startEngine(session: Session): () => void {
  // A fresh start for this person: nothing of the last session (its record, role, screens, a
  // walkthrough or offer under way) may carry over, e.g. after signing out and in as someone else.
  resetOffers()
  stopAll()
  resetStore()
  set({
    // A session with no record (a gateway not yet restarted during a deploy) offers nothing and
    // plays no Welcome: without this, reading the missing record would take the app down.
    record: session.walkthroughs ?? NOT_LOADED,
    role: session.user.role,
    name: session.user.name.split(' ')[0],
  })
  // Browser Back or Forward during a walkthrough skips it (its screen is gone).
  const onPop = () => {
    if (!navigatingItself() && current()) skip()
  }
  window.addEventListener('popstate', onPop)
  const stopSignals = onAnySignal(signalled)
  const stopFailed = onSignal('try-it-failed', failedPartWay)
  return () => {
    window.removeEventListener('popstate', onPop)
    stopSignals()
    stopFailed()
    stopAll()
    resetOffers()
    resetStore()
  }
}

/** Replays one walkthrough, or several in order (Settings, "Show me"); returns nothing. */
export function play(ids: string[]): void {
  const playable = ids.filter(canPlay)
  if (playable.length) playQueue(playable)
}

/** Returns whether that walkthrough exists for the signed-in role. */
export function canPlay(id: string): boolean {
  return defFor(id) !== null
}

/** Returns whether a walkthrough is playing now. */
export function isRunning(): boolean {
  return current() !== null
}

/** Returns the id of the try-it ('ai') walkthrough playing now, else null. */
export function tryItRunning(): string | null {
  const playing = current()
  return playing?.kind === 'ai' ? playing.id : null
}

/** Switches the first-open offers on or off; resolves when saved. */
export async function setOffers(on: boolean): Promise<void> {
  try {
    await save({ offers: on })
  } catch (error) {
    // The switch goes back, so the screen never shows a setting that was not saved.
    set(({ record }) => ({ record: { ...record, offers: !on } }))
    throw error
  }
}

/** Clears the record (keeps the switch and the practice assessment); resolves when saved. */
export async function offerAllAgain(): Promise<void> {
  resetOffers()
  await save({ clear: true })
}

/** Sets up (or resets) the practice assessment; returns its reference. */
export async function setUpPractice(): Promise<string> {
  const reference = await freshPractice()
  // Thrown so Settings shows its "couldn't" toast.
  if (!reference) throw new Error('The practice assessment could not be set up')
  return reference
}

/** Removes the practice assessment; resolves when done. */
export async function removePractice(): Promise<void> {
  await api.removePractice()
  set(({ record }) => ({ record: { ...record, practice: null } }))
  // Without this its row would stay pinned on the Assessments list until the next read.
  signal('practice-changed')
}

/** Opens the practice assessment's Overview; does nothing when there is none. */
export function openPractice(): void {
  const { practice } = get().record
  if (practice) go(`/assessment?ref=${encodeURIComponent(practice)}&tab=overview`)
}

/** Called by useWalkthroughScreen: a screen is showing (ready = loaded, hold = offer nothing). */
export function screenShown(
  screen: string,
  ready: boolean,
  hold: Hold,
  words: Record<string, string> = {},
): void {
  shownScreen(screen, ready, hold, words)
}

/** Called by useWalkthroughScreen's cleanup: a screen has gone. */
export function screenLeft(screen: string): void {
  leftScreen(screen)
  screenGone(screen)
}

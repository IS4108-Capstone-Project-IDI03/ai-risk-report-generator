// When MarshBot offers a walkthrough (F-12): the Welcome by itself on a first-time account, a
// first-open offer 600 ms after a screen is ready, and the one-time "other way" offers after a signal.
// Called by useWalkthroughScreen (through engine.ts) and by every signal. Calls player.ts, state.ts, api.ts.
import { checkTryIt } from './api'
import { current, playQueue, stopAll, tell } from './player'
import type { Mood } from '../marshbot/types'
import {
  defFor,
  defsForRole,
  dropScreen,
  get,
  needsPractice,
  noteScreen,
  saveQuietly,
  screenNow,
  screenWords,
  set,
  type BubbleAnswer,
} from './state'
import type { Hold } from './state'
import type { Answer, WalkthroughDef } from './types'

export const OFFER_MS = 600

let timer: ReturnType<typeof setTimeout> | undefined
// What the corner shows now, so leaving its screen counts as Not now.
let offered: { screen: string; id: string | null; bare?: boolean } | null = null
// An "other way" offer whose signal has fired, waiting for a screen with no first-open offer.
let otherWay: NonNullable<WalkthroughDef['otherWay']> | null = null
// Try-its whose check failed this session: the "can't run" line is said once, not on every visit.
const told = new Set<string>()
let welcomeStarted = false

/** Forgets every offer made or waiting (sign-in, "Offer them all again"); the screen showing stays. */
export function resetOffers() {
  clearTimeout(timer)
  offered = null
  otherWay = null
  welcomeStarted = false
  told.clear()
}

/** A screen is showing; `ready` once its data has loaded, `hold` while nothing should be offered. */
export function screenShown(
  key: string,
  ready: boolean,
  hold: Hold,
  words: Record<string, string>,
) {
  noteScreen({ key, ready, hold })
  screenWords.current = words
  if (!ready) return
  // The Welcome is the one walkthrough that starts by itself: first-time account, first ready screen.
  const { record } = get()
  if (record.welcomeAt === null && !welcomeStarted && defFor('welcome')) {
    welcomeStarted = true
    return playQueue(['welcome'], true)
  }
  if (hold) clearTimeout(timer)
  else consider()
}

/** A screen has gone: a pending offer is dropped, and one on show counts as Not now. */
export function screenLeft(key: string) {
  const wasCurrent = screenNow.current?.key === key
  dropScreen(key)
  if (!wasCurrent) return
  clearTimeout(timer)
  if (offered?.screen === key) {
    const left = offered
    offered = null
    // An offer still unanswered counts as Not now. A bare walkthrough still on show counts as played:
    // it is one bubble and it was shown (a press on its OK closes the menu it points at first, so
    // the screen is gone before OK could record it).
    const open = !left.bare || current()?.id === left.id
    if (open && left.id) saveQuietly({ seen: { [left.id]: left.bare ? 'played' : 'declined' } })
    if (open && left.bare) stopAll()
    else if (open) set({ bubble: null })
  }
  // The screen underneath is current again: its own offer may still be due.
  consider()
}

/** A signal fired: counts it for the "other way" offers that wait on it, and readies one that is due. */
export function signalled(name: string) {
  const due = defsForRole()
    .map((d) => d.otherWay)
    .filter((ow) => ow && ow.after === name && !get().record.otherWay.includes(ow.id))
  if (!due.length) return
  saveQuietly({ count: name })
  const count = get().record.counts[name] ?? 0
  const ready = due.find(
    (ow) => count >= (ow!.count ?? 1) && get().record.seen[ow!.id]?.state !== 'played',
  )
  if (ready) {
    otherWay = ready
    consider()
  }
}

// Offers at most one thing on the ready screen: a first-open offer before an "other way" one.
function consider() {
  const screen = screenNow.current
  if (!screen?.ready || screen.hold || current() || get().bubble || !get().record.offers) return
  const { seen, practice } = get().record
  // A walkthrough that needs the practice assessment is held back while there is none (not declined).
  const playable = (d: WalkthroughDef) => practice !== null || !needsPractice(d)
  // A bare walkthrough (one bubble, no question) shows by itself; anything else needs an offer.
  const first = defsForRole().find(
    (d) => d.screen === screen.key && (d.offer || d.bare) && !seen[d.id] && playable(d),
  )
  if (!first && !otherWay) return
  const key = screen.key
  clearTimeout(timer)
  timer = setTimeout(() => void offer(key, first ?? null), OFFER_MS)
}

async function offer(key: string, first: WalkthroughDef | null) {
  const id = first?.id ?? otherWay!.id
  // A try-it is offered only when its quick check passes (Architecture 7).
  const ok = defFor(id)?.kind !== 'ai' || (await checkTryIt(id).catch(() => false))
  // While the check ran (up to 15 s) the screen may have changed, the person may have started typing
  // (hold), switched offers off, or started a walkthrough: then nothing shows, not even the "can't
  // run" line, which would otherwise replace the step that is playing.
  const now = screenNow.current
  if (now?.key !== key || !now.ready || now.hold || current() || get().bubble) return
  if (!get().record.offers) return
  if (!ok) {
    const line = first?.fail?.offer
    if (line && !told.has(id)) tell(line, 'concerned')
    told.add(id)
    return
  }
  if (first) {
    offered = { screen: key, id: first.id, bare: first.bare }
    // Bare: straight in where the person is; its OK records it as played (player.ts).
    if (first.bare) return playQueue([first.id], true)
    return show(first.offer!, 'idle', [
      { label: 'Show me', act: () => accept(() => playQueue([first.id])) },
      { label: 'Not now', act: () => decline(first.id) },
    ])
  }
  const ow = otherWay!
  otherWay = null
  offered = { screen: key, id: null }
  saveQuietly({ otherWay: [ow.id] })
  show(
    ow.say,
    ow.mood ?? 'idle',
    ow.answers.map((a) => ({ label: a.label, act: () => accept(() => follow(a)) })),
  )
}

function show(say: string, mood: Mood, answers: BubbleAnswer[]) {
  set({
    bubble: {
      key: `offer:${say}`,
      say,
      mood,
      place: 'corner',
      answers,
      closable: false,
      typing: 0,
    },
    targets: null,
    dim: false,
  })
}

// Show me (or an "other way" answer): the corner clears, then the answer runs.
function accept(then: () => void) {
  offered = null
  set({ bubble: null })
  then()
}

// Not now: recorded as declined, so it is not offered again (it stays in Settings).
function decline(id: string) {
  offered = null
  set({ bubble: null })
  saveQuietly({ seen: { [id]: 'declined' } })
}

// An "other way" answer: play the walkthrough it names, or simply close.
function follow(answer: Answer) {
  const then = answer.then
  if (typeof then === 'object' && 'play' in then) playQueue([then.play])
}

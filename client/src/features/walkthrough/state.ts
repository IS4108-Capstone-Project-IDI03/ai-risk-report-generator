// The walkthrough store and its small shared helpers (F-12): the saved record, who is signed in,
// and what WalkthroughHost draws (the bubble, the highlight's tags, the dimming).
// Read by engine.ts, player.ts, offers.ts and WalkthroughHost. Calls api.ts to save the record.
import { create } from 'zustand'
import type { UserRole } from '../accounts/api'
import type { Mood } from '../marshbot/types'
import { saveRecord } from './api'
import { DEFINITIONS } from './registry'
import type { Place, RecordPatch, WalkthroughDef, WalkthroughRecord } from './types'

export type BubbleAnswer = { label: string; act: () => void }

// One message as the host draws it. `key` changes with each message, which restarts the letters.
export type BubbleView = {
  key: string
  say: string
  mood: Mood
  // Beside the highlight, centred over the dimming, in the bottom-right corner, or beside the
  // target with no dimming.
  place: 'target' | 'card' | 'corner' | 'bare'
  // The stepper; `turn` greys Next (hands-on or waiting on AI), `done` = the hands-on action landed.
  // `noBack` greys Back (player.ts, canGoBack).
  step?: { at: number; total: number; turn?: 'hands' | 'wait'; done?: boolean; noBack?: boolean }
  answers?: BubbleAnswer[]
  closable: boolean
  // Typing dots before the first letter, in ms.
  typing: number
  // Every letter at once: the person has started on a hands-on step before the words were in.
  rushed?: boolean
}

export type WalkState = {
  record: WalkthroughRecord
  role: UserRole
  name: string // first name, for {name}
  running: { id: string; at: number; total: number } | null
  bubble: BubbleView | null
  // The data-walk tags the highlight goes round; null = no cut-out (a card, or between screens).
  targets: string[] | null
  // A hands-on step whose cut-out is wider than the control to press (a field round its Confirm
  // tick): the one tag that takes presses. null = the whole cut-out does.
  press: string | null
  // Each target has its own cut-out (StepDef.apart).
  apart: boolean
  // A target too tall to show whole shows its end (StepDef.show).
  end: boolean
  dim: boolean
  // The "Your turn" ring round the highlight: breathing, or green once the action lands.
  ring: 'off' | 'on' | 'done'
  // The step points at the sidebar: on a phone the navigation drawer is opened for it.
  nav: boolean
}

// Until startEngine loads the real record: no Welcome and no offers. Without this, a screen that
// reports itself before the engine has started would see a first-time account.
export const NOT_LOADED: WalkthroughRecord = {
  welcomeAt: '1970-01-01T00:00:00.000Z',
  offers: false,
  seen: {},
  otherWay: [],
  counts: {},
  practice: null,
}

const INITIAL: WalkState = {
  record: NOT_LOADED,
  role: 'risk_engineer',
  name: '',
  running: null,
  bubble: null,
  targets: null,
  press: null,
  apart: false,
  end: false,
  dim: false,
  ring: 'off',
  nav: false,
}

export const useWalkthroughs = create<WalkState>(() => INITIAL)

export const get = useWalkthroughs.getState
export const set = useWalkthroughs.setState

/** Returns the definition with that id if the signed-in role can play it, else null. */
export function defFor(id: string): WalkthroughDef | null {
  return DEFINITIONS.find((d) => d.id === id && d.roles.includes(get().role)) ?? null
}

/** Returns every definition the signed-in role can play. */
export function defsForRole(): WalkthroughDef[] {
  return DEFINITIONS.filter((d) => d.roles.includes(get().role))
}

/** Applies a change to the record here at once and saves it; resolves when the gateway has it. */
export async function save(patch: RecordPatch): Promise<void> {
  const now = new Date().toISOString()
  set(({ record }) => {
    const next = { ...record }
    if (patch.clear) Object.assign(next, { welcomeAt: null, seen: {}, otherWay: [], counts: {} })
    if (patch.welcome) next.welcomeAt = now
    if (patch.offers !== undefined) next.offers = patch.offers
    if (patch.seen)
      next.seen = {
        ...next.seen,
        ...Object.fromEntries(
          Object.entries(patch.seen).map(([id, state]) => [id, { state, at: now }]),
        ),
      }
    if (patch.otherWay) next.otherWay = [...new Set([...next.otherWay, ...patch.otherWay])]
    if (patch.count)
      next.counts = { ...next.counts, [patch.count]: (next.counts[patch.count] ?? 0) + 1 }
    return { record: next }
  })
  await saveRecord(patch)
}

/** Saves without waiting; a failed save must never break a walkthrough that is playing. */
export function saveQuietly(patch: RecordPatch): void {
  save(patch).catch(() => undefined)
}

// The screen showing now, as useWalkthroughScreen last told it; null between screens.
// `hold`: nothing is offered now; 'unsaved' = because of unsaved work, which a walkthrough never leaves.
export type Hold = boolean | 'unsaved'
export type ScreenNow = { key: string; ready: boolean; hold: Hold }
export const screenNow: { current: ScreenNow | null } = { current: null }
const waiting = new Set<() => void>()

// Every screen showing, innermost last: a screen's ready call can sit inside another's (the New
// assessment menu over the Assessments list), and leaving the inner one must put the outer one back.
const shown: ScreenNow[] = []

/** Records a screen as showing (updating it if it already is; null forgets them all, e.g. after the
    engine navigates) and wakes anything waiting for it; returns nothing. */
export function noteScreen(now: ScreenNow | null) {
  if (!now) shown.length = 0
  else {
    const at = shown.findIndex((s) => s.key === now.key)
    if (at >= 0) shown[at] = now
    else shown.push(now)
  }
  screenNow.current = shown[shown.length - 1] ?? null
  waiting.forEach((wake) => wake())
}

/** Puts the store, the screen stack and the screen's words back as before any sign-in (a new
    session, or signing out), so nothing of one person's record or role reaches the next. */
export function resetStore() {
  shown.length = 0
  screenNow.current = null
  screenWords.current = {}
  set(INITIAL, true)
}

/** Forgets one screen; the one it sat on (if any) becomes current again. Returns nothing. */
export function dropScreen(key: string) {
  const at = shown.findIndex((s) => s.key === key)
  if (at >= 0) shown.splice(at, 1)
  screenNow.current = shown[shown.length - 1] ?? null
}

/** Resolves true once screen `key` says it is ready, or false after `ms` (no polling: woken by noteScreen). */
export function whenReady(key: string, ms: number): Promise<boolean> {
  const ready = () => screenNow.current?.key === key && screenNow.current.ready
  if (ready()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const wake = () => {
      if (!ready()) return
      waiting.delete(wake)
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => (waiting.delete(wake), resolve(false)), ms)
    waiting.add(wake)
  })
}

// Words a screen supplies for its messages ({engineer}), set by useWalkthroughScreen.
export const screenWords: { current: Record<string, string> } = { current: {} }

/** Returns the message with {name}, {engineer} and the like filled in; an unknown one stays as is. */
export function fill(text: string): string {
  const words: Record<string, string> = { name: get().name, ...screenWords.current }
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => words[key] ?? whole)
}

/** Returns whether the walkthrough must play on the practice assessment: a hands-on or try-it one
    whose place names {practice}. A tell-only one plays where the person is (it changes nothing). */
export const needsPractice = (def: WalkthroughDef) =>
  def.kind !== 'tell' && def.place.path.includes('{practice}')

/** Returns the path a place opens, with {practice} filled in. */
export function placePath(place: Place): string {
  return place.path.replace('{practice}', encodeURIComponent(get().record.practice ?? ''))
}

/** Returns whether the browser is already at that place (same path and the same query values). */
export function atPlace(place: Place): boolean {
  const want = new URL(placePath(place), window.location.origin)
  if (want.pathname !== window.location.pathname) return false
  const here = new URLSearchParams(window.location.search)
  return [...want.searchParams].every(([key, value]) => here.get(key) === value)
}

// True while the engine itself changes the URL, so its own popstate is not read as Back.
let selfNav = false
/** Returns whether the current popstate came from the engine's own navigation. */
export const navigatingItself = () => selfNav

/** Opens a path the way the app's own links do (notifications/openSubject.ts): push, then popstate.
    Returns false when the browser is already there. */
export function go(path: string): boolean {
  if (window.location.pathname + window.location.search === path) return false
  selfNav = true
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  selfNav = false
  return true
}

/** Returns whether the person asked for less motion; true makes every letter show at once. */
export function calm(): boolean {
  return (
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Returns a promise that resolves after `ms`. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

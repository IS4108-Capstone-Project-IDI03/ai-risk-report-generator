// The shapes of a walkthrough definition and of the saved walkthrough record (F-12).
// Definitions are data only, one walkthroughs.ts per feature folder; read by registry.ts and engine.ts.
// The record must match the gateway's (contract-gateway.md, user_settings.walkthroughs).
import type { UserRole } from '../accounts/api'
import type { Mood } from '../marshbot/types'

// What a hands-on step waits for, in order. The highlight follows the current one.
export type Action =
  | { press: string } // a press on the element tagged data-walk="<tag>"
  | { signal: string; at?: string } // a named signal from the app; `at` is what to highlight meanwhile (default: the step's target)

export type AnswerThen =
  | 'next' // carry on to the next step (Welcome: "Show me around")
  | 'end' // finish here (recorded as played)
  | 'skip' // leave (recorded as skipped)
  | { play: string } // finish this one, then start that walkthrough (opening its place first)
  | { emit: string } // fire signal(<name>) (the screen does the work, e.g. "Use the sample email"), then the next step

export type Answer = {
  label: string
  labelAdmin?: string
  then: AnswerThen
  thenAdmin?: AnswerThen
}

export type StepDef = {
  // While a step shows, each element it highlights carries the attribute `data-walk-on` (set by
  // WalkthroughHost, removed when the step changes or the walkthrough ends): screens use it to keep
  // hover-only controls visible, e.g. `tr[data-walk-on] .row-actions { opacity: 1 }`.
  // data-walk tag(s); several = one highlight round all of them. Absent on a card. A tag ending in
  // "?" is lit only if it is on the screen (table headings that a phone's layout leaves out); at
  // least one tag has no "?".
  target?: string | string[]
  apart?: true // several tags are lit one by one, not as one box round them all (three buttons with others between them)
  show?: 'end' // a target too tall to show whole shows its end, not its start (the words are about what is at its bottom)
  say: string // "\n\n" starts a paragraph, a line starting "- " is a bullet, **bold** marks key words, {name} and {engineer} are filled in
  sayAdmin?: string // the admin's words where they differ
  only?: UserRole // a step for one role
  optional?: boolean // skipped (and the bar renumbers) when its target is not on the screen within the settle time
  mood?: Mood
  card?: boolean // centred over a fully dimmed screen (welcome and end cards)
  answers?: Answer[] // a question: answer buttons instead of the stepper
  // Hands-on ("Your turn"): moves on when the last action lands, then holds 900 ms (player.ts
  // BEAT_MS) so the person sees what changed before the next step speaks.
  // - The cut-out is the CURRENT action's element (its `press` tag, or a signal's `at` tag, else the
  //   step's target), and EVERYTHING inside it is pressable; the rest of the page is blocked. So tag
  //   the one control itself: an `at` that wraps three buttons lets all three through.
  // - A `press` whose step `target` is on the screen and holds the pressed control (a field round its
  //   Confirm tick): the cut-out and ring go round the target, and only the pressed control inside it
  //   takes presses. The press itself ends the spotlight.
  // - A `signal` (more to do than one press: pick from a menu, type, record): at the first press or
  //   key inside the cut-out the spotlight (dimming, cut-out, ring, blocking) fades out in 150 ms and
  //   the whole page is usable until the signal lands; the bubble stays put. A later action in the
  //   same step brings the spotlight back on its own control.
  // - A signal raised after the step before landed but before this step showed counts as landed.
  do?: Action[]
  wait?: string // waits on AI: Next is greyed with "One moment"; moves on by itself on this signal
  open?: string[] // tags to press, in order, before the step shows (open a tab, a menu, a section)
  nav?: true // the step points at the sidebar: on a phone the navigation drawer opens first
}

// Where a walkthrough plays, so a replay from Settings (or a queue) can open it.
export type Place = {
  path: string // e.g. '/clients', '/assessment?ref={practice}&tab=checklist' ({practice} = the practice reference)
  open?: string[] // tags to press after the screen settles (a sub-tab, a section, a menu)
}

export type WalkthroughDef = {
  id: string // the id in walkthroughs.json, e.g. 'clients'
  name: string // "Find a client"
  group: string // "Day to day"
  roles: UserRole[]
  kind: 'tell' | 'hands' | 'ai'
  screen: string // the key the screen passes to useWalkthroughScreen
  place: Place
  offer?: string // the first-open offer's words; absent = never offered by itself
  bare?: true // one bubble beside its target with no dimming and no stepper (new-choice, proposals-list)
  // A try-it's own lines when the quick check fails or it fails part-way; `slow` ends a waiting step
  // that has waited `afterMs` with its own line (the AI's work carries on without the walkthrough).
  fail?: {
    offer?: string
    replay?: string
    partway?: string
    slow?: { afterMs: number; say: string }
  }
  otherWay?: {
    after: string
    count?: number
    id: string
    mood?: Mood
    say: string
    answers: Answer[]
  } // the one-time "other way" offer: after signal `after` has fired `count` times (default 1), offer walkthrough `id`
  steps: StepDef[]
}

// The saved record (user_settings.walkthroughs), sent by GET /api/auth/me and POST /api/auth/login.
export type WalkthroughRecord = {
  welcomeAt: string | null
  offers: boolean
  seen: Record<string, { state: 'played' | 'skipped' | 'declined'; at: string }>
  otherWay: string[]
  counts: Record<string, number>
  practice: string | null
}

// One change to the record, as PATCH /api/settings/me takes it under `walkthroughs`.
export type RecordPatch = {
  welcome?: true
  offers?: boolean
  seen?: Record<string, 'played' | 'skipped' | 'declined'>
  otherWay?: string[]
  count?: string
  clear?: true
}

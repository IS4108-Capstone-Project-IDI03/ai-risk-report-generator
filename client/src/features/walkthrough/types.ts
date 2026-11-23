// The shapes of a walkthrough definition and of the saved walkthrough record (F-12).
// Definitions are data only, one walkthroughs.ts per feature folder; read by registry.ts and engine.ts.
// The record must match the gateway's (contract-gateway.md, user_settings.walkthroughs).
import type { UserRole } from '../accounts/api'
import type { Mood } from '../marshbot/types'

// What the person does on a hands-on step, in order. Only the first action's control is lit.
export type Action =
  | { press: string } // a press on the element tagged data-walk="<tag>"
  | { signal: string; at?: string } // a named signal the person's own action raises; `at` (first action only) is what to light (default: the step's target)

export type AnswerThen =
  | 'next' // carry on to the next step (Welcome: "Show me around")
  | 'end' // finish here (recorded as played)
  | 'skip' // leave (recorded as skipped)
  | { play: string } // finish this one, then start that walkthrough (opening its place first)
  // Fire signal(<name>) (the screen does the work, e.g. "Use the sample email"), then the next step
  // (after the step's `until`, when it has one).
  | { emit: string }

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
  // Hands-on ("Your turn"): what the PERSON does, in order. The cut-out is the first action's
  // element (its `press` tag, else a signal's `at`, else the step's target), and everything inside it
  // is pressable; the rest of the page is blocked, so tag the one control itself.
  // - A single `press` keeps the spotlight until the press.
  // - More to do (a `signal`: choose, type, record; or several actions): at the first press or key
  //   inside the cut-out the spotlight goes, and the bubble stays where it is with the instructions.
  //   It never comes back on a later action of the same step.
  // - A signal that is the person's own save landing (Confirm, Accept, Save) is a `do` action, so a
  //   refused save leaves the step showing and the person can act again.
  // - Once the last action lands, the bubble and the spotlight leave at once and nothing of the
  //   walkthrough shows until the next step (player.ts, quiet).
  do?: Action[]
  // The app's own "result is ready" signal after the person's part (an AI answer, a turn shown): the
  // walkthrough shows nothing until it comes (remembered if early), then 1 s more, then the next
  // step. A next step's `open` presses are made a second after the person's action, so they watch
  // the app work on the right screen.
  until?: string
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
  // A try-it's own lines when the quick check fails or it fails part-way; `slow` ends the wait for
  // a step's `until` after `afterMs` with its own line (the AI's work carries on without the
  // walkthrough). Without `slow` that wait is limited to 90 s (player.ts, QUIET_LIMIT_MS).
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

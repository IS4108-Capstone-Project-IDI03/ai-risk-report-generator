// The assessment assistant's shared shapes (AS-06): the items MarshBot's checks
// raise, and the conversation it shows on an assessment's Overview.
// Built by assistant/recheck.service.ts and thread/, read by the assistant
// routes and sent to the browser. Must match client/src/features/marshbot/types.ts.

// An assessment's stage. Stored on the assessment and only ever moves forward
// (ADR .local-docs/adr/0001). Archived stays separate (Assessment.archivedAt).
export const STAGES = [
  'setup',
  'prepare',
  'capture',
  'ready_for_generation',
  'generate',
  'review',
  'ready_to_export',
  'exported',
] as const
export type Stage = (typeof STAGES)[number]

// How an item weighs. fix_now can't be dismissed and makes MarshBot concerned;
// a gap is something missing; a reminder comes from the engineer's activity
// (never shown to an admin); info is a plain fact (e.g. "transcription still running").
export type ItemWeight = 'fix_now' | 'gap' | 'reminder' | 'info'

// Where an item's link goes: a workspace tab, with optional URL query params
// (e.g. { obs: '<id>' }, { walk: '<id>' }, { section: '9' }, { area: 'Fire Protection' }).
export type ItemLink = {
  tab: 'overview' | 'checklist' | 'observations' | 'generate' | 'review' | 'export'
  params?: Record<string, string>
}

// One thing MarshBot can point at. Every number, name and status shown on
// screen comes from `title`/`detail`/`facts`, written by the rules; the AI
// only refers to an item by its id.
export type BriefItem = {
  // Stable while the thing it is about exists, e.g. "capture.failed-transcription:<recordingId>".
  id: string
  // The check that raised it (one file per check), e.g. "failed-transcription".
  kind: string
  stage: Stage | 'any'
  weight: ItemWeight
  title: string // short, e.g. "Loading Bay 2"
  detail: string | null // one line, e.g. "1:48 · Couldn't transcribe"
  // The same thing as one plain sentence, for the Focus list, e.g. "A recording from Loading Bay 2 couldn't be transcribed."
  fact: string
  // Lucide icon name for the row's tile (lucide-static 0.451.0).
  icon: string
  link: ItemLink | null
  // An in-place action the row's button performs instead of following the link.
  action: 'retry-transcription' | 'retry-page' | null
  actionTarget: string | null // e.g. "<observationId>:<recordingId>"
  // The item's facts, for wording and for the change test behind dismissals.
  facts: Record<string, string | number | boolean | null>
  // A fingerprint of `facts`: a dismissal holds until this changes (AC 6).
  fingerprint: string
  dismissible: boolean // false for fix_now
  firstSeenAt: string // ISO
  resolvedAt: string | null // set when the check stops raising it
}

// The checklist by area, for the checklist card (canvas C4, H1). Server only.
export type AreaHealth = {
  area: string
  total: number // active checklist items in the area
  covered: number // items answered by an observation or a check mark
  thin: boolean // under `thinShare` of its items answered (the coverage check adds its own rows)
  open: { id: string; text: string }[] // its active items not answered yet, in checklist order
}

// One report section's state, for the outline (board 02) and the admin lanes (board 07).
export type SectionState = {
  sectionId: string // '2'…'12'
  title: string
  state: 'reviewed' | 'decisions' | 'not_started'
  date: string | null // drafted date (not_started) or reviewed date (reviewed)
  openComments: number
}

export type Mood = 'idle' | 'concerned' | 'pleased' | 'thinking'

// What the Focus list (AC 12) and the list marks carry.
export type PriorityReason = 'overdue' | 'fix_now' | 'short_on_time'
export type Priority = { reason: PriorityReason; text: string; rank: number }

// ---------------------------------------------------------------------------
// The conversation thread (AS-06 feedback rounds 2-5). MarshBot is a saved
// conversation: turns are kept, one topic is raised at a time, and a card's
// rows change in place. Built by server assistant/thread/, drawn by client
// marshbot/components/thread/. Must match client/src/features/marshbot/types.ts. The canvas screens are the reference:
// https://claude.ai/artifact/6sXguaSHHx1QRj6AETHPp8
// ---------------------------------------------------------------------------

// A tile's colour: what kind of thing the row is.
export type Tone = 'neutral' | 'violet' | 'amber' | 'red' | 'green'

// What a row ends in. Exactly one, always in the same slot, flush right.
export type RowEnd =
  // A soft pill with the row's own verb ("Review", "Try again", "Open", "Continue").
  // `action` runs in place (retry); otherwise it follows `link`.
  | {
      type: 'button'
      label: string
      icon: string | null
      link: ItemLink | null
      action: BriefItem['action']
      actionTarget: string | null
    }
  // A round arrow button: the row only opens something. `label` is its tooltip, e.g. "Open in Checklist".
  | { type: 'open'; link: ItemLink; label: string }
  // A status where the button was: "Done" with a tick, or a spinner with "Transcribing".
  | { type: 'status'; status: 'done' | 'busy'; label: string }
  // A green tick: a fact that is fine.
  | { type: 'tick' }

export type CardRow = {
  id: string // the item id it came from, or a stable key
  icon: string // lucide name
  tone: Tone
  title: string
  detail: string | null // one short status, e.g. "9 proposed observations"
  bad: boolean // draw `detail` in red ("Couldn't transcribe")
  quote: string | null // the engineer's own words in quotes; no longer set (round 7), kept for saved turns
  end: RowEnd
}

// A thing that is fine, as one cell in an even row of ticks.
export type TickCell = {
  title: string
  detail: string | null
  bar: { covered: number; total: number } | null
}

// One line of the outline: every item is listed, each with its state.
export type OutlineState = 'ok' | 'wait' | 'new' | 'question' | 'figures' | 'bad'
export type OutlineItem = {
  no: string
  title: string
  state: OutlineState
  note: string | null
  link: ItemLink | null
}

export type Card =
  // Things to do, ticking off in place (canvas 1-3). `done`/`total` head the card.
  | { type: 'tasks'; id: string; title: string; done: number; total: number; rows: CardRow[] }
  // Named items, optionally with what is already fine underneath and one button (canvas 5, 13, S1-S3, S8, 10).
  | {
      type: 'rows'
      id: string
      title: string
      note: string | null
      rows: CardRow[]
      ticks: TickCell[]
      cta: { label: string; link: ItemLink } | null
    }
  // The checklist: areas that need more opened up, the rest as ticks (canvas 4).
  | {
      type: 'checklist'
      id: string
      answered: number
      total: number
      gaps: {
        area: string
        icon: string
        tone: 'red' | 'amber'
        covered: number
        total: number
        items: string[]
        more: number
        link: ItemLink
      }[]
      fine: TickCell[]
    }
  // Every checklist area as a bar (canvas H1, the catch-up).
  | {
      type: 'bars'
      id: string
      answered: number
      total: number
      areas: {
        area: string
        icon: string
        covered: number
        total: number
        low: boolean
        link: ItemLink
      }[]
    }
  // The outline: all items with their state, the next one highlighted, one button (canvas S4-S7, G1).
  | {
      type: 'outline'
      id: string
      title: string
      lead: string
      items: OutlineItem[]
      next: string | null
      key: { state: OutlineState; label: string }[]
      cta: { label: string; link: ItemLink } | null
    }
  // Admin: sections in lanes (canvas S9).
  | {
      type: 'lanes'
      id: string
      title: string
      note: string
      lanes: {
        state: 'wait' | 'new' | 'ok'
        label: string
        items: { no: string; title: string; date: string | null; comments: number }[]
      }[]
    }
  // Admin: time in each stage (canvas S9).
  | {
      type: 'stage-time'
      id: string
      title: string
      note: string
      spans: { label: string; days: number; now: boolean }[]
    }

// One bubble of words. 'good' is the green acknowledgement.
export type Say = { text: string; tone: 'normal' | 'good' }

export type Turn = {
  id: string // stable for the life of the thread
  who: 'bot' | 'engineer'
  at: string // ISO
  // What the turn is about: 'greeting', 'todo', 'checklist', 'gaps', 'visit-question', 'reply', 'ack', …
  topic: string
  mood: Mood // MarshBot's face beside this turn (bot turns)
  says: Say[] // an engineer turn has exactly one
  cards: Card[]
  // The same turn in OpenUI Lang, written once by the wording AI while the turn is hidden, never
  // changed after. A turn whose words sit between its cards starts with the server's own program
  // in that order. null = draw says then cards.
  program: string | null
}

// A choice under the newest bot turn. Only the newest bot turn offers replies.
export type Reply = {
  id:
    | 'nothing-more'
    | 'ready-to-generate'
    | 'another-visit'
    | 'add-observations'
    | 'export-again'
    | 'not-now' // no longer offered; kept so saved threads still load
    | 'skip'
    | 'what-else'
    | 'generate-anyway'
  label: string
  primary: boolean // exactly one reply is primary (solid navy)
  picksDate: boolean // 'another-visit': calendar, then confirm, then send with `date`
  // Set = this choice only opens something: the button follows the link and no reply is posted.
  link: ItemLink | null
}

// One day's (or stage's) conversation. Earlier ones fold away, read-only.
export type Session = { id: string; startedAt: string; stage: Stage; turns: Turn[] }

// A fact in the rail's "At a glance".
export type GlanceFact = {
  icon: string
  label: string
  value: string
  tone: 'normal' | 'amber' | 'red' | 'green'
}

export type AssistantThread = {
  reference: string
  viewer: 'engineer' | 'admin'
  engineerName: string | null
  stage: Stage
  stageDates: Record<Stage, string | null>
  surveyStart: string | null
  surveyEnd: string | null
  reportDue: string | null
  client: { id: string | null; name: string; reference: string }
  mood: Mood
  // The status pill under MarshBot's name in the rail: an icon and a few words, as on the earlier boards
  // (r2.css `.mood`). red = fix first ("2 things to fix", icon circle-alert); amber = needs you
  // ("2 areas need more", "5 sections to review"); green = done ("All caught up", "Ready to export");
  // blue = waiting or watching ("1 question for you", "Waiting for your next visit", "<Engineer>'s assessment").
  status: { text: string; tone: 'red' | 'amber' | 'green' | 'blue'; icon: string }
  glance: GlanceFact[] // exactly 3
  earlier: Session[] // oldest first, read-only
  session: Session // the conversation now
  replies: Reply[] // for the newest bot turn; [] when nothing is asked
  // MarshBot is writing its next turn (or checking coverage): show the typing dots.
  thinking: boolean
  updatedAt: string
}

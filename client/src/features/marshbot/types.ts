// The assessment assistant's shared shapes (AS-06), as the gateway sends them.
// Read by the MarshBot Overview, the Focus list and the list marks.
// Must match server/src/services/assistant/types.ts.

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

// Where an item's link goes: a workspace tab, with optional URL query params
// (e.g. { obs: '<id>' }, { walk: '<id>' }, { section: '9' }, { area: 'Fire Protection' }).
export type ItemLink = {
  tab: 'overview' | 'checklist' | 'observations' | 'generate' | 'review' | 'export'
  params?: Record<string, string>
}

// MarshBot's face beside a turn and in the rail.
export type Mood = 'idle' | 'concerned' | 'pleased' | 'thinking'

// What the Focus list (AC 12) and the list marks carry.
export type PriorityReason = 'overdue' | 'fix_now' | 'short_on_time'
export type Priority = { reason: PriorityReason; text: string; rank: number }

// ---------------------------------------------------------------------------
// The conversation thread (AS-06 feedback rounds 2-5). MarshBot is a saved
// conversation: turns are kept, one topic is raised at a time, and a card's
// rows change in place. Built by server assistant/thread/, drawn by client
// marshbot/components/thread/. Must match server/src/services/assistant/types.ts. The canvas screens are the reference:
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
      action: 'retry-transcription' | 'retry-page' | null
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

// A choice in the action slot under the newest bot turn. Only the newest bot turn offers them.
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

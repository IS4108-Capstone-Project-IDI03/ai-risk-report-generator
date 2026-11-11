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

// The checklist by area, for the health bars (board 01).
export type AreaHealth = {
  area: string
  total: number // active checklist items in the area
  covered: number // items answered by an observation or a check mark
  thin: boolean // under `thinShare` of its items answered (the coverage check adds its own rows)
}

// One report section's state, for the outline (board 02) and the admin lanes (board 07).
export type SectionState = {
  sectionId: string // '2'…'12'
  title: string
  state: 'reviewed' | 'decisions' | 'not_started'
  date: string | null // drafted date (not_started) or reviewed date (reviewed)
  openComments: number
}

// A button MarshBot offers. Pressing it sends `label` as the engineer's reply.
export type QuickReply = {
  id: 'nothing-more' | 'ready-to-generate' | 'another-visit' | 'export-again' | 'not-now'
  label: string
  primary: boolean
  picksDate: boolean // 'another-visit' opens the date picker; the reply names the day
}

// A widget inside a message, in order. The fallback renders these directly;
// the OpenUI program refers to the same things by id.
export type MessagePart =
  | { type: 'actions'; itemIds: string[] } // action rows (board 01 site walk + recording)
  | { type: 'health'; areas: string[] } // health bars for these areas ([] = all)
  | { type: 'outline' } // report outline (board 02)
  | { type: 'lanes' } // admin status lanes (board 07)
  | { type: 'stage-time' } // admin time in each stage (board 07)
  | { type: 'file' } // the exported file (board 03)
  | { type: 'replies'; replies: QuickReply[] }
  | { type: 'link'; label: string; link: ItemLink; icon: string } // e.g. "Continue Fire Protection", "Add observation"

export type BriefMessage = {
  // Stable for the same content, so the browser knows which messages are new.
  id: string
  // The plain words the rules wrote: shown when there is no program or it fails.
  text: string
  // The same message in OpenUI Lang from the wording AI, or null (templates first).
  program: string | null
  parts: MessagePart[]
  tone: 'normal' | 'success' | 'question'
}

// A past exchange: MarshBot's question, the engineer's reply, MarshBot's answer.
export type ThreadEntry = {
  who: 'bot' | 'engineer'
  text: string
  at: string // ISO
  tone: 'normal' | 'success' | 'question'
}

export type Mood = 'idle' | 'concerned' | 'pleased' | 'thinking'

export type AssistantBrief = {
  reference: string
  viewer: 'engineer' | 'admin' // admin = not the assigned engineer: stage and progress only (AC 11)
  engineerName: string | null
  stage: Stage
  // When each reached stage was entered (null = not reached yet). For the rail dates and the admin's time in each stage.
  stageDates: Record<Stage, string | null>
  surveyStart: string | null // YYYY-MM-DD
  surveyEnd: string | null // YYYY-MM-DD (siteVisitEndDate, else siteVisitDate)
  reportDue: string | null // YYYY-MM-DD
  client: { id: string | null; name: string; reference: string } // the rail's client card
  mood: Mood
  items: BriefItem[] // open items the viewer may see, dismissed ones removed
  areas: AreaHealth[]
  sections: SectionState[]
  export: { fileName: string; exportedAt: string; pages: number | null } | null
  // Coverage check (AC 7): 'running' shows the typing dots, 'failed' says so once.
  coverage: { status: 'idle' | 'running' | 'done' | 'failed'; checkedAt: string | null }
  thread: ThreadEntry[] // earlier exchanges, oldest first
  messages: BriefMessage[] // what MarshBot says now, in order
  // When this viewer last opened the Overview before now; messages are paced only if something changed since.
  lastOpenedAt: string | null
  updatedAt: string // ISO, bumps on every re-check
}

// What the Focus list (AC 12) and the list marks carry.
export type PriorityReason = 'overdue' | 'fix_now' | 'short_on_time'
export type Priority = { reason: PriorityReason; text: string; rank: number }

// The thread engine's own shapes (AS-06 round 5): what a topic builder reads
// and returns. Used by every file in thread/. The shapes sent to the browser
// are in ../types.ts ("The conversation thread").
import type { IAssistantBrief } from '../../../models/assistant-brief.model'
import type { StoredSession, Waiting } from '../../../models/assistant-thread.model'
import type { BriefFacts } from '../phrases'
import type { AssistantThread, BriefItem, Card, Mood, Reply, Say } from '../types'

// The stored brief the conversation is built from (recheck.service.ts saves it).
export type ThreadBrief = Pick<
  IAssistantBrief,
  'reference' | 'stage' | 'items' | 'areas' | 'sections' | 'coverage'
> & { facts: BriefFacts; updatedAt: Date }

// The assigned engineer, as MarshBot talks to them.
export type ThreadViewer = {
  name: string
  // "Not now" on the stale export holds while its fingerprint is unchanged.
  dismissed: { itemId: string; fingerprint: string }[]
  exportAgain: string | null
}

// What a topic builder reads: the brief, who it's for, and this session so far.
export type TopicCtx = {
  brief: ThreadBrief
  facts: BriefFacts
  open: BriefItem[] // open items
  first: string // the engineer's first name
  viewer: ThreadViewer
  now: Date
  today: string
  said: string[]
  catchUp: boolean // this session follows an earlier one
  // Rebuilding a posted turn's cards: a builder draws its card even with nothing left open.
  rebuild?: boolean
}

export type Status = AssistantThread['status']

// One topic as MarshBot raises it. Cards carry a local id ('todo', 'thin', …)
// that the turn prefixes, so a rebuilt card keeps its id.
export type Built = {
  kind: Waiting['kind']
  says: Say[]
  cards: Card[]
  items?: string[] // a tasks topic's item ids
  replies?: Reply[] // a question's own replies
  // The question itself, posted as its own bubble after the cards (S1, S8).
  after?: Say[]
  mood: Mood
  status: Status // the rail's pill while MarshBot waits on this topic
}

export type TopicDef = {
  // `items` is a tasks turn's saved item ids, so its card keeps the same rows.
  build: (ctx: TopicCtx, items?: string[]) => Built | null
  // The item kinds this topic speaks for; the rest go to "Also worth a look".
  claims: (item: BriefItem) => boolean
}

export type Event =
  { type: 'open' } | { type: 'changed' } | { type: 'reply'; reply: Reply['id']; date?: string }

export type ThreadState = { earlier: StoredSession[]; session: StoredSession | null }

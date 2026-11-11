// What MarshBot's message parts read instead of props (AS-06): the brief and its actions, the
// message being drawn, and how much of each part has been revealed so far. Provided by
// screens/MarshBotOverview.tsx and components/MessageBody.tsx; read by library.tsx's parts.
import { createContext, useContext } from 'react'
import type { AssistantBrief, BriefItem, BriefMessage, ItemLink, QuickReply } from './types'

export type MarshBot = {
  brief: AssistantBrief
  // Items a push just resolved: their rows tick off, then fold away.
  ticked: Map<string, BriefItem>
  openLink: (link: ItemLink) => void
  // Sends a quick reply; the message's buttons give way to the engineer's own bubble.
  answer: (messageId: string, reply: QuickReply, date?: string) => void
  // The message whose reply is on its way, so its buttons hide.
  answering: string | null
  // Resolves false when the gateway refused, so the row comes back.
  dismiss: (itemId: string) => Promise<boolean>
  // Runs a row's in-place action (retry a transcription); resolves when the gateway took it.
  act: (item: BriefItem) => Promise<void>
}

export const MarshBotContext = createContext<MarshBot | null>(null)

/** Returns the brief and its actions; only valid inside the MarshBot Overview. */
export function useMarshBot(): MarshBot {
  const value = useContext(MarshBotContext)
  if (!value) throw new Error('MarshBot parts need the MarshBot Overview around them')
  return value
}

// The message being drawn, for the parts that look up its replies and links by id.
export const MessageContext = createContext<BriefMessage | null>(null)

// How much of one top-level part shows: all of it, none, or (for words) the first `words`.
export type Reveal = { state: 'full' | 'hidden' | 'partial'; words: number }
export const RevealContext = createContext<Reveal>({ state: 'full', words: Infinity })

// Where the reveal has got to in the message: parts before `part` show in full.
export type Cursor = { part: number; words: number } | 'all' | 'none'
export const CursorContext = createContext<Cursor>('all')

// Called when a part throws, so the message falls back to its plain words (MessageBody).
export const FailContext = createContext<() => void>(() => {})

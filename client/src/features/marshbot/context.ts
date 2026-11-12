// What the thread's turns and cards read instead of props (AS-06): the thread and its actions,
// the turn being drawn, and each piece's place in it. Provided by screens/MarshBotOverview.tsx
// and components/thread/TurnBody.tsx; read by the cards and by library.tsx's Say and Card.
import { createContext, useContext } from 'react'
import type { AssistantThread, CardRow, ItemLink, Turn } from './types'

export type MarshBot = {
  thread: AssistantThread
  openLink: (link: ItemLink) => void
  // Runs a row's Try again; the row shows "Transcribing" at once.
  retry: (row: CardRow) => void
  // Rows whose Try again was pressed and the gateway hasn't answered for yet.
  busy: Set<string>
}

export const MarshBotContext = createContext<MarshBot | null>(null)

/** Returns the thread and its actions; only valid inside the MarshBot Overview. */
export function useMarshBot(): MarshBot {
  const value = useContext(MarshBotContext)
  if (!value) throw new Error('MarshBot cards need the MarshBot Overview around them')
  return value
}

// The turn being drawn, so Card("<id>") finds its card. `past`: an earlier session, read-only.
export const TurnContext = createContext<{ turn: Turn; past: boolean } | null>(null)

// A piece's place in its turn: its index staggers a pushed turn's entrance, and the first
// bubble carries the tail towards MarshBot's face.
export const SlotContext = createContext<{ index: number; tail: boolean }>({
  index: 0,
  tail: false,
})

// Called when a piece throws, so the turn falls back to its plain says and cards.
export const FailContext = createContext<() => void>(() => {})

// The signed-in role and toast for the declined reply (CB-07). Given by
// screens/KnowledgeAssistant.tsx, read by components/DeclinedReply.tsx.
import { createContext } from 'react'

/** The signed-in role and toast, given by the chat screen (screens/KnowledgeAssistant.tsx). */
export const DeclineContext = createContext<{
  isAdmin: boolean
  notify: (message: string) => void
}>({ isAdmin: false, notify: () => undefined })

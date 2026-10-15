// Which citation the engineer has opened in the source panel beside the chat (CB-01 AC1).
// Set by CitationMarker; read by screens/KnowledgeAssistant.tsx, which shows CitationPanel.
import { createContext } from 'react'
import type { CitedSource } from './citationCheck'

/** One opened citation: its number in the answer, passage label, quote and check result. */
export type SelectedCitation = {
  number: number
  passage: string
  quote: string
  state: 'checking' | 'verified' | 'unverified'
  source?: CitedSource
}

type Selection = {
  selected: SelectedCitation | null
  // `opener` is the marker, so focus can return to it when the panel closes.
  select: (citation: SelectedCitation, opener: HTMLElement) => void
  close: () => void
}

export const CitationSelectionContext = createContext<Selection>({
  selected: null,
  select: () => {},
  close: () => {},
})

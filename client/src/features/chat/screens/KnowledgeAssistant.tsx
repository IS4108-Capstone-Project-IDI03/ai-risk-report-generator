// The knowledge assistant screen (CB-01): ask the knowledge base in a conversation and
// get cited answers, with the opened citation's source in a panel beside the chat.
// OpenUI's AgentInterface draws the conversation list, messages and composer; answers stream
// from the gateway via ../api.ts and render with ../library.tsx.
// Rendered by AssessmentApp for the 'chat' screen, loaded on first open.
import { AgentInterface } from '@openuidev/react-ui'
import '@openuidev/react-ui/components.css'
import { useCallback, useMemo, useRef, useState } from 'react'
import '../../assessments/review.css'
import { chatLLM } from '../api'
import { CitationPanel } from '../components/CitationPanel'
import { CitationSelectionContext, type SelectedCitation } from '../components/citationSelection'
import { DocumentsContext, useDocumentMap } from '../components/documents'
import { SearchStep } from '../components/SearchStep'
import { chatLibrary } from '../library'
import { starters } from '../starters'
import { chatTheme } from '../theme'
import '../chat.css'

// ponytail: conversations live in memory until the conversation list's storage
// (CB-03) passes `storage` here; a refresh starts afresh.
export function KnowledgeAssistant() {
  const documents = useDocumentMap()
  const [selected, setSelected] = useState<SelectedCitation | null>(null)
  // The marker that opened the panel, so focus returns to it on close.
  const opener = useRef<HTMLElement | null>(null)
  const close = useCallback(() => {
    setSelected(null)
    opener.current?.focus()
  }, [])
  const selection = useMemo(
    () => ({
      selected,
      close,
      select: (citation: SelectedCitation, from: HTMLElement) => {
        opener.current = from
        setSelected(citation)
      },
    }),
    [selected, close],
  )

  return (
    <DocumentsContext.Provider value={documents}>
      <CitationSelectionContext.Provider value={selection}>
        <div className="knowledge-assistant" data-source-open={selected ? '' : undefined}>
          <AgentInterface
            llm={chatLLM}
            componentLibrary={chatLibrary}
            components={{ ToolCallTimeline: SearchStep }}
            starters={starters}
            // Stacked, so all four fit; the default carousel cut off the last one.
            starterVariant="long"
            theme={{ mode: 'light', lightTheme: chatTheme }}
          >
            <AgentInterface.Composer placeholder="Ask about a standard or a past report" />
          </AgentInterface>
          {selected && <CitationPanel selected={selected} onClose={close} />}
        </div>
      </CitationSelectionContext.Provider>
    </DocumentsContext.Provider>
  )
}

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
import { ChatSidebar } from '../components/ChatSidebar'
import { CitationPanel } from '../components/CitationPanel'
import { CloseOnChatChange } from '../components/CloseOnChatChange'
import { CitationSelectionContext, type SelectedCitation } from '../components/citationSelection'
import { DocumentsContext, useDocumentMap } from '../components/documents'
import { SearchStep } from '../components/SearchStep'
import { chatLibrary } from '../library'
import marshbot from '../marshbot.svg'
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
            agentName="MarshBot"
            logoUrl={marshbot}
            starters={starters}
            // Stacked, so all four fit; the default carousel cut off the last one.
            starterVariant="long"
            // Follows the answer down as it streams. The default pinned the question to the
            // top by padding the answer with a screen of blank space, and its "latest" arrow
            // then scrolled into that blank space, hiding the answer.
            scrollVariant="always"
            theme={{ mode: 'light', lightTheme: chatTheme }}
          >
            <AgentInterface.Sidebar>
              <ChatSidebar />
            </AgentInterface.Sidebar>
            {/* A greeting only: given children, OpenUI drops its own welcome composer (whose
                placeholder can't be changed) and keeps the one below, with the starters. */}
            <AgentInterface.Welcome>
              <div className="chat-welcome">
                <img src={marshbot} alt="" width={64} height={64} />
                <h2>Hi, I'm MarshBot</h2>
                <p>
                  Ask me about the FM Global and NFPA standards or Marsh's past reports. Every
                  answer cites the page it came from.
                </p>
              </div>
            </AgentInterface.Welcome>
            <AgentInterface.Composer placeholder="Ask about a standard or a past report" />
            <CloseOnChatChange />
          </AgentInterface>
          {selected && <CitationPanel selected={selected} onClose={close} />}
        </div>
      </CitationSelectionContext.Provider>
    </DocumentsContext.Provider>
  )
}

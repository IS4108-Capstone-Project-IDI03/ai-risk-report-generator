// The knowledge assistant screen (CB-01): ask the knowledge base in a conversation and
// get cited answers, with the opened citation's source in a panel beside the chat.
// OpenUI's AgentInterface draws the conversation list, scrolling and composer; the messages are
// the Overview MarshBot's shared conversation pieces (design-system BotTurn, SpeechBubble,
// EngineerBubble, TypingDots, ReplyButton). Answers stream from the gateway via ../api.ts and
// render with ../library.tsx (OpenUI Lang 1.x) in components/AnswerTurn.tsx.
// Rendered by AssessmentApp for the 'chat' screen, loaded on first open.
import { AgentInterface } from '@openuidev/react-ui'
import '@openuidev/react-ui/components.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../../assessments/review.css'
import { chatLLM, chatStorage } from '../api'
import { AnswerBar } from '../components/AnswerBar'
import { AnswerTurn } from '../components/AnswerTurn'
import { ChatSidebar } from '../components/ChatSidebar'
import { CitationPanel } from '../components/CitationPanel'
import { preloadPdfViewer } from '../components/pdfViewerLoader'
import { DeclineContext } from '../components/declineContext'
import { CloseOnChatChange } from '../components/CloseOnChatChange'
import { CitationSelectionContext, type SelectedCitation } from '../components/citationSelection'
import { DocumentsContext, useDocumentMap } from '../components/documents'
import { SearchStep } from '../components/SearchStep'
import { Starters } from '../components/Starters'
import { PdfAttach } from '../components/PdfAttach'
import { QuestionFromLink } from '../components/QuestionFromLink'
import { PhotoAttach } from '../components/PhotoAttach'
import { UserMessage } from '../components/UserMessage'
import { VoiceInput } from '../components/VoiceInput'
import marshbot from '../marshbot.svg'
import { VersionsContext } from '../useVersions'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import { BotTurn, SpeechBubble } from '../../../design-system'
import type { Versions } from '../api'
import { chatTheme } from '../theme'
import '../chat.css'

export function KnowledgeAssistant({
  isAdmin,
  notify,
}: {
  // A knowledge admin is offered Add documents instead of a request (CB-07).
  isAdmin: boolean
  // Shows a toast, e.g. to confirm a sent request.
  notify: (message: string) => void
}) {
  const documents = useDocumentMap()
  // F-12: this screen is lazy-loaded, so reaching this line means the chat has really rendered.
  useWalkthroughScreen('chat', true)
  // The versions of the chat on screen (CB-04); loaded by AnswerBar, read by UserMessage.
  const [versions, setVersions] = useState<Versions>({})
  const versionState = useMemo(() => ({ versions, setVersions }), [versions])
  const [selected, setSelected] = useState<SelectedCitation | null>(null)
  // The marker that opened the panel, so focus returns to it on close.
  const opener = useRef<HTMLElement | null>(null)
  const close = useCallback(() => setSelected(null), [])
  // The PDF viewer's code downloads once the chat is up, ready for the first PDF tab click.
  useEffect(preloadPdfViewer, [])
  // Focus goes back once the panel is gone: while it covers the chat, the chat is hidden and
  // can't take focus.
  useEffect(() => {
    if (!selected) opener.current?.focus()
  }, [selected])
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

  const decline = useMemo(() => ({ isAdmin, notify }), [isAdmin, notify])

  return (
    <DeclineContext.Provider value={decline}>
      <VersionsContext.Provider value={versionState}>
        <DocumentsContext.Provider value={documents}>
          <CitationSelectionContext.Provider value={selection}>
            {/* mbt-convo: the conversation's text and button sizes, as on the Overview. */}
            <div
              className="knowledge-assistant mbt-convo"
              data-source-open={selected ? '' : undefined}
            >
              <AgentInterface
                llm={chatLLM}
                storage={chatStorage}
                components={{
                  AssistantMessage: AnswerTurn,
                  ToolCallTimeline: SearchStep,
                  UserMessage,
                }}
                agentName="MarshBot"
                logoUrl={marshbot}
                // Follows the answer down as it streams. The default pinned the question to the
                // top by padding the answer with a screen of blank space, and its "latest" arrow
                // then scrolled into that blank space, hiding the answer.
                scrollVariant="always"
                theme={{ mode: 'light', lightTheme: chatTheme }}
              >
                <AgentInterface.Sidebar>
                  <ChatSidebar />
                </AgentInterface.Sidebar>
                {/* MarshBot's greeting as its first turn, with the starters as reply pills, as
                the Overview opens. Given children, OpenUI drops its own welcome composer (whose
                placeholder can't be changed) and keeps the one below. */}
                <AgentInterface.Welcome>
                  <div className="chat-welcome">
                    <BotTurn mood="idle" named>
                      <div data-walk="chat.welcome">
                        <SpeechBubble tone="normal" tail>
                          <p>
                            Hi, I'm MarshBot. Ask me about the <b>FM Global</b> and <b>NFPA</b>{' '}
                            standards or Marsh's <b>past reports</b>, and every answer cites its
                            page.
                          </p>
                        </SpeechBubble>
                      </div>
                      <Starters />
                    </BotTurn>
                  </div>
                </AgentInterface.Welcome>
                <AgentInterface.Composer placeholder="Ask about a standard or a past report" />
                <CloseOnChatChange />
                <AnswerBar />
                <PhotoAttach />
                <PdfAttach />
                <VoiceInput />
                <QuestionFromLink />
              </AgentInterface>
              {selected && <CitationPanel selected={selected} onClose={close} />}
            </div>
          </CitationSelectionContext.Provider>
        </DocumentsContext.Provider>
      </VersionsContext.Provider>
    </DeclineContext.Provider>
  )
}

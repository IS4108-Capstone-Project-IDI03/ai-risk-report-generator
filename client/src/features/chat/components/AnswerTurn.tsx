// One MarshBot answer in the knowledge chat (CB-01), drawn as a MarshBot turn like the Overview's
// (the shared BotTurn: face, name, speech bubble). The answer is OpenUI Lang, rendered with
// OpenUI 1.x (openui-lang-v1, the same version as the Overview's library) as it streams.
// Passed to OpenUI's AgentInterface as its AssistantMessage (screens/KnowledgeAssistant.tsx);
// the library is ../library.tsx, and AnswerBar.tsx draws its buttons into .chat-answer-body.
import type { AssistantMessage } from '@openuidev/react-headless'
import { Renderer } from 'openui-lang-v1'
import { BotTurn } from '../../../design-system'
import { chatLibrary } from '../library'

/** Returns the answer as a MarshBot turn; the face thinks while the answer is written. */
export function AnswerTurn({
  message,
  isStreaming,
}: {
  message: AssistantMessage
  isStreaming: boolean
}) {
  // An answer stopped before its first word: no face or name, as before the redesign (OpenUI's
  // empty answer). The bare body stays so AnswerBar can still put Try again under the question.
  if (!isStreaming && !message.content?.trim())
    return (
      <div className="chat-turn">
        <div className="chat-answer-body" />
      </div>
    )
  return (
    <div className="chat-turn" data-streaming={isStreaming || undefined}>
      <BotTurn mood={isStreaming ? 'thinking' : 'idle'} named>
        <div className="chat-answer-body">
          <Renderer
            response={message.content ?? null}
            library={chatLibrary}
            isStreaming={isStreaming}
          />
        </div>
      </BotTurn>
    </div>
  )
}

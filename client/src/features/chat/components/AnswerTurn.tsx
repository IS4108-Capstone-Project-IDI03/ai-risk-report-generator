// One MarshBot answer in the knowledge chat (CB-01). The answer is OpenUI Lang, rendered with
// OpenUI 1.x (openui-lang-v1, the same version as the Overview's library) as it streams. OpenUI's
// built-in answer can only render its older Lang, so this redraws its markup (the logo beside the
// answer, no bubble) with the newer Renderer; chat.css styles those class names.
// Passed to OpenUI's AgentInterface as its AssistantMessage (screens/KnowledgeAssistant.tsx);
// the library is ../library.tsx, and AnswerBar.tsx draws its buttons into the answer's content.
import type { AssistantMessage } from '@openuidev/react-headless'
import { Renderer } from 'openui-lang-v1'
import { chatLibrary } from '../library'
import marshbot from '../marshbot.svg'

/** Returns the answer with MarshBot's logo beside it, as OpenUI drew it. */
export function AnswerTurn({
  message,
  isStreaming,
}: {
  message: AssistantMessage
  isStreaming: boolean
}) {
  // An answer stopped before its first word: no logo, so no empty turn shows. The bare content
  // box stays so AnswerBar can still put Try again under the question.
  const empty = !isStreaming && !message.content?.trim()
  return (
    <div
      className={
        empty
          ? 'openui-shell-thread-message-assistant openui-shell-thread-message-assistant--without-logo'
          : 'openui-shell-thread-message-assistant'
      }
    >
      {!empty && (
        <img
          src={marshbot}
          alt="MarshBot"
          className="openui-shell-thread-message-assistant__logo"
        />
      )}
      <div className="openui-shell-thread-message-assistant__content">
        {message.content && (
          <Renderer response={message.content} library={chatLibrary} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  )
}

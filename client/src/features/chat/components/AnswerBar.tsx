// "Try again" and the answer's version switcher, shown under the latest answer (CB-04).
// Rendered inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
import { createPortal } from 'react-dom'
import { useLoadVersions, useVersions } from '../useVersions'
import { VersionSwitcher } from './VersionSwitcher'

/**
 * Renders nothing until the latest message is a finished answer. It is drawn into OpenUI's chat
 * column, between the messages and the composer (chat.css orders them); left where AgentInterface
 * puts its children, it became a third column beside the chat.
 */
export function AnswerBar() {
  useLoadVersions()
  // Found at render: the panel is there whenever there is an answer to put the bar under.
  const host = document.querySelector('.knowledge-assistant .openui-agent-thread-chat-panel')
  const { versions, messages, running, resend, switchTo } = useVersions()
  const last = messages.at(-1)
  if (running || last?.role !== 'assistant') return null
  const question = messages.findLast((m) => m.role === 'user')
  const info = versions[last.id]
  const bar = (
    <div className="answer-bar">
      {info && <VersionSwitcher info={info} label="answer" onPick={(id) => void switchTo(id)} />}
      {question && typeof question.content === 'string' && (
        <button type="button" onClick={() => void resend(question.id, question.content as string)}>
          <span aria-hidden="true">↻</span> Try again
        </button>
      )}
    </div>
  )
  return host ? createPortal(bar, host) : bar
}

// "Try again" and the answer's version switcher, shown under the latest answer (CB-04).
// Rendered inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
import { useLoadVersions, useVersions } from '../useVersions'
import { VersionSwitcher } from './VersionSwitcher'

/** Renders nothing until the latest message is a finished answer. */
export function AnswerBar() {
  useLoadVersions()
  const { versions, messages, running, resend, switchTo } = useVersions()
  const last = messages.at(-1)
  if (running || last?.role !== 'assistant') return null
  const question = messages.findLast((m) => m.role === 'user')
  const info = versions[last.id]
  return (
    <div className="answer-bar">
      {info && <VersionSwitcher info={info} label="answer" onPick={(id) => void switchTo(id)} />}
      {question && typeof question.content === 'string' && (
        <button type="button" onClick={() => void resend(question.id, question.content as string)}>
          Try again
        </button>
      )}
    </div>
  )
}

// "Try again" and the answer's version switcher, drawn directly under the latest answer (CB-04).
// Rendered inside AgentInterface (screens/KnowledgeAssistant.tsx), where OpenUI's chat state lives.
import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../../design-system'
import { useLoadVersions, useVersions } from '../useVersions'
import { VersionSwitcher } from './VersionSwitcher'

const ROOT = '.knowledge-assistant'
// OpenUI draws a generated-UI answer in the "shell" message, not the plain-markdown one.
const ANSWER = `${ROOT} .openui-shell-thread-message-assistant`

// The last answer's text area in OpenUI's chat, or null. The bar is drawn into it, so it sits
// under the answer and scrolls with it; left where AgentInterface puts its children, it became a
// column beside the chat.
const lastAnswer = () => {
  const all = document.querySelectorAll(ANSWER)
  return (
    all[all.length - 1]?.querySelector('.openui-shell-thread-message-assistant__content') ?? null
  )
}
// Re-checks whenever the chat's DOM changes (answers stream in, versions switch), so the bar
// never points at a message OpenUI has since replaced.
function watchAnswers(onChange: () => void) {
  const root = document.querySelector(ROOT)
  if (!root) return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}

/** Renders nothing until the latest message is a finished answer. */
export function AnswerBar() {
  useLoadVersions()
  const host = useSyncExternalStore(watchAnswers, lastAnswer)
  const { versions, messages, running, resend, switchTo } = useVersions()
  const last = messages.at(-1)
  if (running || last?.role !== 'assistant') return null
  const question = messages.findLast((m) => m.role === 'user')
  const info = versions[last.id]
  const bar = (
    <div className="answer-bar">
      {info && <VersionSwitcher info={info} label="answer" onPick={(id) => void switchTo(id)} />}
      {question && typeof question.content === 'string' && (
        <IconButton
          icon="refresh-cw"
          label="Try again"
          onClick={() => void resend(question.id, question.content as string)}
        />
      )}
    </div>
  )
  return host ? createPortal(bar, host) : bar
}

// The engineer's question in the chat, with an edit button and the version switcher (CB-04).
// Replaces OpenUI's question bubble (screens/KnowledgeAssistant.tsx); keeps its class names for the look.
import type { UserMessage as Message } from '@openuidev/react-headless'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useVersions } from '../useVersions'
import { IconButton } from '../../../design-system'
import { VersionSwitcher } from './VersionSwitcher'

/** Shows a question; Edit turns it into a box whose Send asks the new wording as another version. */
export function UserMessage({ message }: { message: Message }) {
  const { versions, running, resend, switchTo } = useVersions()
  const text = typeof message.content === 'string' ? message.content : ''
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const info = versions[message.id]
  // The box grows with its text (up to a cap, then scrolls) instead of showing a fixed-size field.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  const send = () => {
    const edited = (draft ?? '').trim()
    if (!edited || running) return
    setDraft(null)
    void resend(message.id, edited)
  }
  // Enter sends and Shift+Enter adds a line, as in the composer; Escape cancels.
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') setDraft(null)
  }
  if (draft !== null)
    return (
      <div className="openui-agent-thread-message-user has-actions is-editing">
        <div className="question-edit">
          <textarea
            ref={box}
            aria-label="Edit your question"
            value={draft}
            autoFocus
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
          />
          <div className="question-edit__actions">
            <button type="button" className="pill" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="pill pill--primary"
              onClick={send}
              disabled={!draft.trim() || running}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    )
  return (
    <div className="openui-agent-thread-message-user has-actions">
      <div className="openui-agent-thread-message-user__content">{text}</div>
      <div className="message-actions">
        {info && (
          <VersionSwitcher info={info} label="question" onPick={(id) => void switchTo(id)} />
        )}
        <IconButton
          icon="pencil"
          label="Edit question"
          disabled={running}
          onClick={() => setDraft(text)}
        />
      </div>
    </div>
  )
}

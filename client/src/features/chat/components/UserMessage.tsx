// The engineer's question in the chat, with an edit button and the version switcher (CB-04).
// Replaces OpenUI's question bubble (screens/KnowledgeAssistant.tsx); keeps its class names for the look.
import type { UserMessage as Message } from '@openuidev/react-headless'
import { useState } from 'react'
import { useVersions } from '../useVersions'
import { VersionSwitcher } from './VersionSwitcher'

/** Shows a question; "Edit" turns it into a box whose Send asks the new wording as another version. */
export function UserMessage({ message }: { message: Message }) {
  const { versions, running, resend, switchTo } = useVersions()
  const text = typeof message.content === 'string' ? message.content : ''
  const [draft, setDraft] = useState<string | null>(null)
  const info = versions[message.id]
  const send = () => {
    const edited = (draft ?? '').trim()
    setDraft(null)
    if (edited) void resend(message.id, edited)
  }
  return (
    <div className="openui-agent-thread-message-user">
      <div className="openui-agent-thread-message-user__content">
        {draft === null ? (
          text
        ) : (
          <div className="question-edit">
            <textarea
              aria-label="Edit your question"
              value={draft}
              autoFocus
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="button" onClick={send} disabled={!draft.trim() || running}>
              Send
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {draft === null && (
        <div className="message-actions">
          {info && (
            <VersionSwitcher info={info} label="question" onPick={(id) => void switchTo(id)} />
          )}
          <button
            type="button"
            aria-label="Edit question"
            disabled={running}
            onClick={() => setDraft(text)}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  )
}

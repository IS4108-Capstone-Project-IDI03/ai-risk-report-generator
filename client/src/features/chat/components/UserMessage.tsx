// The engineer's question in the chat, with an edit button and the version switcher (CB-04),
// in the Overview's navy bubble (the shared EngineerBubble). While MarshBot hasn't started on
// the newest question yet, MarshBot's typing turn shows under it (ThinkingTurn.tsx).
// Replaces OpenUI's question bubble (screens/KnowledgeAssistant.tsx); keeps its outer class name,
// which OpenUI's scrolling looks for.
import type { UserMessage as Message } from '@openuidev/react-headless'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useVersions } from '../useVersions'
import { Button, EngineerBubble, IconButton } from '../../../design-system'
import { useSentPdfs, useSentPhotos } from '../photoStore'
import { MessagePdf } from './MessagePdf'
import { MessagePhotos } from './MessagePhotos'
import { ThinkingTurn } from './ThinkingTurn'
import { VersionSwitcher } from './VersionSwitcher'

/** Shows a question; Edit turns it into a box whose Send asks the new wording as another version. */
export function UserMessage({ message }: { message: Message }) {
  const { versions, messages, running, resend, switchTo } = useVersions()
  const text = typeof message.content === 'string' ? message.content : ''
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const info = versions[message.id]
  // The photos it carried: from the saved chat, or just sent from this page (CB-08).
  const saved = (message as { attachments?: { id: string }[] }).attachments?.map((a) => a.id)
  const justSent = useSentPhotos(message.id)
  const photos = saved ?? justSent ?? []
  const savedPdfs = (message as { pdfs?: { id: string; name: string; flagged: boolean }[] }).pdfs
  const sentPdfs = useSentPdfs(message.id)
  const pdfs = savedPdfs ?? sentPdfs ?? []
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
      <div className="openui-agent-thread-message-user">
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
            <Button pill variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button pill variant="primary" onClick={send} disabled={!draft.trim() || running}>
              Send
            </Button>
          </div>
        </div>
      </div>
    )
  // The newest question, with nothing from MarshBot yet (no search step, no words): it is typing.
  // OpenUI may add an empty answer at once, so an empty one doesn't count as started.
  const after = messages.slice(messages.findIndex((m) => m.id === message.id) + 1)
  const waiting =
    running &&
    !after.some((m) => m.role === 'user') &&
    !after.some((m) => m.content?.length || ('toolCalls' in m && m.toolCalls?.length))
  return (
    <>
      <div className="openui-agent-thread-message-user">
        <MessagePhotos ids={photos} />
        <MessagePdf pdfs={pdfs} />
        <EngineerBubble text={text} />
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
      {waiting && (
        <div className="chat-step" role="status">
          <ThinkingTurn />
        </div>
      )}
    </>
  )
}

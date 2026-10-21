// What the chat shows when the knowledge base cannot answer (CB-07): a plain reply and one
// button. An engineer can ask the knowledge admins to add the document; an admin is sent to
// Add documents. Rendered by the Statement in ../library.tsx for the declined sentence.
import { useContext, useState } from 'react'
import { useMessage, useThread } from '@openuidev/react-headless'
import { Icon } from '../../../design-system'
import { openKnowledgeTab } from '../../knowledge-base/openTab'
import { DeclineContext } from './declineContext'
import { RequestDialog } from './RequestDialog'

// The engineer's message just before this answer: the question the request carries.
function useAskedQuestion(): string {
  const { message } = useMessage()
  const messages = useThread((t) => t.messages)
  for (let i = messages.findIndex((m) => m.id === message.id) - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    return typeof m.content === 'string'
      ? m.content
      : (m.content ?? []).map((part) => ('text' in part ? part.text : '')).join('')
  }
  return ''
}

// Engineer's button + dialog. Its own component so the hooks above run only for engineers.
function AskAdmin() {
  const { notify } = useContext(DeclineContext)
  const question = useAskedQuestion()
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <>
      {sent ? (
        // A quiet confirmation in place of the button, so the request can't be sent twice.
        <button type="button" className="chat-button chat-button--done" disabled>
          <Icon name="check" size={15} />
          Request sent
        </button>
      ) : (
        <button
          type="button"
          className="chat-button chat-button--primary"
          disabled={!question}
          onClick={() => setOpen(true)}
        >
          <Icon name="send" size={15} />
          Ask an admin to add it
        </button>
      )}
      {open && (
        <RequestDialog
          question={question}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false)
            setSent(true)
            notify('Request sent to your knowledge admins')
          }}
        />
      )}
    </>
  )
}

/** Returns the declined reply: two short sentences and the button for the signed-in role. */
export function DeclinedReply() {
  const { isAdmin } = useContext(DeclineContext)
  return (
    <div className="chat-decline">
      <p className="chat-statement">I couldn&apos;t find that in the knowledge base.</p>
      <p className="chat-statement">
        {isAdmin
          ? 'Would you like to add the document yourself?'
          : 'Would you like me to ask your knowledge admins to add the document you need?'}
      </p>
      {isAdmin ? (
        <button
          type="button"
          className="chat-button chat-button--primary"
          onClick={() => openKnowledgeTab('add')}
        >
          <Icon name="file-plus" size={15} />
          Add documents
        </button>
      ) : (
        <AskAdmin />
      )}
    </div>
  )
}

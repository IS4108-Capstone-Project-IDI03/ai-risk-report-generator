// The next step the chat offers when the knowledge base lacks an answer (CB-07): one button.
// An engineer can ask the knowledge admins to add the document; an admin is sent to Add
// documents. Rendered by the Answer in ../library.tsx under the reply when Meta says gap.
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

/** Returns the declined reply's button for the signed-in role (the sentence is the model's). */
export function DeclinedReply() {
  const { isAdmin } = useContext(DeclineContext)
  return (
    <div className="chat-decline">
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

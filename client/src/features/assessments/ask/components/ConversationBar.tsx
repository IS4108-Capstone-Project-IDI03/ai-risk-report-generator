// The Ask tab's conversation picker (AS-03 AC2), above the conversation once there is one: this
// user's conversations on the assessment, latest first, by first question and when last asked,
// with New conversation and Delete beside it. On an archived assessment (AC5) it only switches
// between them. Drawn by AskPanel.tsx.
import { IconButton, Select, type Reason } from '../../../../design-system'
import { formatTimeOfDay } from '../../format'
import type { AskWorkflow } from '../useAsk'

// Why the conversation can't be changed while an answer is written.
const ANSWERING: Reason = {
  title: 'An answer is being written',
  text: 'Wait for it to finish, or stop it, to change conversation.',
}

/** Returns the picker row, or nothing before the first conversation. */
export function ConversationBar({ ask, onDelete }: { ask: AskWorkflow; onDelete: () => void }) {
  const { conversations, conversation } = ask
  if (!conversations.length) return null
  const options = [
    // A new conversation is listed once its first question is asked.
    ...(conversation ? [] : [{ value: '', label: 'New conversation' }]),
    ...conversations.map((c) => ({
      value: c.id,
      label: `${c.title} · ${formatTimeOfDay(new Date(c.lastAskedAt))}`,
    })),
  ]
  const blocked = ask.busy ? ANSWERING : undefined
  return (
    <div className="ask-conversations" role="group" aria-label="Conversations">
      <div className="ask-conversation-pick">
        <Select
          aria-label="Conversation"
          size="sm"
          value={conversation?.id ?? ''}
          options={options}
          disabled={ask.busy || ask.switching}
          onChange={(event) => {
            if (event.target.value) void ask.open(event.target.value)
          }}
        />
      </div>
      {!ask.archived && (
        <>
          <IconButton
            icon="plus"
            size="sm"
            variant="outline"
            label="New conversation"
            tooltip="New conversation"
            // Already a new, empty one: there is nothing more to start.
            disabled={!conversation && ask.items.length === 0}
            disabledReason={blocked}
            onClick={ask.startNew}
          />
          {conversation && (
            <IconButton
              icon="trash-2"
              size="sm"
              variant="outline"
              label="Delete conversation"
              tooltip="Delete this conversation"
              style={blocked ? undefined : { color: 'var(--red-600)' }}
              disabledReason={blocked}
              onClick={onDelete}
            />
          )}
        </>
      )}
    </div>
  )
}

// The engineer's only way to answer MarshBot (AS-06 boards 03 to 05): a quick reply button
// that becomes their own bubble, and a link button that opens a place in the workspace.
// "I need another visit" opens the calendar straight under the button; picking a day sends one
// reply naming it. Rendered by the QuickReply and LinkButton parts (library.tsx).
import { useContext, useState } from 'react'
import { Icon, Popover, useIsPhone } from '../../../design-system'
import { Calendar } from '../../../design-system/components/forms/DatePicker'
import { MessageContext, useMarshBot } from '../context'
import { today } from '../format'
import type { QuickReply } from '../types'

/** Returns the reply with this id in the message being drawn, if it offers one. */
function useReply(id: string): QuickReply | undefined {
  const message = useContext(MessageContext)
  for (const part of message?.parts ?? [])
    if (part.type === 'replies') {
      const found = part.replies.find((r) => r.id === id)
      if (found) return found
    }
}

/** Returns the quick reply button `id`; nothing for an admin or an id the message doesn't offer. */
export function QuickReplyButton({ id }: { id: string }) {
  const bot = useMarshBot()
  const message = useContext(MessageContext)
  const reply = useReply(id)
  const phone = useIsPhone()
  const [picking, setPicking] = useState(false)
  if (!reply || !message || bot.brief.viewer !== 'engineer') return null
  const button = (
    <button
      type="button"
      className="mb-qr"
      data-primary={reply.primary || undefined}
      // While a reply is on its way no other can be sent (a second press would post twice).
      disabled={!!bot.answering}
      onClick={() => (reply.picksDate ? setPicking((p) => !p) : bot.answer(message.id, reply))}
    >
      {reply.label}
      {reply.picksDate && <Icon name="chevron-down" size={14} />}
    </button>
  )
  if (!reply.picksDate) return button
  return (
    <Popover
      open={picking}
      onOpenChange={setPicking}
      trigger={button}
      ariaLabel="Day of your next visit"
      align="left"
      sheetCentred
    >
      {!phone && <div className="mb-cal-title">Day of your next visit</div>}
      <Calendar
        value=""
        min={today()}
        focusDay={false}
        onPick={(day) => {
          setPicking(false)
          bot.answer(message.id, reply, day)
        }}
      />
    </Popover>
  )
}

/** Returns the button for the message's link part `id` ("link-<index>"); nothing if unknown. */
export function LinkButton({ label, id }: { label: string; id: string }) {
  const bot = useMarshBot()
  const message = useContext(MessageContext)
  // must match microservices/rag-service/app/assistant (a link part's key is its place in parts)
  const part = message?.parts[Number(/^link-(\d+)$/.exec(id)?.[1] ?? NaN)]
  if (part?.type !== 'link') return null
  // An arrow reads as "carry on" and sits after the words; any other icon leads.
  const trailing = part.icon === 'chevron-right'
  return (
    <button type="button" className="mb-qr" data-primary onClick={() => bot.openLink(part.link)}>
      {!trailing && <Icon name={part.icon} size={14} />}
      {label}
      {trailing && <Icon name={part.icon} size={14} />}
    </button>
  )
}

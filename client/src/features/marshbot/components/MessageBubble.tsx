// MarshBot's speech bubble (AS-06 boards 01 to 07): "MarshBot · when" above the first of a run,
// a white bubble (green after a success, blue for a question), the first message larger.
// Called by screens/MarshBotOverview.tsx; holds MessageBody, or a past message's plain words.
import type { ReactNode } from 'react'
import type { BriefMessage } from '../types'

/** Returns a bubble with optional "MarshBot · when" heading and an action beside it. */
export function MessageBubble({
  said,
  tone = 'normal',
  big = false,
  aside,
  children,
}: {
  // The heading's time ("just now"); left out for the rest of a run.
  said?: string
  tone?: BriefMessage['tone']
  big?: boolean
  // Something at the heading's right, e.g. Show all.
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-msg">
      {said && (
        <div className="mb-who">
          <span>
            {'MarshBot '}
            <span className="mb-when">{said}</span>
          </span>
          {aside}
        </div>
      )}
      <div className="mb-bubble" data-tone={tone} data-big={big || undefined}>
        {children}
      </div>
    </div>
  )
}

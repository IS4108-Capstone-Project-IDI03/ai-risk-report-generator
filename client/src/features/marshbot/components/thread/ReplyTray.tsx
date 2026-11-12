// The reply tray under the thread (AS-06 canvas C1, C6, C7): "Your reply" on the left, the replies
// MarshBot offers on the right, always one row. A picker floats above it and never makes it taller.
// Shown only while MarshBot asks something. Called by screens/MarshBotOverview.tsx.
import { Icon } from '../../../../design-system'
import type { Reply } from '../../types'
import { DateReply } from './DateReply'
import { ReplyButton } from './ReplyButton'

/** Returns the tray; `sending` disables it while a reply is on its way. */
export function ReplyTray({
  replies,
  sending,
  surveyEnd,
  onReply,
}: {
  replies: Reply[]
  sending: boolean
  surveyEnd: string | null
  onReply: (reply: Reply, date?: string) => void
}) {
  return (
    <div className="mbt-tray" role="group" aria-label="Your reply">
      {/* The same column as the thread above, so its edges line up on a wide screen. */}
      <div className="mbt-tray-in">
        <span className="mbt-tray-hint" aria-hidden="true">
          <Icon name="message-square" size={15} />
          Your reply
        </span>
        <div className="mbt-tray-replies">
          {replies.map((r) =>
            r.picksDate ? (
              <DateReply
                key={r.id}
                reply={r}
                disabled={sending}
                surveyEnd={surveyEnd}
                onSend={(day) => onReply(r, day)}
              />
            ) : (
              <ReplyButton key={r.id} reply={r} disabled={sending} onClick={() => onReply(r)} />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

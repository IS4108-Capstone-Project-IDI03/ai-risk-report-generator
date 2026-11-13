// The buttons of the action slot (AS-06 round 7, boards R7-C1 to C8): the newest turn's next step
// (a card's `cta`, e.g. Open Generation), then the choices MarshBot offers. Drawn under the
// newest turn's last bubble and, while that is scrolled out of view, in the sticky bar.
// Built by screens/MarshBotOverview.tsx; placed by Thread.tsx.
import { Icon } from '../../../../design-system'
import type { ItemLink, Reply } from '../../types'
import { DateReply } from './DateReply'
import { ReplyButton } from './ReplyButton'

/** Returns the next step and the choices, in that order. */
export function Actions({
  cta,
  replies,
  surveyEnd,
  onReply,
  onOpen,
}: {
  cta: { label: string; link: ItemLink } | null
  replies: Reply[]
  surveyEnd: string | null
  onReply: (reply: Reply, date?: string) => void
  onOpen: (link: ItemLink) => void
}) {
  // What the choices lead to, said once: the stage one of them moves on to, or what comes next.
  const hint = replies.find((r) => r.hint)?.hint
  return (
    <>
      {cta && (
        <ReplyButton
          // The next step is always solid navy, so it looks the same on every screen.
          reply={{ label: cta.label, primary: true, link: cta.link }}
          onClick={() => onOpen(cta.link)}
        />
      )}
      {replies.map((choice) => {
        // One primary button per slot: beside the next step, every choice is the soft pill.
        const r = cta ? { ...choice, primary: false } : choice
        return r.picksDate ? (
          <DateReply key={r.id} reply={r} surveyEnd={surveyEnd} onSend={(day) => onReply(r, day)} />
        ) : (
          <ReplyButton key={r.id} reply={r} onClick={() => onReply(r)} />
        )
      })}
      {hint && (
        <p className="mbt-hint">
          <Icon name="corner-down-right" size={13} />
          <span>{hint}</span>
        </p>
      )}
    </>
  )
}

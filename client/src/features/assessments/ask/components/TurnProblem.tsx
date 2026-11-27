// Why an Ask turn stopped or was refused (AS-01 AC8, AS-04 AC6, AS-08), said by MarshBot: an
// amber speech bubble (a plain one for the engineer's own Stop, which is no error) with its title
// and "<what> stopped at 14:02: <cause>. <next step>", and the way on as a reply pill under it,
// as the Overview offers its replies. Drawn by AnswerTurn, ProposalTurn and GapListTurn.
import type { ReactNode } from 'react'
import { ReplyButton, SpeechBubble } from '../../../../design-system'

/** Returns the stopped or refused message, announced as an alert unless `calm`. */
export function TurnProblem({
  title,
  calm = false,
  tail,
  children,
  again,
}: {
  title: string
  // The engineer's own Stop: a plain bubble, announced as a status, not an alert.
  calm?: boolean
  // First thing in the turn: the bubble takes the tail towards the face.
  tail: boolean
  children: ReactNode
  // The way on ("Ask again", "Draft again"), when there is one now.
  again?: { label: string; icon: string; onClick: () => void }
}) {
  return (
    <div className="ask-turn-problem" role={calm ? 'status' : 'alert'}>
      <SpeechBubble tone={calm ? 'normal' : 'alert'} tail={tail}>
        <p>
          <b>{title}</b>
        </p>
        <p>{children}</p>
      </SpeechBubble>
      {again && (
        <ReplyButton reply={{ label: again.label, icon: again.icon }} onClick={again.onClick} />
      )}
    </div>
  )
}

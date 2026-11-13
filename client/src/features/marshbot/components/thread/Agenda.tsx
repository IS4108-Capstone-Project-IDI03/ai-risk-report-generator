// The agenda above the conversation (AS-06, round 8): the stage's name, then its topics in order,
// so the engineer sees the shape of the briefing: what MarshBot has raised, what it waits on now
// and what is still to come. MarshBot still raises one topic at a time; this is the map, and a
// topic already raised is a button that jumps back to it (a skipped To Do is one press away).
// On a phone only the current topic keeps its name, and the steps are not buttons: they would be
// too small to tap, and the thread is one flick long there. Called by
// screens/MarshBotOverview.tsx. Reads the turn ids SessionTurns.tsx puts on the page.
import { Icon, useIsPhone } from '../../../../design-system'
import { turnAnchor } from '../../format'
import type { AgendaStep } from '../../types'

const SAID: Record<AgendaStep['state'], string> = {
  done: 'done',
  open: 'still open',
  now: 'now',
  next: 'to come',
}

// Brings the topic's turn to the top of the thread and moves focus to it, so a keyboard user
// carries on from there. No glide for someone who asked for less motion. It also tells the thread
// to let go of the end (Thread.tsx listens): without that, a card growing later would snap the
// thread back down from the topic.
function jumpTo(turnId: string) {
  const turn = document.getElementById(turnAnchor(turnId))
  if (!turn) return
  turn.dispatchEvent(new Event('mbt-jump', { bubbles: true }))
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  turn.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  turn.focus({ preventScroll: true })
}

/** Returns the agenda bar; nothing when the stage has a single topic. */
export function Agenda({ steps, stage }: { steps: AgendaStep[]; stage: string }) {
  const phone = useIsPhone()
  if (!steps.length) return null
  return (
    <nav className="mbt-agenda" aria-label={`MarshBot’s topics in ${stage}`}>
      <div className="mbt-agenda-in">
        {/* The steps belong to this stage; a phone leaves the name out (the stage bar has it). */}
        <span className="mbt-agenda-stage">{stage}</span>
        <ol>
          {steps.map((step) => {
            const inside = (
              <>
                <span className="mbt-agenda-mark" aria-hidden="true">
                  {step.state === 'done' && <Icon name="check" size={10} />}
                </span>
                <span className="mbt-agenda-name" title={step.title}>
                  {step.title}
                </span>
                <span className="mbt-sr">{`, ${SAID[step.state]}`}</span>
              </>
            )
            const turnId = phone ? null : step.turnId
            return (
              <li
                key={step.key}
                data-state={step.state}
                aria-current={step.state === 'now' ? 'step' : undefined}
              >
                {turnId ? (
                  <button type="button" className="mbt-agenda-step" onClick={() => jumpTo(turnId)}>
                    {inside}
                  </button>
                ) : (
                  <span className="mbt-agenda-step">{inside}</span>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}

// The assessment's eight stages down the rail (AS-06 canvas P6): packed 44 px rows, done stages
// with a green tick, the current one on a light blue band with its one date: the survey day up to
// Capture ("tomorrow" the day before), the report due after it, the export day once exported;
// amber when close, red when the report is late. A stage that moves on grows its line and slides
// the band down (board 12). Called by Rail.tsx; the stage words come from assessments/format.ts.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { STAGE_LABEL } from '../../assessments/format'
import { dateTone, daysBetween, shortDay, today } from '../format'
import { STAGES, type AssistantThread, type Stage } from '../types'

// The current stage's date: its label, the day as said, and how close it is.
type Dated = { label: string | null; text: string; tone: 'late' | 'soon' | null }

function dateOf(stage: Stage, thread: AssistantThread): Dated | null {
  const at = STAGES.indexOf(stage)
  if (at <= STAGES.indexOf('capture')) {
    const day = thread.surveyEnd ?? thread.surveyStart
    if (!day) return null
    const text = daysBetween(today(), day) === 1 ? 'tomorrow' : shortDay(day)
    return { label: 'Survey', text, tone: dateTone(day, false) }
  }
  if (stage === 'exported') {
    const day = thread.stageDates.exported
    return day ? { label: null, text: shortDay(day), tone: null } : null
  }
  const due = thread.reportDue
  return due ? { label: 'Due', text: shortDay(due), tone: dateTone(due, true) } : null
}

// The day a stage was finished: when the first later stage with a date began.
const finished = (stage: Stage, thread: AssistantThread) =>
  STAGES.slice(STAGES.indexOf(stage) + 1)
    .map((s) => thread.stageDates[s])
    .find(Boolean) ?? null

// Bumps when a date changes, so it crossfades and holds the "just changed" tint (board 12).
function useChanged(value: string | null) {
  const last = useRef(value)
  const [changed, setChanged] = useState(0)
  useEffect(() => {
    if (last.current === value) return
    last.current = value
    const timer = setTimeout(() => setChanged((n) => n + 1), 0)
    return () => clearTimeout(timer)
  }, [value])
  return changed
}

/** Returns the stage track for the thread's stage. */
export function StageRail({ thread }: { thread: AssistantThread }) {
  // A stage that moves on while the screen is open steps there after a beat, so the move shows.
  const [shown, setShown] = useState<Stage>(thread.stage)
  useEffect(() => {
    if (shown === thread.stage) return
    const timer = setTimeout(() => setShown(thread.stage), 400)
    return () => clearTimeout(timer)
  }, [shown, thread.stage])
  const now = STAGES.indexOf(shown)
  const changed = useChanged(`${thread.surveyEnd}|${thread.reportDue}`)
  const dated = dateOf(shown, thread)
  return (
    <ol className="mb-stages" aria-label="Stages">
      {STAGES.map((stage, i) => {
        const state = i < now ? 'done' : i === now ? 'now' : 'next'
        return (
          <li
            key={stage}
            className="mb-stage"
            data-state={state}
            aria-current={state === 'now' ? 'step' : undefined}
          >
            <span className="mb-stage-band">
              <span className="mb-stage-dot" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
              {/* A finished stage: its name, then the day it was finished (the day the next
                  stage began), so the rail reads as the journey so far. The day is left out
                  where the name leaves it no room (marshbot.css .mb-stage-line). */}
              <span className="mb-stage-line">
                <span className="mb-stage-name">
                  {STAGE_LABEL[stage]}
                  {state === 'done' && <span className="mb-sr">, done</span>}
                </span>
                {state === 'done' && finished(stage, thread) && (
                  <span className="mb-stage-day">{shortDay(finished(stage, thread)!)}</span>
                )}
              </span>
              {state === 'now' && dated && (
                <span
                  key={changed}
                  className="mb-stage-date"
                  data-tone={dated.tone ?? undefined}
                  data-changed={changed > 0 || undefined}
                >
                  {dated.label && (
                    <Icon name={dated.tone ? 'calendar-clock' : 'calendar'} size={13} />
                  )}
                  {dated.label && <span>{dated.label}</span>}
                  <b>{dated.text}</b>
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

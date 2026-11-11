// The assessment's eight stages down the rail (AS-06 board 01): the line fills the column, done
// stages have a green tick and their date, the current one sits on a light blue band, and the
// survey and report due dates show with a calendar icon, amber when close, red when late.
// A stage that moves on grows its line and slides the band down (board 12).
// Called by screens/MarshBotOverview.tsx; the stage words come from assessments/format.ts.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { STAGE_LABEL } from '../../assessments/format'
import { dateTone, fullDay } from '../format'
import { STAGES, type AssistantBrief, type Stage } from '../types'

// The date beside a stage: its label, the day, and how close it is.
type Dated = { label: string | null; day: string; tone: 'late' | 'soon' | null; strong: boolean }

// What date a stage shows: Capture its survey, Ready to export the report due until passed,
// a passed stage the day it was entered (spec: no "in N days" here).
function dateOf(stage: Stage, brief: AssistantBrief, at: number, now: number): Dated | null {
  const passed = at < now
  if (stage === 'capture') {
    const day = brief.surveyEnd ?? brief.surveyStart
    if (!day) return null
    const ends = !!brief.surveyEnd && !!brief.surveyStart && brief.surveyEnd !== brief.surveyStart
    const tone = passed ? null : dateTone(day, false)
    return { label: ends ? 'Survey ends' : 'Survey', day, tone, strong: !passed }
  }
  if (stage === 'ready_to_export' && !passed && brief.reportDue)
    return {
      label: 'Due',
      day: brief.reportDue,
      tone: dateTone(brief.reportDue, true),
      strong: true,
    }
  const entered = brief.stageDates[stage]
  return passed && entered ? { label: null, day: entered, tone: null, strong: false } : null
}

// The day a date last changed, so it can crossfade and hold the "just changed" tint (board 12).
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

/** Returns the stage track; `from` is the stage it showed before, so the move animates. */
export function StageRail({ brief, from }: { brief: AssistantBrief; from?: Stage }) {
  // Opened after the stage moved on: start one stage back, then move on (board 12).
  const [shown, setShown] = useState<Stage>(from ?? brief.stage)
  useEffect(() => {
    if (shown === brief.stage) return
    const timer = setTimeout(() => setShown(brief.stage), 400)
    return () => clearTimeout(timer)
  }, [shown, brief.stage])
  const now = STAGES.indexOf(shown)
  const surveyChanged = useChanged(brief.surveyEnd)
  const dueChanged = useChanged(brief.reportDue)
  return (
    <ol className="mb-stages" aria-label="Stages">
      {STAGES.map((stage, i) => {
        const state = i < now ? 'done' : i === now ? 'now' : 'next'
        const dated = dateOf(stage, brief, i, now)
        const changed =
          stage === 'capture' ? surveyChanged : stage === 'ready_to_export' ? dueChanged : 0
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
              <span className="mb-stage-name">
                {STAGE_LABEL[stage]}
                {state === 'done' && <span className="mb-sr">, done</span>}
              </span>
              {dated && (
                <span
                  key={changed}
                  className="mb-stage-date"
                  data-tone={dated.tone ?? undefined}
                  data-changed={changed > 0 || undefined}
                >
                  {dated.label && (
                    <Icon name={dated.tone ? 'calendar-clock' : 'calendar'} size={15} />
                  )}
                  {dated.label && <span>{dated.label}</span>}
                  {dated.strong ? <b>{fullDay(dated.day)}</b> : <span>{fullDay(dated.day)}</span>}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// The rail folded into one tappable bar on a phone (AS-06 board 11): MarshBot's face, "Capture ·
// stage 3 of 8", a segmented bar, the survey and due dates, and a chevron that opens Details.
// Called by screens/MarshBotOverview.tsx under 768 px.
import { Icon } from '../../../design-system'
import { STAGE_LABEL } from '../../assessments/format'
import { dateTone, shortDay } from '../format'
import { STAGES, type AssistantBrief } from '../types'
import { MarshBotFace } from './MarshBotFace'

/** Returns the phone's stage bar; pressing it opens the assessment's details. */
export function PhoneStageBar({ brief, onOpen }: { brief: AssistantBrief; onOpen: () => void }) {
  const now = STAGES.indexOf(brief.stage)
  const survey = brief.surveyEnd ?? brief.surveyStart
  const ends = !!brief.surveyEnd && !!brief.surveyStart && brief.surveyEnd !== brief.surveyStart
  const surveyTone = now <= STAGES.indexOf('capture') ? dateTone(survey, false) : null
  const dueTone = now < STAGES.indexOf('exported') ? dateTone(brief.reportDue, true) : null
  return (
    <button
      type="button"
      className="mb-phonebar"
      onClick={onOpen}
      aria-label={`${STAGE_LABEL[brief.stage]}, stage ${now + 1} of ${STAGES.length}. Open assessment details`}
    >
      <span className="mb-face mb-face--sm">
        <MarshBotFace mood={brief.mood} decorative />
      </span>
      <span className="mb-phonebar-main">
        <span className="mb-phonebar-stage">
          <b>{STAGE_LABEL[brief.stage]}</b>
          {` · stage ${now + 1} of ${STAGES.length}`}
        </span>
        <span className="mb-phonebar-segs" aria-hidden="true">
          {STAGES.map((s, i) => (
            <i key={s} data-state={i < now ? 'done' : i === now ? 'now' : undefined} />
          ))}
        </span>
        <span className="mb-phonebar-dates">
          {survey && (
            <span data-tone={surveyTone ?? undefined}>
              <Icon name={surveyTone ? 'calendar-clock' : 'calendar'} size={13} />
              {`${ends ? 'Survey ends' : 'Survey'} ${shortDay(survey)}`}
            </span>
          )}
          {brief.reportDue && (
            <span data-tone={dueTone ?? undefined}>
              <Icon name={dueTone ? 'calendar-clock' : 'calendar'} size={13} />
              {`Due ${shortDay(brief.reportDue)}`}
            </span>
          )}
        </span>
      </span>
      <Icon name="chevron-right" size={18} />
    </button>
  )
}

// The rail folded into one tappable bar on a phone (AS-06 board 11): MarshBot's face, "Capture ·
// Stage 3 of 8", a segmented bar, MarshBot's status pill with the survey and due dates, and a
// chevron that opens Details. Called by screens/MarshBotOverview.tsx under 768 px.
import { Icon } from '../../../design-system'
import { STAGE_LABEL } from '../../assessments/format'
import { dateTone, shortDay } from '../format'
import { STAGES, type AssistantThread } from '../types'
import { BotStatus } from './BotStatus'
import { MarshBotFace } from './MarshBotFace'

/** Returns the phone's stage bar; pressing it opens the assessment's details. */
export function PhoneStageBar({ thread, onOpen }: { thread: AssistantThread; onOpen: () => void }) {
  const now = STAGES.indexOf(thread.stage)
  const survey = thread.surveyEnd ?? thread.surveyStart
  const ends = !!thread.surveyEnd && !!thread.surveyStart && thread.surveyEnd !== thread.surveyStart
  const surveyTone = now <= STAGES.indexOf('capture') ? dateTone(survey, false) : null
  const dueTone = now < STAGES.indexOf('exported') ? dateTone(thread.reportDue, true) : null
  return (
    <button type="button" className="mb-phonebar" onClick={onOpen}>
      <span className="mb-face mb-face--sm">
        <MarshBotFace mood={thread.mood} decorative />
      </span>
      <span className="mb-phonebar-main">
        <span className="mb-phonebar-stage">
          <b>{STAGE_LABEL[thread.stage]}</b>
          {` · Stage ${now + 1} of ${STAGES.length}`}
        </span>
        <span className="mb-phonebar-segs" aria-hidden="true">
          {STAGES.map((s, i) => (
            <i key={s} data-state={i < now ? 'done' : i === now ? 'now' : undefined} />
          ))}
        </span>
        <span className="mb-phonebar-dates">
          <BotStatus status={thread.status} />
          {survey && (
            <span data-tone={surveyTone ?? undefined}>
              <Icon name={surveyTone ? 'calendar-clock' : 'calendar'} size={13} />
              {/* Labels in Title Case (round 7): "Survey Ends 20 Nov", "Due 16 Dec". */}
              {`${ends ? 'Survey Ends' : 'Survey'} ${shortDay(survey)}`}
            </span>
          )}
          {thread.reportDue && (
            <span data-tone={dueTone ?? undefined}>
              <Icon name={dueTone ? 'calendar-clock' : 'calendar'} size={13} />
              {`Due ${shortDay(thread.reportDue)}`}
            </span>
          )}
        </span>
      </span>
      {/* Its own words are its name (stage, status, survey and due dates); this says what it does. */}
      <span className="mb-sr">Open assessment details</span>
      <Icon name="chevron-right" size={18} />
    </button>
  )
}

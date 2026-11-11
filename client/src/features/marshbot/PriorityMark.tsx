// The quiet round mark that says why an assessment is urgent (AS-06 AC 12, boards 08 and 10):
// a calendar (overdue), an alert (fix now) or an hourglass (short on time). No label; the
// reason shows on hover or focus. Used by the Focus list, the Assessments rows and the Clients
// rows. Calls the design system's Icon and Tooltip.
import { Icon, Tooltip } from '../../design-system'
import type { Priority, PriorityReason } from './types'
import './marshbot-marks.css'

const ICON: Record<PriorityReason, string> = {
  overdue: 'calendar-x',
  fix_now: 'circle-alert',
  short_on_time: 'hourglass',
}

/** Returns the mark of the most urgent of `priorities` (lowest rank), naming every reason on hover.
    `inside`: it sits inside a button, so no focus stop of its own (the button's name carries the reasons).
    `decorative`: no tooltip either, for a row that already prints its reason. */
export function PriorityMark({
  priorities,
  inside = false,
  decorative = false,
}: {
  priorities: Priority[]
  inside?: boolean
  decorative?: boolean
}) {
  const ranked = [...priorities].sort((a, b) => a.rank - b.rank)
  const top = ranked[0]
  if (!top) return null
  // Two assessments can share a reason's words; say them once.
  const reasons = [...new Set(ranked.map((p) => p.text))]
  const mark = (
    <span
      className="mb-mark"
      data-reason={top.reason}
      // Without a name a screen reader would skip it; decorative ones sit inside a row that has the text.
      {...(decorative || inside
        ? { 'aria-hidden': true }
        : { role: 'img', tabIndex: 0, 'aria-label': reasons.join('. ') })}
    >
      <Icon name={ICON[top.reason]} size={14} />
    </span>
  )
  if (decorative) return mark
  return (
    <Tooltip
      placement="top"
      label={
        reasons.length === 1 ? (
          top.text
        ) : (
          <span className="mb-mark-reasons">
            {reasons.map((text) => (
              <span key={text}>{text}</span>
            ))}
          </span>
        )
      }
    >
      {mark}
    </Tooltip>
  )
}

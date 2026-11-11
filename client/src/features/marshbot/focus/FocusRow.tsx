// One ranked assessment in the Focus list (AS-06, boards 08 and 09): a large plain numeral
// (1 navy, the rest grey), the priority mark, reference, the one-fact reason and "Client › Site".
// Used by FocusPopover (top 3, with a chevron) and FocusAllDialog (every one, with its
// Report due cell). Calls PriorityMark and the design system's ReportDue and Icon.
import { Icon, ReportDue } from '../../../design-system'
import { PriorityMark } from '../PriorityMark'
import type { Priority } from '../types'

// One assessment in Focus: a list row of the engineer's own with a priority (useAssessmentWorkflow).
export type FocusItem = {
  reference: string
  site: string
  client: string
  reportDueDate: string | null
  priority: Priority
}

/** Returns the row as a button that opens the assessment through `onOpen` (it reads data-id). */
export function FocusRow({
  item,
  rank,
  onOpen,
  showDue = false,
}: {
  item: FocusItem
  rank: number
  onOpen: (e: React.MouseEvent<HTMLElement>) => void
  // The full list's Report due cell, in place of the chevron.
  showDue?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        className="mb-focus-row"
        data-id={item.reference}
        data-top={rank === 1 ? '' : undefined}
        data-due={showDue ? '' : undefined}
        onClick={onOpen}
      >
        <span className="mb-focus-rank" aria-hidden="true">
          {rank}
        </span>
        <PriorityMark priorities={[item.priority]} decorative />
        <span className="mb-focus-text">
          <span className="mb-focus-ref">{item.reference}</span>
          <span className="mb-focus-reason">{item.priority.text}</span>
          <span className="mb-focus-where" title={item.client + ' › ' + item.site}>
            {item.client + ' › ' + item.site}
          </span>
        </span>
        {showDue ? (
          <span className="mb-focus-due">
            <ReportDue date={item.reportDueDate} />
          </span>
        ) : (
          <Icon name="chevron-right" size={16} color="var(--graphite-600)" />
        )}
      </button>
    </li>
  )
}

// One assessment on the Assessments list (CP-23, boards 03 and 04): type tile,
// reference, Type, Survey date, Status, Report due, and on hover Archive and an
// open chevron. A table row wide, a stacked card on a phone (assessment-list.css).
// Used by screens/Dashboard and ClientGroup. Calls the design system's kit.
import {
  AssessmentTypeTile,
  Icon,
  IconButton,
  ReportDue,
  StatusPill,
  Tooltip,
} from '../../../design-system'
import { STATUS_LABEL } from '../format'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { typeName } from '../workList'

export type WorkRowData = AssessmentWorkflow['filteredRows'][number]

export function WorkRow({
  r,
  grouped,
  onOpen,
  onArchive,
}: {
  r: WorkRowData
  grouped: boolean
  onOpen: (e: React.MouseEvent<HTMLElement>) => void
  // Given only when this engineer may archive the row.
  onArchive?: () => void
}) {
  const type = typeName(r.type)
  // Finished work shows its due date alone, never "late".
  const finished = r.status === STATUS_LABEL.finalised || r.status === STATUS_LABEL.archived
  return (
    // The whole row opens it for a mouse; the reference button is the keyboard's way in.
    <div className="at-row" data-id={r.id} onClick={onOpen}>
      <span className="at-assessment">
        <AssessmentTypeTile type={type} />
        <span className="at-text">
          <button
            type="button"
            className="at-ref"
            data-id={r.id}
            // The site leads, so a screen reader hears which site the row is for.
            aria-label={[r.site, r.id, type, r.date, r.status, 'report due ' + r.dueDate]
              .filter(Boolean)
              .join(', ')}
          >
            {r.id}
          </button>
          {!grouped && (
            <span className="at-sub" title={r.client + ' › ' + r.site}>
              {r.client + ' › ' + r.site}
            </span>
          )}
        </span>
      </span>
      <span className="at-meta">
        <span className="at-type">{type}</span>
        <span className="at-date">{r.date}</span>
      </span>
      <span className="at-foot">
        <span className="at-status">
          <StatusPill status={r.status} />
        </span>
        <span className="at-due">
          <ReportDue date={r.reportDueDate} plain={finished} />
        </span>
      </span>
      <span className="at-actions">
        {!!onArchive && (
          <Tooltip label="Archive" placement="top">
            <IconButton
              icon="archive"
              size="sm"
              label={'Archive ' + r.id}
              title={undefined}
              style={{ borderRadius: 999 }}
              onClick={(e) => {
                e.stopPropagation()
                onArchive()
              }}
            />
          </Tooltip>
        )}
        <Icon name="chevron-right" size={16} color="var(--graphite-600)" />
      </span>
    </div>
  )
}

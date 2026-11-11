// One assessment on the Assessments list (CP-23, boards 03 and 04): type tile,
// reference (with its priority mark, AS-06), Type, Survey date, Stage, Report due, and on
// hover Archive and an open chevron. A table row wide, a stacked card on a phone (assessment-list.css).
// Used by screens/Dashboard and ClientGroup. Calls the design system's kit.
import {
  AssessmentTypeTile,
  Icon,
  IconButton,
  ReportDue,
  StatusPill,
  Tooltip,
} from '../../../design-system'
import { PriorityMark } from '../../marshbot/PriorityMark'
import { rowStage, STATUS_LABEL } from '../format'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { typeName } from '../workList'

export type WorkRowData = AssessmentWorkflow['filteredRows'][number]

// What an admin's list adds to a row (RV-11): the Engineer cell and a Reassign icon. `changed`
// is the reference just reassigned, whose cell crossfades and whose row holds the blue tint.
export type AssignControls = { changed: string | null; onReassign: (r: WorkRowData) => void }

export function WorkRow({
  r,
  grouped,
  onOpen,
  onArchive,
  assign,
}: {
  r: WorkRowData
  grouped: boolean
  onOpen: (e: React.MouseEvent<HTMLElement>) => void
  // Given only when this engineer may archive the row.
  onArchive?: () => void
  // Given only to an admin (RV-11).
  assign?: AssignControls
}) {
  const type = typeName(r.type)
  // Finished work shows its due date alone, never "late".
  const finished = r.status === STATUS_LABEL.finalised || r.status === STATUS_LABEL.archived
  const changed = assign?.changed === r.id
  return (
    // The whole row opens it for a mouse; the reference button is the keyboard's way in.
    <div className="at-row" data-id={r.id} data-changed={changed ? '' : undefined} onClick={onOpen}>
      <span className="at-assessment">
        <AssessmentTypeTile type={type} />
        <span className="at-text">
          <span className="at-refline">
            <button
              type="button"
              className="at-ref"
              data-id={r.id}
              // The site leads, so a screen reader hears which site the row is for; then why it
              // is urgent, which the mark inside shows on hover (one tab stop, as on Clients).
              aria-label={[
                r.site,
                r.id,
                type,
                r.date,
                rowStage(r),
                'report due ' + r.dueDate,
                r.priority?.text,
              ]
                .filter(Boolean)
                .join(', ')}
            >
              {r.id}
              {!!r.priority && <PriorityMark priorities={[r.priority]} inside />}
            </button>
          </span>
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
      {/* Keyed by the name, so a new one crossfades in; only the row just reassigned animates. */}
      {!!assign && (
        <span className="at-engineer">
          <span key={r.eng} className="at-engineer-name" data-changed={changed ? '' : undefined}>
            {r.eng}
          </span>
        </span>
      )}
      <span className="at-foot">
        <span className="at-status">
          <StatusPill status={rowStage(r)} />
        </span>
        <span className="at-due">
          <ReportDue date={r.reportDueDate} plain={finished} />
        </span>
      </span>
      <span className="at-actions">
        {!!assign && (
          <ReassignAction
            reference={r.id}
            archived={r.status === STATUS_LABEL.archived}
            onClick={() => assign.onReassign(r)}
          />
        )}
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

// A row's Reassign icon. An archived assessment keeps it greyed and focusable, and a reason box
// says why (v2 "Not allowed yet: grey out and explain"); the reason names nobody.
function ReassignAction({
  reference,
  archived,
  onClick,
}: {
  reference: string
  archived: boolean
  onClick: () => void
}) {
  if (archived)
    return (
      // The wrapper keeps a press on the icon from opening the row (the icon swallows its own click).
      <span style={{ display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
        <IconButton
          icon="arrow-left-right"
          size="sm"
          label={'Reassign ' + reference}
          title={undefined}
          style={{ borderRadius: 999, color: 'var(--graphite-400)' }}
          disabledReason={{
            title: "Can't reassign yet",
            text: 'This assessment is archived. Restore it first.',
          }}
        />
      </span>
    )
  return (
    <Tooltip label="Reassign" placement="top">
      <IconButton
        icon="arrow-left-right"
        size="sm"
        label={'Reassign ' + reference}
        title={undefined}
        style={{ borderRadius: 999, color: 'var(--ink-600)' }}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      />
    </Tooltip>
  )
}

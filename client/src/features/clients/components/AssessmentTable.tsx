// A client's assessments as a table (CP-23, boards 06 and 08): type tile and
// reference (with its priority mark, AS-06), Type, Survey date, Stage, Report due and a chevron that opens the
// assessment. Called by SiteCard (one site) and screens/OpenWorkTab (all sites,
// with a Site column). Rows open the assessment through onOpen.
import { AssessmentTypeTile, ReportDue, StatusPill } from '../../../design-system'
import { PriorityMark } from '../../marshbot/PriorityMark'
import { visitStage } from '../../assessments/format'
import type { ClientVisit } from '../api'
import { assessmentType, day } from '../formatClient'
import { RowAction } from './RowAction'

export type AssessmentRow = { visit: ClientVisit; site: string }

export function AssessmentTable({
  rows,
  label,
  showSite = false,
  onOpen,
}: {
  rows: AssessmentRow[]
  // The table's accessible name, e.g. "Your assessments at Kent Ridge campus".
  label: string
  showSite?: boolean
  onOpen: (reference: string, site: string) => void
}) {
  return (
    <table className="cl-table cl-assess" aria-label={label} data-site={showSite || undefined}>
      <colgroup>
        <col />
        {showSite && <col className="cl-col-site" />}
        <col className="cl-col-type" />
        <col className="cl-col-date" />
        <col className="cl-col-status" />
        <col className="cl-col-due" />
        <col className="cl-col-actions-1" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{'Assessment'}</th>
          {showSite && <th scope="col">{'Site'}</th>}
          <th scope="col">{'Type'}</th>
          <th scope="col">{'Survey date'}</th>
          <th scope="col">{'Stage'}</th>
          <th scope="col">{'Report due'}</th>
          <th scope="col">
            <span className="cl-sr">{'Actions'}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ visit, site }) => {
          const type = assessmentType(visit.surveyType)
          const settled = visit.status === 'archived' || visit.status === 'finalised'
          return (
            <tr
              key={visit.reference}
              className="cl-row-link"
              onClick={() => onOpen(visit.reference, site)}
            >
              <td className="cl-cell-main">
                <div className="cl-flex">
                  <AssessmentTypeTile type={type} size={32} />
                  <span className="cl-line-1">{visit.reference}</span>
                  {/* Hover names the reason; the row's Open button says it to a screen reader. */}
                  {!!visit.priority && <PriorityMark priorities={[visit.priority]} inside />}
                </div>
              </td>
              {showSite && (
                <td data-label="Site">
                  <span className="cl-clamp" dir="auto" title={site}>
                    {site}
                  </span>
                </td>
              )}
              <td data-label="Type">{type}</td>
              <td data-label="Survey date" className="cl-num-text">
                {day(visit.siteVisitDate)}
              </td>
              <td data-label="Stage">
                <StatusPill status={visitStage(visit)} />
              </td>
              <td data-label="Report due">
                <ReportDue date={visit.reportDueDate} plain={settled} />
              </td>
              <td className="cl-cell-actions">
                <span className="cl-row-actions cl-row-actions--always">
                  <RowAction
                    icon="chevron-right"
                    label={[`Open ${visit.reference}`, visit.priority?.text]
                      .filter(Boolean)
                      .join(', ')}
                    tooltip="Open assessment"
                    onClick={() => onOpen(visit.reference, site)}
                  />
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

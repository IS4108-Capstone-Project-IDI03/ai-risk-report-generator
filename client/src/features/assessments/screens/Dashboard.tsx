// The Assessments page, the engineer's work list (RV-10, CP-17; rebuilt CP-23
// boards 03 and 04): top bar, then one card of toolbar, table and footer, by
// client and site or one flat list, with the Focus button beside the bell (AS-07). Rendered
// by AssessmentApp. Calls WorkToolbar, ClientGroup, WorkRow and FocusButton; the list's data
// is from useAssessmentWorkflow.tsx.
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  EmptyState,
  Icon,
  ListCard,
  TableFooter,
  TopBar,
  toast,
  useIsPhone,
} from '../../../design-system'
import { ReassignDialog } from '../../assignment/components/ReassignDialog'
import { NewAssessmentButton } from '../../new-assessment/components/NewAssessmentButton'
import { Tip } from '../../help/Tip'
import { FocusButton } from '../../marshbot/focus/FocusButton'
import { useReloadOnOutsideChange } from '../../notifications/useNotificationCounts'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import { ClientGroup } from '../components/ClientGroup'
import { WorkRow, type AssignControls, type WorkRowData } from '../components/WorkRow'
import { WorkSkeleton } from '../components/WorkSkeleton'
import { WorkToolbar } from '../components/WorkToolbar'
import { useCompact } from '../useCompact'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../assessment-list.css'

// A column heading; the sorted one carries an arrow (board 03).
const Head = ({ arrow, children }: { arrow?: 'up' | 'down'; children: string }) => (
  <span className="at-th" data-sorted={arrow ? '' : undefined} aria-hidden="true">
    {children}
    {arrow && <Icon name={'arrow-' + arrow} size={14} />}
  </span>
)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function Dashboard({ v, bell }: { v: AssessmentWorkflow; bell?: React.ReactNode }) {
  const grouped = v.workByClient
  // Grey rows until the gateway's first answer.
  const loading = v.calendar.loading
  // The list could not be read: the rows give way to the error and its Try again.
  const failed = v.listOffline
  const compact = useCompact()
  const phone = useIsPhone()
  // F-12: the list has loaded once the gateway has answered (or failed). Nothing is offered
  // while there is no row to point at: no practice assessment and nothing matching.
  useWalkthroughScreen('assessments', !v.calendar.loading, !v.practiceRow && v.noResults)
  // Someone moved an assessment to or from this person, so the list follows without a refresh.
  // Only the rows are replaced: same keys, so no skeleton, and scroll, filters and sort stay.
  useReloadOnOutsideChange(v.refreshList)
  // An admin's list (RV-11): the row being reassigned, and the one just changed (its tint
  // holds 1 s + 260 ms, as the Documents list's does).
  const [reassigning, setReassigning] = useState<WorkRowData | null>(null)
  const [changed, setChanged] = useState<string | null>(null)
  // The timer that lets the tint go; cancelled when the list closes or another row takes it.
  const settle = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(settle.current), [])
  // The row as the list holds it now: a refused move reads the list again, and the dialog follows.
  const held = reassigning && (v.filteredRows.find((r) => r.id === reassigning.id) ?? reassigning)
  const assign: AssignControls | undefined = v.canAssign
    ? { changed, onReassign: setReassigning }
    : undefined
  // The heading of the column the list is sorted by gets the arrow.
  const sorted = (i: number) => v.workSort === v.sortOptions[i]
  // A row's Archive icon, only for what this engineer may archive.
  const archiveOf = (r: Parameters<typeof v.canArchiveRow>[0]) =>
    v.canArchiveRow(r) ? () => v.askArchive(r.id) : undefined
  // F-12: the practice assessment is pinned above everything, whatever the sort and filters.
  const pinned = v.practiceRow
  // The first row with an Archive (or an admin's Reassign) button, for the walkthrough to point at.
  const walkRow = v.filteredRows.find((r) => assign || v.canArchiveRow(r))?.id
  // The first real row assigned to someone else: where an admin's "Open another engineer's
  // assessment" walkthrough goes on a replay. An engineer's list holds only their own.
  const otherRow = assign
    ? v.filteredRows.find((r) => !r.record?.practice && r.engineerId !== v.userId)?.id
    : undefined
  return (
    <div className="at-page">
      <TopBar
        eyebrow="RISK ENGINEERING"
        title="Assessments"
        // A phone's title shares its row with Focus and New assessment, so the line would wrap to
        // three: the groups say it already.
        helper={
          phone
            ? undefined
            : v.canAssign
              ? 'Every assessment across the team, grouped by client and site.'
              : 'Every assessment you are working on, grouped by client and site.'
        }
        bell={bell}
        action={
          <>
            <span className="at-focus-walk" data-walk="assessments.focus">
              <FocusButton items={v.focus} onOpen={v.onRow} />
            </span>
            {compact && v.canEdit && (
              <span className="at-topnew">
                <NewAssessmentButton onStart={v.goCreate} />
              </span>
            )}
          </>
        }
      />
      <div className="at-content">
        <ListCard bleed toolbar={<WorkToolbar v={v} compact={compact} />}>
          <div
            className="at-list"
            data-grouped={grouped || undefined}
            data-engineer={assign ? '' : undefined}
          >
            {/* The words are hidden from screen readers one by one, so the Stage tip beside its
                word stays reachable. */}
            <div className="at-head" data-walk="assessments.head">
              <Head arrow={sorted(2) ? 'up' : undefined}>{'Assessment'}</Head>
              <span className="at-meta">
                <span aria-hidden="true">{'Type'}</span>
                <Head arrow={sorted(0) ? 'down' : undefined}>{'Survey date'}</Head>
              </span>
              {!!assign && (
                <span className="at-engineer-head" aria-hidden="true">
                  {'Engineer'}
                </span>
              )}
              <span className="at-foot">
                <span className="at-stage-head">
                  <span aria-hidden="true">{'Stage'}</span>
                  <Tip id="assessments.stage" />
                </span>
                <Head arrow={sorted(1) ? 'up' : undefined}>{'Report due'}</Head>
              </span>
              <span />
            </div>
            {loading && <WorkSkeleton />}
            {failed && (
              <div className="at-empty" role="alert">
                <EmptyState
                  icon="cloud-off"
                  title="Can’t load assessments"
                  description="Check your connection, then try again."
                  action={
                    <Button variant="secondary" pill iconLeft="refresh-cw" onClick={v.retryList}>
                      {'Try again'}
                    </Button>
                  }
                />
              </div>
            )}
            {!loading &&
              pinned &&
              (grouped ? (
                <ClientGroup
                  key={'practice-' + pinned.id}
                  client={{ title: pinned.client, viewClient: undefined }}
                  site={{
                    name: pinned.site,
                    address: pinned.record?.site.address ?? null,
                    newVisit: undefined,
                    rows: [pinned],
                  }}
                  onOpen={v.onRow}
                  onArchive={archiveOf}
                  assign={assign}
                  first
                />
              ) : (
                <WorkRow
                  key={pinned.id}
                  r={pinned}
                  grouped={false}
                  onOpen={v.onRow}
                  assign={assign}
                  first
                />
              ))}
            {!loading &&
              (grouped
                ? v.workGroups.flatMap((client, i) =>
                    client.sites.map((site, j) => (
                      <ClientGroup
                        key={client.key + site.key}
                        client={client}
                        site={site}
                        onOpen={v.onRow}
                        onArchive={archiveOf}
                        assign={assign}
                        first={!pinned && i === 0 && j === 0}
                        walkRow={walkRow}
                        walkOther={otherRow}
                      />
                    )),
                  )
                : v.filteredRows.map((r, i) => (
                    <WorkRow
                      key={r.id}
                      r={r}
                      grouped={false}
                      onOpen={v.onRow}
                      onArchive={archiveOf(r)}
                      assign={assign}
                      first={!pinned && i === 0}
                      walkAction={r.id === walkRow}
                      walkOther={r.id === otherRow}
                    />
                  )))}
            {!loading && !failed && !!v.noResults && (
              <div className="at-empty">
                {v.noAssessments ? (
                  <EmptyState
                    icon="inbox"
                    title="No assessments yet"
                    action={
                      v.canEdit && (
                        <Button
                          variant="primary"
                          pill
                          iconLeft="plus"
                          onClick={() => v.goCreate('form')}
                        >
                          {'New assessment'}
                        </Button>
                      )
                    }
                  />
                ) : (
                  <EmptyState
                    icon="inbox"
                    title={
                      v.showArchived
                        ? 'No archived assessments match'
                        : 'No assessments match those filters'
                    }
                    description="Clear the search or the filters to see your assessments."
                  />
                )}
              </div>
            )}
          </div>
          {!loading && !failed && (
            <TableFooter
              late={v.lateCount ? plural(v.lateCount, 'report') + ' late' : undefined}
              onLateClick={() => v.setDateFilter('overdue')}
            >
              {plural(v.filteredRows.length, 'assessment')}
            </TableFooter>
          )}
        </ListCard>
      </div>
      {held && (
        <ReassignDialog
          reference={held.id}
          engineer={{ id: held.engineerId ?? null, name: held.eng }}
          me={v.me}
          onClose={() => setReassigning(null)}
          onStale={v.refreshList}
          onMoved={(moved) => {
            v.rowMoved(moved)
            setReassigning(null)
            setChanged(moved.reference)
            window.clearTimeout(settle.current)
            settle.current = window.setTimeout(() => setChanged(null), 1400)
            toast.success(moved.reference + ' reassigned', {
              description: 'Now with ' + (moved.engineer?.name ?? 'no one'),
            })
          }}
        />
      )}
    </div>
  )
}

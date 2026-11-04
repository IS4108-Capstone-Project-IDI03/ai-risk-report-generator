// The Assessments page, the engineer's work list (RV-10, CP-17; rebuilt CP-23
// boards 03 and 04): top bar, then one card of toolbar, table and footer, by
// client and site or one flat list. Rendered by AssessmentApp. Calls WorkToolbar,
// ClientGroup and WorkRow; the list's data is from useAssessmentWorkflow.tsx.
import { Button, Callout, EmptyState, Icon, TableFooter, TopBar } from '../../../design-system'
import { NewAssessmentButton } from '../../new-assessment/components/NewAssessmentButton'
import { ClientGroup } from '../components/ClientGroup'
import { WorkRow } from '../components/WorkRow'
import { WorkToolbar } from '../components/WorkToolbar'
import { useCompact } from '../useCompact'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../assessment-list.css'

// A column heading; the sorted one carries an arrow (board 03).
const Head = ({ arrow, children }: { arrow?: 'up' | 'down'; children: string }) => (
  <span className="at-th" data-sorted={arrow ? '' : undefined}>
    {children}
    {arrow && <Icon name={'arrow-' + arrow} size={14} />}
  </span>
)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function Dashboard({ v, bell }: { v: AssessmentWorkflow; bell?: React.ReactNode }) {
  const grouped = v.workByClient
  const compact = useCompact()
  // The heading of the column the list is sorted by gets the arrow.
  const sorted = (i: number) => v.workSort === v.sortOptions[i]
  // A row's Archive icon, only for what this engineer may archive.
  const archiveOf = (r: Parameters<typeof v.canArchiveRow>[0]) =>
    v.canArchiveRow(r) ? () => v.askArchive(r.id) : undefined
  return (
    <div className="at-page">
      <TopBar
        eyebrow="RISK ENGINEERING"
        title="Assessments"
        bell={bell}
        action={
          compact && v.canEdit ? (
            <span className="at-topnew">
              <NewAssessmentButton onStart={v.goCreate} />
            </span>
          ) : undefined
        }
      />
      <div className="at-content">
        {v.listOffline && (
          <div role="status">
            <Callout tone="warning" title="Showing sample assessments">
              {
                'The gateway could not be reached, so saved assessments are not listed. Start the gateway, then return to the dashboard.'
              }
            </Callout>
          </div>
        )}
        <div className="at-card">
          <WorkToolbar v={v} compact={compact} />
          <div className="at-list" data-grouped={grouped || undefined}>
            <div className="at-head" aria-hidden="true">
              <Head arrow={sorted(2) ? 'up' : undefined}>{'Assessment'}</Head>
              <span className="at-meta">
                <span>{'Type'}</span>
                <Head arrow={sorted(0) ? 'down' : undefined}>{'Survey date'}</Head>
              </span>
              <span className="at-foot">
                <span>{'Status'}</span>
                <Head arrow={sorted(1) ? 'up' : undefined}>{'Report due'}</Head>
              </span>
              <span />
            </div>
            {grouped
              ? v.workGroups.flatMap((client) =>
                  client.sites.map((site) => (
                    <ClientGroup
                      key={client.key + site.key}
                      client={client}
                      site={site}
                      onOpen={v.onRow}
                      onArchive={archiveOf}
                    />
                  )),
                )
              : v.filteredRows.map((r) => (
                  <WorkRow
                    key={r.id}
                    r={r}
                    grouped={false}
                    onOpen={v.onRow}
                    onArchive={archiveOf(r)}
                  />
                ))}
            {!!v.noResults && (
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
          <TableFooter
            late={v.lateCount ? plural(v.lateCount, 'report') + ' late' : undefined}
            onLateClick={() => v.setDateFilter('overdue')}
          >
            {plural(v.filteredRows.length, 'assessment')}
          </TableFooter>
        </div>
      </div>
    </div>
  )
}

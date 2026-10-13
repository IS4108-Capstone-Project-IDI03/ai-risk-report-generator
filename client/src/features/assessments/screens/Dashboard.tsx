import { Fragment, useId } from 'react'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconRegistry,
  Input,
  Select,
  StatusIcon,
} from '../../../design-system'
import { FoldHeading } from '../components/FoldHeading'
import { StatBox } from '../components/StatBox'
import type { DateFilter } from '../types'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

const COLUMNS =
  'minmax(0,1.9fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,1fr)'
// Grouped by client, the client is the heading, so its column goes.
const GROUPED_COLUMNS =
  'minmax(0,1.9fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,1fr)'
// The boxes above the list, each filtering it by date while selected.
const DATE_BOXES: { filter: DateFilter; icon: string; label: string; units: [string, string] }[] = [
  {
    filter: 'overdue',
    icon: 'circle-alert',
    label: 'Overdue',
    units: ['report past due', 'reports past due'],
  },
  {
    filter: 'due-soon',
    icon: 'calendar-clock',
    label: 'Due soon',
    units: ['report due within 7 days', 'reports due within 7 days'],
  },
  {
    filter: 'visit-soon',
    icon: 'map-pin',
    label: 'Site visits',
    units: ['visit within 7 days', 'visits within 7 days'],
  },
]
const DATE_CELL = {
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  color: 'var(--text-secondary)',
  paddingRight: '12px',
  whiteSpace: 'nowrap',
} as const

// A row's report deadline beside its due date: the Overdue badge once past
// due, otherwise the countdown, amber within three days.
function DueNote({ r }: { r: AssessmentWorkflow['filteredRows'][number] }) {
  if (r.overdue) return <Badge tone="high">Overdue</Badge>
  if (!r.countdown) return null
  return (
    <span
      style={{
        fontSize: '13px',
        fontWeight: r.countdown.soon ? '500' : '400',
        color: r.countdown.soon ? 'var(--status-moderate-fg)' : 'var(--text-muted)',
      }}
    >
      {r.countdown.text}
    </span>
  )
}

type WorkRow = AssessmentWorkflow['filteredRows'][number]
type WorkGroup = AssessmentWorkflow['workGroups'][number]

// Opens the row's assessment from the keyboard, as a click does.
function openOnKey(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.currentTarget.click()
  }
}

// One assessment as a table row, without its client when grouped by client.
function TableRow({ v, r, grouped }: { v: AssessmentWorkflow; r: WorkRow; grouped: boolean }) {
  return (
    <div
      data-id={r.id}
      onClick={v.onRow}
      style={{
        display: 'grid',
        gridTemplateColumns: grouped ? GROUPED_COLUMNS : COLUMNS,
        alignItems: 'center',
        padding: '10px 18px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
      }}
      role="button"
      tabIndex={0}
      onKeyDown={openOnKey}
      data-hoverable="true"
    >
      <span style={{ minWidth: '0', paddingRight: '16px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span
            style={{
              fontSize: '15px',
              fontWeight: '500',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {r.site}
          </span>
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'var(--text-muted)',
          }}
        >
          {r.id}
        </span>
      </span>
      {!grouped && (
        <span
          style={{
            fontSize: '15px',
            color: 'var(--text-body)',
            paddingRight: '16px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {r.client}
        </span>
      )}
      <span style={DATE_CELL}>{r.date}</span>
      <span
        style={{
          fontSize: '15px',
          color: 'var(--text-body)',
          paddingRight: '12px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {r.eng}
      </span>
      <span
        style={{
          minWidth: '0',
          paddingRight: '12px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        <StatusIcon status={r.status} showLabel={true} size={15} />
      </span>
      <span
        style={{
          minWidth: '0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '2px',
        }}
      >
        <span style={{ ...DATE_CELL, paddingRight: '0' }}>{r.dueDate}</span>
        <DueNote r={r} />
      </span>
    </div>
  )
}

// One assessment as a stacked card, below 1080px.
function StackedRow({ v, r }: { v: AssessmentWorkflow; r: WorkRow }) {
  return (
    <div
      data-id={r.id}
      onClick={v.onRow}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '14px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
      }}
      role="button"
      tabIndex={0}
      onKeyDown={openOnKey}
      data-hoverable="true"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <span
          style={{
            minWidth: '0',
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {r.site}
        </span>
        <span
          style={{
            flex: '0 0 auto',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'var(--text-secondary)',
          }}
        >
          {r.date}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          color: 'var(--text-muted)',
        }}
      >
        {r.id}
      </div>
      <div style={{ fontSize: '15px', lineHeight: '22px', color: 'var(--text-body)' }}>
        {r.stackMeta}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          marginTop: '2px',
        }}
      >
        <StatusIcon status={r.status} showLabel={true} size={15} />
        <DueNote r={r} />
      </div>
    </div>
  )
}

// A client, folding away under its heading as a building does on the
// Observations tab, then each site, like a location there, with its visits
// and New visit (CP-17 AC4, AC7).
function ClientGroup({ v, group }: { v: AssessmentWorkflow; group: WorkGroup }) {
  const id = useId()
  return (
    <section aria-label={group.title}>
      <FoldHeading
        title={group.title}
        countLabel={group.countLabel}
        open={group.open}
        controls={id}
        onToggle={group.toggle}
      />
      {group.open && (
        <div id={id}>
          {group.sites.map((site) => (
            <div key={site.key} role="group" aria-label={site.name}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <Icon name={IconRegistry.object.site} size={16} color="var(--action-primary)" />
                <h3
                  style={{
                    margin: 0,
                    fontSize: '15px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                  }}
                >
                  {site.name}
                </h3>
                {!!site.address && (
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {site.address}
                  </span>
                )}
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {site.countLabel}
                </span>
                <span style={{ flex: '1' }}></span>
                {!!site.newVisit && (
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft="plus"
                    aria-label={'New visit to ' + site.name}
                    onClick={site.newVisit}
                  >
                    {'New visit'}
                  </Button>
                )}
              </div>
              {site.rows.map((r) =>
                v.wideTable ? (
                  <TableRow key={r.id} v={v} r={r} grouped={true} />
                ) : (
                  <StackedRow key={r.id} v={v} r={r} />
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function Dashboard({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px),1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          {DATE_BOXES.map((box) => {
            const count = v.dateCounts[box.filter]
            return (
              <StatBox
                key={box.filter}
                icon={box.icon}
                label={box.label}
                content={{
                  value: String(count),
                  unit: box.units[count === 1 ? 0 : 1],
                  ...(box.filter === 'overdue' && count > 0 && { tone: 'danger' as const }),
                }}
                onOpen={() => v.toggleDateFilter(box.filter)}
                pressed={v.dateFilter === box.filter}
              />
            )
          })}
        </div>
        {v.listOffline && (
          <div role="status" style={{ marginBottom: '20px' }}>
            <Callout tone="warning" title="Showing sample assessments">
              {
                'The gateway could not be reached, so saved assessments are not listed. Start the gateway, then return to the dashboard.'
              }
            </Callout>
          </div>
        )}
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '14px 18px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {/* Says what pressing it does, so its text changes with the list,
                as on the Observations tab. The archived list hides it and the
                status, as the deleted observations hide theirs. */}
            {!v.showArchived && (
              <Button size="sm" variant="secondary" onClick={v.toggleWorkByClient}>
                {v.workByClient ? 'Show latest first' : 'Group by client'}
              </Button>
            )}
            <div style={{ flex: '0 1 220px', minWidth: '180px' }}>
              <Select
                size="sm"
                aria-label="Sort assessments"
                options={v.sortOptions}
                value={v.workSort}
                onChange={v.setWorkSort}
              />
            </div>
            {!v.showArchived && (
              <div style={{ flex: '0 1 180px', minWidth: '150px' }}>
                <Select
                  size="sm"
                  aria-label="Filter by status"
                  options={v.statusOptions}
                  value={v.fStatus}
                  onChange={v.setStatus}
                />
              </div>
            )}
            {/* Swaps the list for the archived assessments and back (CP-17). */}
            <Button
              size="sm"
              variant={v.showArchived ? 'tonal' : 'secondary'}
              iconLeft={v.showArchived ? 'arrow-left' : IconRegistry.object.archive}
              onClick={v.toggleArchived}
            >
              {v.showArchived ? 'Back to assessments' : `Archived (${v.archivedCount})`}
            </Button>
            <span style={{ flex: '1' }} />
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{v.resultLabel}</span>
            <div className="om-work-search" style={{ flex: '0 1 300px', minWidth: '200px' }}>
              <Input
                size="sm"
                iconLeft="search"
                aria-label="Search assessments"
                placeholder="Search site, client or report ID"
                value={v.q}
                onChange={v.setQ}
              />
            </div>
          </div>
          {!!v.wideTable && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: v.workByClient ? GROUPED_COLUMNS : COLUMNS,
                  alignItems: 'center',
                  gap: '0',
                  padding: '0 18px',
                  height: '34px',
                  background: 'var(--surface-header)',
                  borderBottom: '1px solid var(--border-default)',
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ paddingRight: '12px' }}>{'Assessment'}</span>
                {!v.workByClient && <span style={{ paddingRight: '12px' }}>{'Client'}</span>}
                <span style={{ paddingRight: '12px' }}>{'Site visit'}</span>
                <span style={{ paddingRight: '12px' }}>{'Engineer'}</span>
                <span style={{ paddingRight: '12px' }}>{'Status'}</span>
                <span>{'Report due'}</span>
              </div>
              {!v.workByClient &&
                v.filteredRows.map((r, index) => (
                  <Fragment key={index}>
                    <TableRow v={v} r={r} grouped={false} />
                  </Fragment>
                ))}
            </>
          )}
          {!!v.stackTable &&
            !v.workByClient &&
            v.filteredRows.map((r, index) => (
              <Fragment key={index}>
                <StackedRow v={v} r={r} />
              </Fragment>
            ))}
          {v.workByClient &&
            v.workGroups.map((group) => <ClientGroup key={group.key} v={v} group={group} />)}
          {!!v.noResults && (
            <>
              <div style={{ padding: '48px 18px' }}>
                <EmptyState
                  icon="inbox"
                  title={
                    v.showArchived && !v.archivedCount
                      ? 'No archived assessments'
                      : 'No assessments match those filters'
                  }
                  description={
                    v.showArchived
                      ? v.archivedCount
                        ? 'Clear the search to see your archived assessments.'
                        : 'Assessments you archive are listed here, and can be restored from their workspace.'
                      : v.dateFilter
                        ? 'Select the ticked box again, clear the search or widen the status filter to see your assigned assessments.'
                        : 'Clear the search or widen the status filter to see your assigned assessments.'
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

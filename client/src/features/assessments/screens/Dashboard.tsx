import { Fragment } from 'react'
import { Badge, Callout, EmptyState, Input, Select, StatusIcon } from '../../../design-system'
import { StatBox } from '../components/StatBox'
import type { DateFilter } from '../types'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

const COLUMNS =
  'minmax(0,1.9fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,1fr)'
// The boxes above the list, each filtering it by date while selected.
const DATE_BOXES: { filter: DateFilter; icon: string; label: string; units: [string, string] }[] =
  [
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
            <div style={{ flex: '1 1 220px', minWidth: '180px' }}>
              <Input
                size="sm"
                iconLeft="search"
                aria-label="Search assessments"
                placeholder="Search site, client or report ID"
                value={v.q}
                onChange={v.setQ}
              ></Input>
            </div>
            <div style={{ flex: '0 1 180px', minWidth: '150px' }}>
              <Select
                size="sm"
                aria-label="Filter by status"
                options={v.statusOptions}
                value={v.fStatus}
                onChange={v.setStatus}
              ></Select>
            </div>
            <div style={{ flex: '0 1 220px', minWidth: '180px' }}>
              <Select
                size="sm"
                aria-label="Sort assessments"
                options={v.sortOptions}
                value={v.workSort}
                onChange={v.setWorkSort}
              ></Select>
            </div>
            <span style={{ flex: '1' }}></span>
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{v.resultLabel}</span>
          </div>
          {!!v.wideTable && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLUMNS,
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
                <span style={{ paddingRight: '12px' }}>{'Client'}</span>
                <span style={{ paddingRight: '12px' }}>{'Site visit'}</span>
                <span style={{ paddingRight: '12px' }}>{'Engineer'}</span>
                <span style={{ paddingRight: '12px' }}>{'Status'}</span>
                <span>{'Report due'}</span>
              </div>
              {v.filteredRows.map((r, index) => (
                <Fragment key={index}>
                  <div
                    data-id={r.id}
                    onClick={v.onRow}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: COLUMNS,
                      alignItems: 'center',
                      padding: '10px 18px',
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.currentTarget.click()
                      }
                    }}
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
                      <StatusIcon status={r.status} showLabel={true} size={15}></StatusIcon>
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
                </Fragment>
              ))}
            </>
          )}
          {!!v.stackTable && (
            <>
              {v.filteredRows.map((r, index) => (
                <Fragment key={index}>
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
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.currentTarget.click()
                      }
                    }}
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
                    <div
                      style={{ fontSize: '15px', lineHeight: '22px', color: 'var(--text-body)' }}
                    >
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
                      <StatusIcon status={r.status} showLabel={true} size={15}></StatusIcon>
                      <DueNote r={r} />
                    </div>
                  </div>
                </Fragment>
              ))}
            </>
          )}
          {!!v.noResults && (
            <>
              <div style={{ padding: '48px 18px' }}>
                <EmptyState
                  icon="inbox"
                  title="No assessments match those filters"
                  description={
                    v.dateFilter
                      ? 'Select the ticked box again, clear the search or widen the status filter to see your assigned assessments.'
                      : 'Clear the search or widen the status filter to see your assigned assessments.'
                  }
                ></EmptyState>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

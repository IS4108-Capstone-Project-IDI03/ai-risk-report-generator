import { Fragment } from 'react'
import {
  Badge,
  Callout,
  EmptyState,
  Input,
  MetricStat,
  Select,
  StatusIcon,
} from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

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
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: '8px',
              padding: '16px 18px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <MetricStat
              label="Outstanding review items"
              value={v.openItemCount}
              size="lg"
            ></MetricStat>
          </div>
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: '8px',
              padding: '16px 18px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <MetricStat label="Under review" value={v.reviewCount} size="lg"></MetricStat>
          </div>
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: '8px',
              padding: '16px 18px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <MetricStat
              label="Observations not yet filed"
              value={v.unfiledCount}
              size="lg"
            ></MetricStat>
          </div>
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
            <span style={{ flex: '1' }}></span>
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{v.resultLabel}</span>
          </div>
          {!!v.wideTable && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'minmax(0,1.9fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,0.8fr)',
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
                <span style={{ paddingRight: '12px' }}>{'ASSESSED DATE'}</span>
                <span style={{ paddingRight: '12px' }}>{'Engineer'}</span>
                <span style={{ paddingRight: '12px' }}>{'Status'}</span>
                <span style={{ textAlign: 'right' }}>{'Items'}</span>
              </div>
              {v.filteredRows.map((r, index) => (
                <Fragment key={index}>
                  <div
                    data-id={r.id}
                    onClick={v.onRow}
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'minmax(0,1.9fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,0.8fr)',
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
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        paddingRight: '12px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.date}
                    </span>
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
                    <span style={{ minWidth: '0', paddingRight: '12px', overflow: 'hidden' }}>
                      <StatusIcon status={r.status} showLabel={true} size={15}></StatusIcon>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {!!r.hasOpen && (
                        <>
                          <Badge tone="moderate" icon="triangle-alert">
                            {r.openLabel}
                          </Badge>
                        </>
                      )}
                      {!!r.noOpen && (
                        <>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '13px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {'0'}
                          </span>
                        </>
                      )}
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
                      {!!r.hasOpen && (
                        <>
                          <Badge tone="moderate" icon="triangle-alert">
                            {r.openLabel}
                          </Badge>
                        </>
                      )}
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
                  description="Clear the search or widen the status filter to see your assigned assessments."
                ></EmptyState>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

import { Fragment } from 'react'
import { Button, Icon, MetricStat, ProgressBar } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

export function Overview({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px),1fr))',
              gap: '16px',
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
              <MetricStat label="Sections drafted" value={v.ovDrafted} size="lg"></MetricStat>
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
              <MetricStat label="Open review items" value={v.openTotal} size="lg"></MetricStat>
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
              <MetricStat label="Observations on file" value={v.fSaved} size="lg"></MetricStat>
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
              <MetricStat label="Evidence sources" value="24" size="lg"></MetricStat>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px),1fr))',
              gap: '16px',
              alignItems: 'start',
            }}
          >
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
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--surface-sunken)',
                  fontSize: '19px',
                  lineHeight: '28px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                }}
              >
                {'Assessment record'}
              </div>
              <div style={{ padding: '6px 20px 14px' }}>
                {v.ovFacts.map((ff, index) => (
                  <Fragment key={index}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '16px',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span
                        style={{
                          flex: '0 0 auto',
                          width: '150px',
                          fontSize: '14px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {ff.label}
                      </span>
                      <span
                        style={{
                          flex: '1',
                          minWidth: '0',
                          fontSize: '15px',
                          lineHeight: '22px',
                          color: 'var(--text-body)',
                          textWrap: 'pretty',
                        }}
                      >
                        {ff.value}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--surface-sunken)',
                    fontSize: '19px',
                    lineHeight: '28px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                  }}
                >
                  {'Drafting set'}
                </div>
                <div
                  style={{
                    padding: '14px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  {v.ovStandards.map((st, index) => (
                    <Fragment key={index}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <Icon name={st.icon} size={15} color="var(--text-muted)"></Icon>
                        <span style={{ minWidth: '0', flex: '1' }}>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '15px',
                              lineHeight: '22px',
                              color: 'var(--text-body)',
                            }}
                          >
                            {st.name}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '14px',
                              lineHeight: '20px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {st.detail}
                          </span>
                        </span>
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
              <div
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '8px',
                  boxShadow: 'var(--shadow-sm)',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <ProgressBar
                  value={v.reviewPercent}
                  label={v.reviewLabel}
                  tone="primary"
                ></ProgressBar>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <Button variant="primary" iconLeft="sparkles" onClick={v.goGenerate}>
                    {'Report generation'}
                  </Button>
                  <Button variant="secondary" iconLeft="user-round-search" onClick={v.goReview}>
                    {'Review'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

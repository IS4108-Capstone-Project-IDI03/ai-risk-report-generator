import { Fragment } from 'react'
import { Badge, Button, Callout, ConfidenceIndicator, ProgressBar } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

export function Generation({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div style={{ padding: '24px 28px 40px', animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)' }}>
        <div style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Callout tone="ai" title={v.genCalloutTitle}>
            {v.genCalloutBody}
          </Callout>
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
                gap: '16px',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ flex: '1', minWidth: '0' }}>
                <ProgressBar
                  value={v.genPercent}
                  label={v.genProgressLabel}
                  showValue={true}
                  tone="ai"
                ></ProgressBar>
              </div>
              {!!v.running && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button variant="secondary" iconLeft="x" onClick={v.askStop}>
                      {'Stop generation'}
                    </Button>
                  </div>
                </>
              )}
              {!!v.notRunning && (
                <>
                  <Button variant="secondary" iconLeft="refresh-cw" onClick={v.resumeGen}>
                    {'Resume generation'}
                  </Button>
                </>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '64px minmax(0,1fr) 150px 130px',
                alignItems: 'center',
                padding: '0 20px',
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
              <span>{'\u00a7'}</span>
              <span>{'Section'}</span>
              <span>{'Evidence'}</span>
              <span>{'Confidence'}</span>
            </div>
            {v.gsecs.map((g, index) => (
              <Fragment key={index}>
                <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '64px minmax(0,1fr) 150px 130px',
                      alignItems: 'center',
                      padding: '12px 20px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {g.n}
                    </span>
                    <span style={{ minWidth: '0', paddingRight: '20px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            fontSize: '16px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {g.title}
                        </span>
                        <Badge tone={g.tone} icon={g.icon}>
                          {g.label}
                        </Badge>
                      </span>
                      {!!g.isProcessing && (
                        <>
                          <span
                            style={{
                              display: 'block',
                              marginTop: '8px',
                              height: '4px',
                              borderRadius: '2px',
                              background: 'var(--graphite-100)',
                              overflow: 'hidden',
                            }}
                          >
                            <span style={g.barStyle}></span>
                          </span>
                        </>
                      )}
                    </span>
                    <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                      {g.evLabel}
                    </span>
                    <span>
                      {!!g.showConf && (
                        <>
                          <ConfidenceIndicator
                            level={g.conf}
                            showLabel={true}
                          ></ConfidenceIndicator>
                        </>
                      )}
                    </span>
                  </div>
                  {!!g.isInsufficient && (
                    <>
                      <div
                        style={{
                          margin: '0 20px 14px',
                          padding: '12px 14px',
                          background: 'var(--status-moderate-bg)',
                          borderLeft: '2px solid var(--status-moderate-fg)',
                          borderRadius: '0 5px 5px 0',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            marginBottom: '6px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '15px',
                              fontWeight: '600',
                              color: 'var(--status-moderate-fg)',
                            }}
                          >
                            {'Insufficient evidence'}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: '0 0 12px',
                            fontSize: '15px',
                            lineHeight: '22px',
                            color: 'var(--text-body)',
                            maxWidth: '68ch',
                          }}
                        >
                          {
                            'No pump test certificate is present in the document set and no site observation records a duplicate supply. Capture the evidence, or draft this section yourself.'
                          }
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft="camera"
                            onClick={v.goField}
                          >
                            {'Capture evidence'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft="pencil"
                            onClick={v.draftManually}
                          >
                            {'Draft manually'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                  {!!g.isFailed && (
                    <>
                      <div
                        style={{
                          margin: '0 20px 14px',
                          padding: '12px 14px',
                          background: 'var(--status-critical-bg)',
                          borderLeft: '2px solid var(--status-critical-fg)',
                          borderRadius: '0 5px 5px 0',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            marginBottom: '6px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '15px',
                              fontWeight: '600',
                              color: 'var(--status-critical-fg)',
                            }}
                          >
                            {'Generation failed'}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: '0 0 12px',
                            fontSize: '15px',
                            lineHeight: '22px',
                            color: 'var(--text-body)',
                            maxWidth: '68ch',
                          }}
                        >
                          {
                            'Standards library sync failed at 09:12. Retry, or continue with the cached copy from 08 Apr.'
                          }
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft="refresh-cw"
                            onClick={v.retrySection}
                          >
                            {'Retry'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft="book-marked"
                            onClick={v.useCached}
                          >
                            {'Use cached copy from 08 Apr'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </Fragment>
            ))}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 20px',
                background: 'var(--surface-sunken)',
              }}
            >
              <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                {v.genFootnote}
              </span>
              <span style={{ flex: '1' }}></span>
              <Button variant="primary" iconRight="chevron-right" onClick={v.goReview}>
                {'Review the draft'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

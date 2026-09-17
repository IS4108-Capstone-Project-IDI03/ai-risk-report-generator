import { Fragment } from 'react'
import { Button, Callout, Checkbox, EmptyState, Icon, Radio } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

export function ValidationExport({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div style={{ padding: '24px 28px 40px', animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 380px',
            gap: '20px',
            alignItems: 'start',
            maxWidth: '1080px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {!!v.blocked && (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ flex: '1', minWidth: '0' }}>
                    <Callout tone="danger" title={v.blockTitle}>
                      {v.blockBody}
                    </Callout>
                  </div>
                </div>
              </>
            )}
            {!!v.notBlocked && (
              <>
                <Callout tone="success" title="Ready to export">
                  {
                    'All included sections are reviewed and no review items remain open. Export is simulated; no file is generated and no sign-off is recorded.'
                  }
                </Callout>
              </>
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
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--surface-sunken)',
                  fontSize: '19px',
                  lineHeight: '28px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                }}
              >
                {'Completeness checklist'}
              </div>
              {v.checklist.map((c, index) => (
                <Fragment key={index}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Icon name={c.icon} size={16} color={c.color}></Icon>
                    <span
                      style={{
                        flex: '1',
                        minWidth: '0',
                        fontSize: '16px',
                        color: 'var(--text-body)',
                      }}
                    >
                      {c.label}
                    </span>
                    <span style={c.valueStyle}>{c.value}</span>
                  </div>
                </Fragment>
              ))}
            </div>
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
                  gap: '10px',
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--surface-sunken)',
                }}
              >
                <span
                  style={{
                    fontSize: '19px',
                    lineHeight: '28px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                  }}
                >
                  {'Outstanding review items'}
                </span>
                <span style={{ flex: '1' }}></span>
                <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                  {v.outstandingLabel}
                </span>
              </div>
              {v.outstanding.map((o, index) => (
                <Fragment key={index}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Icon name={o.icon} size={15} color="var(--status-moderate-fg)"></Icon>
                    <div style={{ flex: '1', minWidth: '0' }}>
                      <div style={{ fontSize: '16px', color: 'var(--text-body)' }}>{o.label}</div>
                      <div
                        style={{
                          marginTop: '2px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '13px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {o.where}
                      </div>
                    </div>
                    <span style={{ flex: '0 0 auto' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconRight="chevron-right"
                        data-sec={o.section}
                        onClick={v.jumpToSection}
                      >
                        {'Go to section'}
                      </Button>
                    </span>
                  </div>
                </Fragment>
              ))}
              {!!v.noOutstanding && (
                <>
                  <div style={{ padding: '20px' }}>
                    <EmptyState
                      icon="circle-check"
                      title="No review items outstanding"
                      description="Every uncertainty raised during drafting has been resolved and recorded."
                    ></EmptyState>
                  </div>
                </>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'sticky',
              top: '0',
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--surface-sunken)',
                }}
              >
                <span
                  style={{
                    fontSize: '19px',
                    lineHeight: '28px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                  }}
                >
                  {'Export'}
                </span>
              </div>
              <div
                style={{
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div>
                  <span
                    style={{
                      display: 'block',
                      marginBottom: '8px',
                      fontSize: '11px',
                      fontWeight: '600',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {'Format'}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Radio
                      name="export-format"
                      label="Word document (.docx)"
                      description="Editable \u2014 for client review cycles"
                      checked={v.isDocx}
                      onChange={v.pickDocx}
                    ></Radio>
                    <Radio
                      name="export-format"
                      label="PDF (.pdf)"
                      description="Fixed \u2014 for issue and filing"
                      checked={v.isPdf}
                      onChange={v.pickPdf}
                    ></Radio>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
                  <span
                    style={{
                      display: 'block',
                      marginBottom: '8px',
                      fontSize: '11px',
                      fontWeight: '600',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {'Include'}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Checkbox
                      label="Citation references"
                      description="Superscript markers and a source list per section"
                      checked={v.optCite}
                      onChange={v.setOptCite}
                    ></Checkbox>
                    <Checkbox
                      label="Photograph appendix"
                      description="28 captioned site photographs"
                      checked={v.optPhotos}
                      onChange={v.setOptPhotos}
                    ></Checkbox>
                    <Checkbox
                      label="Standards index"
                      description="FM Global 2-0, NFPA 13, NFPA 22"
                      checked={v.optIdx}
                      onChange={v.setOptIdx}
                    ></Checkbox>
                  </div>
                </div>
              </div>
              <div
                style={{
                  padding: '14px 18px',
                  borderTop: '1px solid var(--border-default)',
                  background: 'var(--surface-sunken)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <Button
                  variant="primary"
                  iconLeft="download"
                  fullWidth={true}
                  disabled={v.blocked}
                  onClick={v.askExport}
                >
                  {v.exportLabel}
                </Button>
                <span style={{ fontSize: '14px', lineHeight: '20px', color: 'var(--text-muted)' }}>
                  {v.exportHint}
                </span>
              </div>
            </div>
            <div
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                padding: '16px 18px',
              }}
            >
              <span
                style={{
                  display: 'block',
                  marginBottom: '10px',
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                {'Report'}
              </span>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '15px',
                  lineHeight: '22px',
                  color: 'var(--text-secondary)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                  }}
                >
                  {'RPT-2026-0411'}
                </span>
                <span>{'Tilbury Distribution Centre \u00b7 Northgate Logistics'}</span>
                <span>{'Assessed 11 Apr 2026 \u00b7 Lead engineer A. Rowe'}</span>
                <span>{v.wordCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

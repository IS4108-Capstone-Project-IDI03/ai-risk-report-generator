import { EvidencePanel } from '../components/EvidencePanel'
import { Fragment } from 'react'
import { AIDraftBlock, Badge, Button, Icon, ProgressBar, Textarea } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

export function Review({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div style={v.reviewWrapStyle}>
        <div className="om-scroll" style={v.reviewRailStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '16px 18px 10px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {'Sections'}
            </span>
          </div>
          <div style={{ padding: '0 18px 14px' }}>
            <ProgressBar value={v.reviewPercent} label={v.reviewLabel} tone="primary"></ProgressBar>
          </div>
          {v.railItems.map((s, index) => (
            <Fragment key={index}>
              <div
                data-id={s.id}
                onClick={v.selectSection}
                style={s.rowStyle}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.currentTarget.click()
                  }
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    width: '30px',
                    flex: '0 0 auto',
                  }}
                >
                  {s.n}
                </span>
                <span
                  style={{
                    flex: '1',
                    minWidth: '0',
                    fontSize: '15px',
                    lineHeight: '20px',
                    color: 'var(--text-body)',
                  }}
                >
                  {s.title}
                </span>
                {!!s.isRejected && (
                  <>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      {'Removed'}
                    </span>
                  </>
                )}
                {!!s.notRejected && (
                  <>
                    <Icon name={s.icon} size={15} color={s.iconColor}></Icon>
                  </>
                )}
              </div>
            </Fragment>
          ))}
          <div
            style={{
              padding: '16px 18px 24px',
              borderTop: '1px solid var(--border-subtle)',
              marginTop: '10px',
            }}
          >
            <p
              style={{
                margin: '0',
                fontSize: '14px',
                lineHeight: '20px',
                color: 'var(--text-muted)',
              }}
            >
              {
                'Sections with open review items cannot be exported. Resolve them in the evidence panel.'
              }
            </p>
          </div>
        </div>
        <div
          className="om-scroll"
          style={{ flex: '1', minWidth: '0', overflow: 'auto', background: 'var(--surface-page)' }}
        >
          <div
            style={{
              padding: '20px clamp(16px,2vw,28px) 48px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                {v.selEyebrow}
              </span>
              <span style={{ flex: '1' }}></span>
              <Button variant="ghost" size="sm" iconLeft="chevron-left" onClick={v.prevSection}>
                {'Previous'}
              </Button>
              <Button variant="ghost" size="sm" iconRight="chevron-right" onClick={v.nextSection}>
                {'Next'}
              </Button>
              <span
                style={{ width: '1px', height: '24px', background: 'var(--border-default)' }}
              ></span>
              <Button variant="danger" size="sm" iconLeft="x" onClick={v.rejectSection}>
                {'Reject section'}
              </Button>
            </div>
            {!!v.selIsRejected && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '16px 18px',
                    background: 'var(--surface-card)',
                    border: '1px dashed var(--border-strong)',
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ flex: '1', fontSize: '16px', color: 'var(--text-secondary)' }}>
                    {v.rejectedLabel}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft="refresh-cw"
                    onClick={v.undoReject}
                  >
                    {'Restore this section'}
                  </Button>
                </div>
              </>
            )}
            {!!v.selShowBlock && (
              <>
                <AIDraftBlock
                  heading={v.selHeading}
                  status={v.selStatus}
                  confidence={v.selConf}
                  evidenceCount={v.selEvCount}
                  onAccept={v.acceptSection}
                  onEdit={v.startEdit}
                  onShowEvidence={v.focusEvidence}
                >
                  {!!v.editing && (
                    <>
                      <div style={{ fontFamily: 'var(--font-sans)' }}>
                        <Textarea
                          rows={8}
                          value={v.draft}
                          onChange={v.setDraft}
                          hint="Your edit replaces the generated passage. The section is then recorded as written by you."
                        ></Textarea>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <Button variant="primary" size="sm" iconLeft="check" onClick={v.saveEdit}>
                            {'Save edit'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={v.cancelEdit}>
                            {'Cancel'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                  {!!v.showOverride && (
                    <>
                      <p style={{ margin: '0' }}>{v.selBodyText}</p>
                    </>
                  )}
                  {!!v.showProse && (
                    <>
                      <div
                        onClick={v.onProse}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.currentTarget.click()
                          }
                        }}
                      >
                        {!!v.is_s1 && (
                          <>
                            <p style={{ margin: '0' }}>
                              {
                                'The site comprises a single-storey distribution warehouse of 41,200 m\u00b2 built in 2004, with a two-storey office annexe on the south elevation.'
                              }
                              <sup
                                data-cite="1"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'1'}
                              </sup>
                              {
                                ' Operations run three shifts, six days per week, with an average stock value of \u00a318.4m held on site.'
                              }
                              <sup
                                data-cite="2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'2'}
                              </sup>
                            </p>
                          </>
                        )}
                        {!!v.is_s2 && (
                          <>
                            <p style={{ margin: '0' }}>
                              {
                                'Construction is steel portal frame with insulated composite panel cladding. Core samples recorded in the 2023 survey identify the panel core as mineral wool,'
                              }
                              <sup
                                data-cite="1"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'1'}
                              </sup>
                              {" consistent with the client's fire strategy documentation."}
                              <sup
                                data-cite="2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'2'}
                              </sup>
                              {
                                ' Commodity classification is Class III to Class IV, stored in single-row racking to 8.2 m.'
                              }
                              <sup
                                data-cite="3"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'3'}
                              </sup>
                            </p>
                          </>
                        )}
                        {!!v.is_s3g && (
                          <>
                            <p style={{ margin: '0' }}>
                              {
                                'Fire protection comprises automatic sprinkler coverage throughout the warehouse, supported by a single tank and pump arrangement.'
                              }
                              <sup
                                data-cite="1"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'1'}
                              </sup>
                              {
                                ' Detection is addressable smoke throughout the office annexe, monitored off site by a third-party receiving centre.'
                              }
                              <sup
                                data-cite="2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'2'}
                              </sup>
                              {' Each subsystem is assessed below.'}
                            </p>
                          </>
                        )}
                        {!!v.is_s3 && (
                          <>
                            <div>
                              <p style={{ margin: '0 0 14px' }}>
                                {'Bay 3 is protected by an ESFR system installed in 2019.'}
                                <sup
                                  data-cite="3"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--ai-fg)',
                                    cursor: 'pointer',
                                    padding: '0 1px',
                                  }}
                                >
                                  {'3'}
                                </sup>
                                {
                                  ' Observed head spacing is consistent with the design density of 12 mm/min recorded in the 2023 survey,'
                                }
                                <sup
                                  data-cite="3"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--ai-fg)',
                                    cursor: 'pointer',
                                    padding: '0 1px',
                                  }}
                                >
                                  {'3'}
                                </sup>
                                {
                                  ' though pallet racking added since the last visit obstructs two heads in the north aisle.'
                                }
                                <sup
                                  data-cite="2"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--ai-fg)',
                                    cursor: 'pointer',
                                    padding: '0 1px',
                                  }}
                                >
                                  {'2'}
                                </sup>
                              </p>
                              {!!v.claimVisible && (
                                <>
                                  <p style={{ margin: '0 0 14px' }}>
                                    <span style={v.claimStyle}>
                                      {'The system was last hydraulically recalculated in 2021.'}
                                    </span>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        marginLeft: '8px',
                                        verticalAlign: 'middle',
                                      }}
                                    >
                                      <Badge tone={v.claimTone} icon={v.claimIcon}>
                                        {v.claimLabel}
                                      </Badge>
                                    </span>
                                  </p>
                                </>
                              )}
                              <p style={{ margin: '0' }}>
                                {
                                  'FM Global 2-0 \u00a72.4.1 requires that storage not obstruct the discharge pattern of any sprinkler.'
                                }
                                <sup
                                  data-cite="1"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--ai-fg)',
                                    cursor: 'pointer',
                                    padding: '0 1px',
                                  }}
                                >
                                  {'1'}
                                </sup>
                              </p>
                            </div>
                          </>
                        )}
                        {!!v.is_s4 && (
                          <>
                            <p style={{ margin: '0' }}>
                              {
                                'Water supply is drawn from a single 900 m\u00b3 tank served by one electric pump.'
                              }
                              <sup
                                data-cite="2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'2'}
                              </sup>
                              {
                                ' No duplicate supply was evidenced during the visit, and the 2023 pump test certificate could not be located.'
                              }
                              <sup
                                data-cite="2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'2'}
                              </sup>
                              {
                                ' NFPA 22 \u00a74.2 requires tanks to be arranged so that any one can be removed from service without loss of protection.'
                              }
                              <sup
                                data-cite="1"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'1'}
                              </sup>
                            </p>
                          </>
                        )}
                        {!!v.is_s5 && (
                          <>
                            <div>
                              <p style={{ margin: '0 0 14px' }}>
                                {
                                  'Loss of the automated sortation line would halt outbound dispatch across the whole site.'
                                }
                                <sup
                                  data-cite="1"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--ai-fg)',
                                    cursor: 'pointer',
                                    padding: '0 1px',
                                  }}
                                >
                                  {'1'}
                                </sup>
                              </p>
                              <p style={{ margin: '0 0 14px' }}>
                                <span style={v.conflictStyle}>
                                  {'Replacement lead time for the primary conveyor controller is '}
                                  {v.leadTime}
                                </span>
                                {', with no contracted alternative site. '}
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    marginLeft: '8px',
                                    verticalAlign: 'middle',
                                  }}
                                >
                                  <Badge tone={v.conflictTone} icon={v.conflictIcon}>
                                    {v.conflictLabel}
                                  </Badge>
                                </span>
                              </p>
                              <p style={{ margin: '0' }}>
                                {
                                  'Estimated business interruption exposure is \u00a31.4m per month of outage.'
                                }
                                <sup
                                  data-cite="2"
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--ai-fg)',
                                    cursor: 'pointer',
                                    padding: '0 1px',
                                  }}
                                >
                                  {'2'}
                                </sup>
                              </p>
                            </div>
                          </>
                        )}
                        {!!v.is_s6 && (
                          <>
                            <p style={{ margin: '0' }}>
                              {
                                'Reposition racking in the north aisle of Bay 3 to restore clear discharge below all ESFR heads.'
                              }
                              <sup
                                data-cite="1"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'1'}
                              </sup>
                              {
                                ' Commission an annual pump test with certification retained on site.'
                              }
                              <sup
                                data-cite="2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'2'}
                              </sup>
                              {
                                ' Establish a contracted standby arrangement for the sortation line controller.'
                              }
                              <sup
                                data-cite="3"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  color: 'var(--ai-fg)',
                                  cursor: 'pointer',
                                  padding: '0 1px',
                                }}
                              >
                                {'3'}
                              </sup>
                            </p>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </AIDraftBlock>
              </>
            )}
          </div>
        </div>
        <EvidencePanel v={v} />
      </div>
    </>
  )
}

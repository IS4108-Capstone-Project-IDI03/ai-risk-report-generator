import { Fragment } from 'react'
import { Badge, Button, Icon, Input, Select, Textarea } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CaptureSessionNotice } from '../components/CaptureSessionNotice'

export function SiteObservation({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div
        style={{
          padding: '24px clamp(16px,2vw,28px) 40px',
          animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
        }}
      >
        {!!v.capture && (
          <div style={{ maxWidth: '1200px', marginBottom: '20px' }}>
            <CaptureSessionNotice
              capture={v.capture}
              reference={v.captureRef}
              onRetry={v.retryCapture}
            />
          </div>
        )}
        <div
          style={{
            maxWidth: '1200px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px),1fr))',
            gap: '20px',
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
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: '8px 12px',
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
                {'New observation'}
              </span>
              <span style={{ flex: '1' }}></span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                }}
              >
                {v.captureRef + ' \u00b7 '}
                {v.fSavedLabel}
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
                background: 'var(--surface-card)',
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              <button type="button" onClick={v.modeNote} style={v.tabNoteStyle}>
                {'Note'}
              </button>
              <button type="button" onClick={v.modeVoice} style={v.tabVoiceStyle}>
                {'Voice'}
              </button>
              <button type="button" onClick={v.modePhoto} style={v.tabPhotoStyle}>
                {'Photo'}
              </button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {!!v.isNoteMode && (
                <>
                  <div>
                    <Textarea
                      label="Observation"
                      rows={5}
                      placeholder="What did you see? Write as you would for the record."
                      value={v.fNote}
                      onChange={v.setFNote}
                    ></Textarea>
                  </div>
                </>
              )}
              {!!v.isVoiceMode && (
                <>
                  <div
                    style={{
                      background: 'var(--surface-sunken)',
                      border: '1px solid var(--border-default)',
                      borderRadius: '8px',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '3px',
                        height: '44px',
                      }}
                    >
                      {v.waveBars.map((b, index) => (
                        <Fragment key={index}>
                          <span style={b.style}></span>
                        </Fragment>
                      ))}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '25px',
                        lineHeight: '31px',
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {v.fClock}
                    </div>
                    <button type="button" onClick={v.toggleRec} style={v.recStyle}>
                      {v.recLabel}
                    </button>
                    <span
                      style={{
                        fontSize: '14px',
                        lineHeight: '20px',
                        color: 'var(--text-muted)',
                        textAlign: 'center',
                      }}
                    >
                      {v.recHint}
                    </span>
                  </div>
                  {!!v.hasTranscript && (
                    <>
                      <div
                        style={{
                          background: 'var(--ai-bg)',
                          border: '1px solid var(--ai-border)',
                          borderRadius: '8px',
                          padding: '14px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '8px',
                          }}
                        >
                          <Badge tone="ai" icon="sparkles">
                            {'Transcribed'}
                          </Badge>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '13px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {'00:47'}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: '0',
                            fontFamily: 'var(--font-serif)',
                            fontSize: '15px',
                            lineHeight: '24px',
                            color: 'var(--text-body)',
                          }}
                        >
                          {v.fTranscriptText}
                        </p>
                        <div style={{ marginTop: '12px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft="pencil"
                            onClick={v.transcriptToNote}
                          >
                            {'Edit as text note'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
              {!!v.isPhotoMode && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px),1fr))',
                        gap: '10px',
                      }}
                    >
                      {v.fPhotos.map((p, index) => (
                        <Fragment key={index}>
                          <div
                            style={{
                              border: '1px solid var(--border-default)',
                              borderRadius: '5px',
                              background: 'var(--graphite-100)',
                              aspectRatio: '4/3',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              animation: 'omSlide 180ms cubic-bezier(.2,0,.2,1)',
                            }}
                          >
                            <Icon name="image" size={18} color="var(--graphite-500)"></Icon>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {p.name}
                            </span>
                          </div>
                        </Fragment>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={v.takePhoto}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        width: '100%',
                        height: '48px',
                        border: '1px dashed var(--border-strong)',
                        borderRadius: '8px',
                        background: 'var(--surface-card)',
                        color: 'var(--text-link)',
                        fontFamily: 'inherit',
                        fontSize: '16px',
                        fontWeight: '500',
                        cursor: 'pointer',
                      }}
                    >
                      {'Add photograph'}
                    </button>
                    <span
                      style={{ fontSize: '14px', lineHeight: '20px', color: 'var(--text-muted)' }}
                    >
                      {v.photoHint}
                    </span>
                  </div>
                </>
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  {'Observation detail'}
                </span>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px),1fr))',
                    gap: '14px 20px',
                  }}
                >
                  <Select
                    label="Location on site"
                    options={v.areaOptions}
                    value={v.fArea}
                    onChange={v.setFArea}
                  ></Select>
                  <Select
                    label="Risk category"
                    options={v.catOptions}
                    value={v.fCat}
                    onChange={v.setFCat}
                  ></Select>
                </div>
                <div>
                  <span
                    style={{
                      display: 'block',
                      marginBottom: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {'Severity'}
                  </span>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 96px),1fr))',
                      gap: '6px',
                    }}
                  >
                    <button
                      type="button"
                      data-v="critical"
                      onClick={v.setFSev}
                      style={v.sevCriticalStyle}
                    >
                      {'Critical'}
                    </button>
                    <button type="button" data-v="high" onClick={v.setFSev} style={v.sevHighStyle}>
                      {'High'}
                    </button>
                    <button
                      type="button"
                      data-v="moderate"
                      onClick={v.setFSev}
                      style={v.sevModerateStyle}
                    >
                      {'Moderate'}
                    </button>
                    <button type="button" data-v="low" onClick={v.setFSev} style={v.sevLowStyle}>
                      {'Low'}
                    </button>
                  </div>
                </div>
                <Input
                  label="Standard reference"
                  hint="Cited verbatim in the draft"
                  value={v.fStd}
                  onChange={v.setFStd}
                ></Input>
              </div>
            </div>
            <div
              style={{
                padding: '14px 20px',
                background: 'var(--surface-sunken)',
                borderTop: '1px solid var(--border-default)',
              }}
            >
              {!!v.fToast && (
                <>
                  <div
                    style={{
                      marginBottom: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '5px',
                      background: 'var(--status-low-bg)',
                      color: 'var(--status-low-fg)',
                      fontSize: '14px',
                      animation: 'omSlide 180ms cubic-bezier(.2,0,.2,1)',
                    }}
                  >
                    <Icon name="circle-check" size={14}></Icon>
                    <span>{v.fToast}</span>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <Button variant="primary" iconLeft="check" onClick={v.saveObservation}>
                  {'Save observation'}
                </Button>
                <Button variant="ghost" onClick={v.goDash}>
                  {'Cancel'}
                </Button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: '0' }}>
            <p
              style={{
                margin: '0',
                fontSize: '16px',
                lineHeight: '26px',
                color: 'var(--text-secondary)',
                maxWidth: '60ch',
                textWrap: 'pretty',
              }}
            >
              {
                'Observations recorded here sync to the assessment as evidence. Each one keeps its location, risk category, severity and timestamp, so a generated passage can cite the observation it came from. The same screen runs on a phone on site.'
              }
            </p>
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
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--surface-sunken)',
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
                  {'Captured today'}
                </span>
                <span style={{ flex: '1' }}></span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {v.fSavedLabel}
                </span>
              </div>
              {v.fRecent.length === 0 && (
                <p
                  style={{
                    margin: '0',
                    padding: '12px 16px',
                    fontSize: '14px',
                    lineHeight: '20px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {v.fieldEmptyLabel}
                </p>
              )}
              {v.fRecent.map((o, index) => (
                <Fragment key={index}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--border-subtle)',
                      animation: 'omSlide 180ms cubic-bezier(.2,0,.2,1)',
                    }}
                  >
                    <Icon name={o.icon} size={15} color={o.color}></Icon>
                    <div style={{ minWidth: '0', flex: '1' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '15px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {o.cat}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '13px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {o.time}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: '4px 0 0',
                          fontSize: '14px',
                          lineHeight: '20px',
                          color: 'var(--text-secondary)',
                          textWrap: 'pretty',
                        }}
                      >
                        {o.text}
                      </p>
                      <span
                        style={{
                          display: 'block',
                          marginTop: '4px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {o.area}
                      </span>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
            {!!v.showWorkspaceLink && (
              <div>
                <Button variant="secondary" iconLeft="arrow-up-right" onClick={v.goAssessment}>
                  {'Open the assessment workspace'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

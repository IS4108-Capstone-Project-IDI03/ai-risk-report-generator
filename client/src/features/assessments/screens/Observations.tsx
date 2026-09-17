import { Fragment } from 'react'
import { Badge, Button, Icon } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

export function Observations({ v }: { v: AssessmentWorkflow }) {
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
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '14px',
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
            {'Observations on file'}
          </span>
          <span style={{ flex: '1' }}></span>
          <Button variant="secondary" size="sm" iconLeft="camera" onClick={v.goField}>
            {'New observation'}
          </Button>
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
          {!!v.obsWide && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '40px minmax(0,1.4fr) minmax(0,1.1fr) minmax(0,2fr) 120px 84px',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '0 16px',
                  height: '36px',
                  background: 'var(--surface-header)',
                  borderBottom: '1px solid var(--border-default)',
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                <span></span>
                <span>{'Category'}</span>
                <span>{'Location'}</span>
                <span>{'Summary'}</span>
                <span>{'Severity'}</span>
                <span style={{ textAlign: 'right' }}>{'Time'}</span>
              </div>
            </>
          )}
          {v.obsList.map((o, index) => (
            <Fragment key={index}>
              <div>
                <div
                  data-i={o.key}
                  onClick={v.toggleObs}
                  style={o.rowStyle}
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
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Icon name={o.chevron} size={15}></Icon>
                  </span>
                  <span
                    style={{ minWidth: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}
                  >
                    <span
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' }}
                    >
                      <Icon name={o.icon} size={15} color={o.color}></Icon>
                      <span
                        style={{
                          minWidth: '0',
                          fontSize: '15px',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {o.cat}
                      </span>
                    </span>
                    {!!v.obsStack && (
                      <>
                        <span
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            minWidth: '0',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {o.area}
                          </span>
                          <span
                            style={{
                              fontSize: '15px',
                              lineHeight: '22px',
                              color: 'var(--text-body)',
                              textWrap: 'pretty',
                            }}
                          >
                            {o.text}
                          </span>
                          <span style={{ display: 'flex' }}>
                            <Badge tone={o.sev} dot={true}>
                              {o.sevLabel}
                            </Badge>
                          </span>
                        </span>
                      </>
                    )}
                  </span>
                  {!!v.obsWide && (
                    <>
                      <span
                        style={{
                          minWidth: '0',
                          fontSize: '15px',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {o.area}
                      </span>
                    </>
                  )}
                  {!!v.obsWide && (
                    <>
                      <span
                        style={{
                          minWidth: '0',
                          fontSize: '15px',
                          lineHeight: '22px',
                          color: 'var(--text-body)',
                          textWrap: 'pretty',
                        }}
                      >
                        {o.text}
                      </span>
                    </>
                  )}
                  {!!v.obsWide && (
                    <>
                      <span style={{ display: 'flex' }}>
                        <Badge tone={o.sev} dot={true}>
                          {o.sevLabel}
                        </Badge>
                      </span>
                    </>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                    }}
                  >
                    {o.clock}
                  </span>
                </div>
                {!!o.open && (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px),1fr))',
                        gap: '24px',
                        padding: '18px 20px 20px clamp(20px,4vw,52px)',
                        background: 'var(--surface-sunken)',
                        borderLeft: '3px solid var(--action-primary)',
                        borderBottom: '1px solid var(--border-subtle)',
                        animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
                      }}
                    >
                      <div style={{ minWidth: '0' }}>
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: '600',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {'Detailed notes'}
                        </div>
                        <p
                          style={{
                            margin: '10px 0 0',
                            fontSize: '15px',
                            lineHeight: '24px',
                            color: 'var(--text-body)',
                            maxWidth: '68ch',
                            textWrap: 'pretty',
                          }}
                        >
                          {o.detail}
                        </p>
                        <div
                          style={{
                            marginTop: '14px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '8px',
                          }}
                        >
                          {!!o.hasAudio && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                iconLeft="mic"
                                onClick={v.playSampleAudio}
                              >
                                {o.audioLabel}
                              </Button>
                            </>
                          )}
                          {!!o.hasStd && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                iconLeft="book-marked"
                                onClick={v.openEvidenceSource}
                              >
                                {o.std}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ minWidth: '0' }}>
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: '600',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {'Attached media'}
                        </div>
                        <div
                          style={{
                            marginTop: '10px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '10px',
                          }}
                        >
                          {o.media.map((m, index) => (
                            <Fragment key={index}>
                              <div
                                style={{
                                  width: '132px',
                                  border: '1px solid var(--border-default)',
                                  borderRadius: '5px',
                                  background: 'var(--surface-card)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  padding: '16px 8px',
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
                                  {m.name}
                                </span>
                              </div>
                            </Fragment>
                          ))}
                          <button
                            type="button"
                            onClick={v.goField}
                            style={{
                              width: '132px',
                              minHeight: '76px',
                              border: '1px dashed var(--border-strong)',
                              borderRadius: '5px',
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <Icon name="camera" size={18}></Icon>
                          </button>
                        </div>
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
              flexWrap: 'wrap',
              gap: '12px',
              padding: '12px 16px',
              background: 'var(--surface-sunken)',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{v.obsCountLabel}</span>
            <span style={{ flex: '1' }}></span>
            <Button variant="ghost" size="sm" disabled={true}>
              {'Previous'}
            </Button>
            <Button variant="secondary" size="sm" onClick={v.obsNext}>
              {'Next'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

import { Fragment } from 'react'
import { EvidenceCitation, Icon } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
export function EvidencePanel({ v }: { v: AssessmentWorkflow }) {
  return (
    <div className="om-scroll" style={v.reviewEvidenceStyle}>
      {!!v.hasSelOpenItems && (
        <>
          <div
            style={{
              padding: '16px 18px',
              borderBottom: '1px solid var(--border-default)',
              background: 'var(--status-moderate-bg)',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--status-moderate-fg)',
                }}
              >
                {'Open review items'}
              </span>
            </div>
            {v.selOpenItems.map((it, index) => (
              <Fragment key={index}>
                <div
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '5px',
                    padding: '12px 14px',
                    marginBottom: '10px',
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
                    <Icon name={it.icon} size={14} color="var(--status-moderate-fg)"></Icon>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        letterSpacing: '0.02em',
                        color: 'var(--status-moderate-fg)',
                      }}
                    >
                      {it.kindLabel}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '0 0 12px',
                      fontSize: '15px',
                      lineHeight: '22px',
                      color: 'var(--text-body)',
                    }}
                  >
                    {it.question}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                      type="button"
                      data-item={it.id}
                      data-choice="a"
                      onClick={v.resolveItem}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        minHeight: '34px',
                        border: '1px solid var(--border-default)',
                        borderRadius: '5px',
                        background: 'var(--surface-card)',
                        color: 'var(--text-link)',
                        fontFamily: 'inherit',
                        fontSize: '15px',
                        cursor: 'pointer',
                      }}
                      data-hoverable="true"
                    >
                      {it.optionA}
                    </button>
                    <button
                      type="button"
                      data-item={it.id}
                      data-choice="b"
                      onClick={v.resolveItem}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        minHeight: '34px',
                        border: '1px solid var(--border-default)',
                        borderRadius: '5px',
                        background: 'var(--surface-card)',
                        color: 'var(--text-link)',
                        fontFamily: 'inherit',
                        fontSize: '15px',
                        cursor: 'pointer',
                      }}
                      data-hoverable="true"
                    >
                      {it.optionB}
                    </button>
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </>
      )}
      <div
        style={{ padding: '16px 18px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}
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
          {'Evidence'}
        </span>
        <span style={{ flex: '1' }}></span>
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)' }}
        >
          {v.selEvLabel}
        </span>
      </div>
      <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {v.selEvidence.map((e, index) => (
          <Fragment key={index}>
            <div
              data-i={e.index}
              onClick={v.pickEvidence}
              style={e.wrapStyle}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.currentTarget.click()
                }
              }}
            >
              <EvidenceCitation
                kind={e.kind}
                source={e.source}
                locator={e.locator}
                excerpt={e.excerpt}
                index={e.index}
                onOpen={v.openEvidenceSource}
              ></EvidenceCitation>
            </div>
          </Fragment>
        ))}
      </div>
      <div
        style={{
          padding: '14px 18px 10px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
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
          {'Original observations'}
        </span>
      </div>
      <div style={{ padding: '0 18px 28px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {v.selObservations.map((o, index) => (
          <Fragment key={index}>
            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: '5px',
                overflow: 'hidden',
              }}
            >
              {!!o.isPhoto && (
                <>
                  <div
                    style={{
                      aspectRatio: '4/3',
                      background: 'var(--graphite-100)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      borderBottom: '1px solid var(--border-default)',
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
                      {o.file}
                    </span>
                  </div>
                </>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}
                >
                  <Icon name={o.icon} size={13} color="var(--green-600)"></Icon>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      letterSpacing: '0.02em',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {o.kindLabel}
                  </span>
                  <span style={{ flex: '1' }}></span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {o.time}
                  </span>
                </div>
                <p
                  style={{
                    margin: '0',
                    fontSize: '14px',
                    lineHeight: '20px',
                    color: 'var(--text-secondary)',
                    borderLeft: '2px solid var(--border-default)',
                    paddingLeft: '10px',
                  }}
                >
                  {o.text}
                </p>
                <span
                  style={{
                    display: 'block',
                    marginTop: '6px',
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
    </div>
  )
}

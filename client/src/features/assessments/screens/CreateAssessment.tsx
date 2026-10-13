import { useRef } from 'react'
import { Button, Callout, Input, Select } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

type EngineerChoice = NonNullable<AssessmentWorkflow['engAssigned']>

// An engineer's initials, name and staff details, as assigned or as a match.
function EngineerLabel({ e }: { e: EngineerChoice }) {
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '30px',
          height: '30px',
          flex: '0 0 auto',
          borderRadius: '99px',
          background: 'var(--ink-50)',
          color: 'var(--ink-700)',
          fontSize: '13px',
          fontWeight: '600',
        }}
      >
        {e.initials}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: '0' }}>
        <span
          style={{
            fontSize: '15px',
            lineHeight: '22px',
            fontWeight: '500',
            color: 'var(--text-primary)',
          }}
        >
          {e.name + (e.you ? ' (you)' : '')}
        </span>
        {!!e.role && (
          <span style={{ fontSize: '13px', lineHeight: '18px', color: 'var(--text-muted)' }}>
            {e.role}
          </span>
        )}
      </span>
    </>
  )
}

export function CreateAssessment({ v }: { v: AssessmentWorkflow }) {
  const searchArea = useRef<HTMLDivElement>(null)
  return (
    <>
      <div style={{ padding: '24px 28px 40px', animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)' }}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-sm)',
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
                {'Site and client'}
              </span>
            </div>
            <div
              style={{
                padding: '20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px),1fr))',
                gap: '16px 20px',
              }}
            >
              <Input
                label="Site name"
                placeholder="e.g. Avonmouth Paper Mill"
                value={v.cfSite}
                error={v.errSite}
                onChange={v.setCfSite}
              ></Input>
              <Input
                label="Client"
                placeholder="e.g. Severn Paper Group"
                value={v.cfClient}
                error={v.errClient}
                onChange={v.setCfClient}
              ></Input>
              <Input
                label="Site address"
                placeholder="Street, town, postcode"
                value={v.cfAddr}
                onChange={v.setCfAddr}
              ></Input>
              <Select
                label="Jurisdiction"
                hint="Filters the standards and regulations drafting draws on"
                options={v.jurisdictionOptions}
                value={v.cfJurisdiction}
                onChange={v.setCfJurisdiction}
              ></Select>
            </div>
          </div>
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-sm)',
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
              {'Facility type and scope'}
            </div>
            <div
              style={{
                padding: '20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px),1fr))',
                gap: '16px 20px',
              }}
            >
              <Select
                label="Facility type"
                options={v.facilityOptions}
                value={v.cfType}
                onChange={v.setCfType}
              ></Select>
              <Select
                label="Assessment type"
                options={v.surveyOptions}
                value={v.cfSurvey}
                onChange={v.setCfSurvey}
              ></Select>
              <Input
                label="Site visit date"
                type="date"
                value={v.cfDate}
                onChange={v.setCfDate}
              ></Input>
              <Input label="Report due" type="date" value={v.cfDue} onChange={v.setCfDue}></Input>
            </div>
          </div>
          {/* An assessment keeps the engineer it was created for. */}
          {!v.isEditing && (
            <div
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-sm)',
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
                  {'Assigned engineer'}
                </span>
              </div>
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {v.directoryLoading && <p role="status">Loading engineers…</p>}
                {!v.directoryLoading && !v.directoryError && !v.hasDirectory && (
                  <p>No active risk engineers are available.</p>
                )}
                {v.directoryError && (
                  <Callout tone="warning" title="Engineer list unavailable">
                    Reopen this page to load the engineer list before creating the assessment.
                  </Callout>
                )}
                {v.hasDirectory && (
                  <div
                    ref={searchArea}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      maxWidth: '480px',
                    }}
                  >
                    {v.engAssigned ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 10px',
                          background: 'var(--surface-selected)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '5px',
                        }}
                      >
                        <EngineerLabel e={v.engAssigned} />
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-secondary)' }}>
                        {'No engineer assigned yet. Search for one below.'}
                      </p>
                    )}
                    <Input
                      type="search"
                      label="Search engineers"
                      iconLeft="search"
                      placeholder="Name, staff ID or job title"
                      value={v.engQuery}
                      onChange={v.setEngQuery}
                    ></Input>
                    {v.engResults.length > 0 && (
                      <ul
                        aria-label="Matching engineers"
                        style={{
                          listStyle: 'none',
                          margin: 0,
                          padding: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        {v.engResults.map((e) => (
                          <li key={e.id}>
                            <button
                              type="button"
                              aria-pressed={e.on}
                              onClick={() => {
                                v.selectEng(e.id)
                                // The matches close, so keep focus in the search.
                                searchArea.current?.querySelector('input')?.focus()
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                width: '100%',
                                padding: '8px 10px',
                                textAlign: 'left',
                                fontFamily: 'inherit',
                                background: e.on
                                  ? 'var(--surface-selected)'
                                  : 'var(--surface-card)',
                                border:
                                  '1px solid ' +
                                  (e.on ? 'var(--action-primary)' : 'var(--border-subtle)'),
                                borderRadius: '5px',
                                cursor: 'pointer',
                              }}
                              data-hoverable="true"
                            >
                              <EngineerLabel e={e} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p
                      aria-live="polite"
                      style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}
                    >
                      {v.engResultLabel}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          {!!v.hasCfError && (
            <>
              <Callout tone="danger" title={v.cfErrorTitle}>
                {
                  'Site name and client are required before an assessment can be opened. Correct the two fields above, then create the assessment.'
                }
              </Callout>
            </>
          )}
          {!!v.cfServerError && (
            <Callout tone="danger" title={v.cfErrorTitle}>
              {v.cfServerError}
            </Callout>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0 0' }}>
            <Button
              variant="primary"
              iconLeft="plus"
              disabled={v.cfBusy}
              onClick={v.createAssessment}
            >
              {v.createLabel}
            </Button>
            <Button variant="ghost" onClick={v.cancelForm}>
              {'Cancel'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

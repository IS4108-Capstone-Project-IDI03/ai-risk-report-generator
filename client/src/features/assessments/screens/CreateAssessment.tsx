import { useId, useRef } from 'react'
import { Button, Callout, Checkbox, Input, Select } from '../../../design-system'
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

// Asks about a new client or site name that looks like a listed one (CP-17
// AC11), under its field: use the listed one, or keep it as typed and
// carry on creating.
function NameCheckCallout({ v }: { v: AssessmentWorkflow }) {
  const check = v.cfCheck!
  const quoted = '\u201c' + check.typed + '\u201d'
  return (
    <div role="alert">
      <Callout
        tone="warning"
        title={'Did you mean ' + check.suggestion + '?'}
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button size="sm" variant="primary" onClick={v.acceptCfSuggestion}>
              {'Use ' + check.suggestion}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => v.createAssessment(v.keepCfName())}
            >
              {'Keep ' + quoted}
            </Button>
          </div>
        }
      >
        {check.field === 'client'
          ? quoted + ' isn\u2019t listed, but ' + check.suggestion + ' is.'
          : 'This client already has ' + check.suggestion + '.'}
      </Callout>
    </div>
  )
}

export function CreateAssessment({ v }: { v: AssessmentWorkflow }) {
  const searchArea = useRef<HTMLDivElement>(null)
  const id = useId()
  // A listed client's site picker waits for a choice before the site's fields.
  const showSiteFields = !v.pickingSite || v.cfSiteId !== ''
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
                label="Client"
                placeholder="e.g. Severn Paper Group"
                list={id + '-clients'}
                value={v.cfClient}
                error={v.errClient}
                hint={v.clientHint}
                disabled={v.clientLocked}
                onChange={v.setCfClient}
              ></Input>
              <datalist id={id + '-clients'}>
                {v.clientNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {v.cfCheck?.field === 'client' && <NameCheckCallout v={v} />}
              {v.sitesLoading && (
                <p role="status" style={{ margin: 0, alignSelf: 'end' }}>
                  {'Loading the client\u2019s sites\u2026'}
                </p>
              )}
              {v.pickingSite && (
                <Select
                  label="Site"
                  hint="One of the client's sites, or a new one"
                  options={v.siteOptions}
                  value={v.cfSiteId}
                  error={v.errSiteChoice}
                  onChange={v.setCfSiteId}
                ></Select>
              )}
              {showSiteFields && (
                <>
                  <Input
                    label="Site name"
                    placeholder="e.g. Avonmouth Paper Mill"
                    value={v.cfSite}
                    error={v.errSite}
                    hint={v.siteLocked ? v.siteLockedHint : undefined}
                    disabled={v.siteLocked}
                    onChange={v.setCfSite}
                  ></Input>
                  {v.cfCheck?.field === 'site' && <NameCheckCallout v={v} />}
                  <Input
                    label="Site address"
                    placeholder="Street, town, postcode"
                    value={v.cfAddr}
                    disabled={v.siteLocked}
                    onChange={v.setCfAddr}
                  ></Input>
                  <Select
                    label="Jurisdiction"
                    hint="Filters the standards and regulations drafting draws on"
                    options={v.jurisdictionOptions}
                    value={v.cfJurisdiction}
                    disabled={v.siteLocked}
                    onChange={v.setCfJurisdiction}
                  ></Select>
                </>
              )}
            </div>
            {v.copyOffer && (
              <div style={{ padding: '0 20px 20px' }}>
                <Checkbox
                  label={v.copyOffer.label}
                  description={v.copyOffer.description}
                  checked={v.cfCopy}
                  onChange={v.setCfCopy}
                />
              </div>
            )}
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
                disabled={v.siteLocked}
                hint={v.siteLocked ? v.siteLockedHint : undefined}
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
                {v.cfProblems}
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
              onClick={() => v.createAssessment()}
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

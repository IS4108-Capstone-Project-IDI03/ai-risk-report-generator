import { Fragment } from 'react'
import { Badge, Button, Callout, Checkbox, Input, Select } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

export function CreateAssessment({ v }: { v: AssessmentWorkflow }) {
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
              <Input
                label="Policy reference"
                hint="Optional \u2014 links the report to the placement file"
                placeholder="POL-00000000"
                value={v.cfRef}
                onChange={v.setCfRef}
              ></Input>
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
                {'Applicable standards'}
              </span>
              <span style={{ flex: '1' }}></span>
              <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                {v.stdCountLabel}
              </span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: '15px',
                  lineHeight: '22px',
                  color: 'var(--text-secondary)',
                  maxWidth: '68ch',
                }}
              >
                {
                  'Selected standards are loaded into the drafting set for this assessment. Only clauses from these documents can be cited in the generated report.'
                }
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px),1fr))',
                  gap: '10px 20px',
                }}
              >
                {v.standards.map((s, index) => (
                  <Fragment key={index}>
                    <div
                      style={{
                        cursor: 'pointer',
                        padding: '8px 10px',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '5px',
                        transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
                      }}
                      data-hoverable="true"
                    >
                      <Checkbox
                        label={s.name}
                        description={s.desc}
                        checked={s.on}
                        onChange={() => v.toggleStd(s.name)}
                      ></Checkbox>
                    </div>
                  </Fragment>
                ))}
              </div>
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
                {'Assigned engineers'}
              </span>
            </div>
            <div
              style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '2px' }}
            >
              {v.engineers.map((e, index) => (
                <Fragment key={index}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 10px',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
                    }}
                    data-hoverable="true"
                  >
                    <span
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
                    <span style={{ flex: '1', minWidth: '0' }}>
                      <Checkbox
                        label={e.name}
                        description={e.role}
                        checked={e.on}
                        onChange={() => v.toggleEng(e.name)}
                      ></Checkbox>
                    </span>
                    {!!e.isLead && (
                      <>
                        <Badge tone="info">{'Lead engineer'}</Badge>
                      </>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
          {!!v.hasCfError && (
            <>
              <Callout tone="danger" title="Assessment not created">
                {
                  'Site name and client are required before an assessment can be opened. Correct the two fields above, then create the assessment.'
                }
              </Callout>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0 0' }}>
            <Button variant="primary" iconLeft="plus" onClick={v.createAssessment}>
              {'Create assessment'}
            </Button>
            <Button variant="ghost" onClick={v.goDash}>
              {'Cancel'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// The Export tab for a sample assessment (no gateway): the same layout as ReportExport.tsx, with
// the sample checklist and outstanding items from useAssessmentWorkflow. Nothing is exported.
// Called by AssessmentApp when there is no saved report. Styles in export.css.
import { Button, Callout, Checkbox, Icon, Radio } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import './export.css'

export function ValidationExport({ v }: { v: AssessmentWorkflow }) {
  return (
    <div className="ex-wrap">
      <div className="ex-grid">
        <div className="ex-main">
          {!!v.blocked && (
            <Callout tone="danger" title={v.blockTitle}>
              {v.blockBody}
            </Callout>
          )}
          {!!v.notBlocked && (
            <Callout tone="success" title="Ready to export">
              {"Everything is reviewed. Sample data can't be exported."}
            </Callout>
          )}

          <section className="ex-card" aria-labelledby="ex-check-title">
            <h2 className="ex-card-title" id="ex-check-title">
              Completeness checklist
            </h2>
            <ul className="ex-items">
              {v.checklist.map((c, index) => (
                <li key={index} className="ex-item ex-item--static">
                  <Icon name={c.icon} size={16} color={c.color} />
                  <span className="ex-item-body">
                    <span className="ex-item-title">{c.label}</span>
                  </span>
                  <span style={c.valueStyle}>{c.value}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="ex-card" aria-labelledby="ex-open-title">
            <h2 className="ex-card-title" id="ex-open-title">
              Outstanding review items
              <span className="ex-muted">{v.outstandingLabel}</span>
            </h2>
            {v.outstanding.length > 0 && (
              <ul className="ex-items">
                {v.outstanding.map((o, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="ex-item"
                      data-sec={o.section}
                      aria-label={`Go to section: ${o.label}`}
                      onClick={v.jumpToSection}
                    >
                      <Icon name={o.icon} size={16} color="var(--status-moderate-fg)" />
                      <span className="ex-item-body">
                        <span className="ex-item-title">{o.label}</span>
                        <span className="ex-item-reason">{o.where}</span>
                      </span>
                      <Icon name="chevron-right" size={16} color="var(--graphite-500)" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!!v.noOutstanding && (
              <p className="ex-empty">
                <Icon name="circle-check" size={16} color="var(--green-600)" />
                {'No review items outstanding'}
              </p>
            )}
          </section>
        </div>

        <aside className="ex-side">
          <section className="ex-card" aria-labelledby="ex-export-title">
            <div className="ex-card-head">
              <h2 className="ex-card-title" id="ex-export-title">
                Export
              </h2>
              <p className="ex-muted ex-mono">{v.wordCount}</p>
            </div>
            <div className="ex-body">
              <fieldset className="ex-fieldset">
                <legend className="ex-label">Format</legend>
                <Radio
                  name="export-format"
                  label="Word document (.docx)"
                  description="Editable, for client review cycles"
                  checked={v.isDocx}
                  onChange={v.pickDocx}
                />
                <Radio
                  name="export-format"
                  label="PDF (.pdf)"
                  description="Fixed, for issue and filing"
                  checked={v.isPdf}
                  onChange={v.pickPdf}
                />
              </fieldset>
              <fieldset className="ex-fieldset">
                <legend className="ex-label">Include</legend>
                <Checkbox
                  label="Citations"
                  description="Numbered markers, with their sources listed after the report"
                  checked={v.optCite}
                  onChange={v.setOptCite}
                />
                <Checkbox
                  label="Photo appendix"
                  description="28 captioned site photographs"
                  checked={v.optPhotos}
                  onChange={v.setOptPhotos}
                />
              </fieldset>
            </div>
            <div className="ex-foot">
              <Button
                variant="primary"
                pill
                iconLeft="download"
                fullWidth
                disabled={v.blocked}
                onClick={v.askExport}
              >
                {v.exportLabel}
              </Button>
              <p className="ex-muted ex-status">{v.exportHint}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

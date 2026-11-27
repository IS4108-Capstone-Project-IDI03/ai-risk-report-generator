// The Export tab's side card (EX-01): which report, the format as two choice cards (PDF to
// issue, Word for review rounds), what to include (citations, the photo appendix), and the
// Export button with its status line and any failure. Called by screens/ReportExport, which
// holds the choices and runs the export.
import type * as React from 'react'
import { Button, Callout, Checkbox, FileTile, ListCard, Radio } from '../../../design-system'
import type { Reason } from '../../../design-system'
import type { ExportFormat } from '../api'

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', docx: 'Word' }

const FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'pdf', label: 'PDF (.pdf)', description: 'Fixed layout, to issue to the client' },
  { value: 'docx', label: 'Word document (.docx)', description: 'Editable, for review rounds' },
]

type Props = {
  facts: string
  format: ExportFormat
  onFormat: (format: ExportFormat) => void
  citations: boolean
  onCitations: (on: boolean) => void
  photos: boolean
  onPhotos: (on: boolean) => void
  // Photos chosen for Appendix A; null until read.
  appendixPhotos: number | null
  // Choices are off while exporting, or for someone who can't export.
  optionsOff: boolean
  busy: boolean
  // Why the export is not offered yet; undefined once it is.
  notYet?: Reason
  status: string
  failure: string | null
  onExport: () => void
}

export function ExportOptions({
  facts,
  format,
  onFormat,
  citations,
  onCitations,
  photos,
  onPhotos,
  appendixPhotos,
  optionsOff,
  busy,
  notYet,
  status,
  failure,
  onExport,
}: Props): React.ReactElement {
  return (
    <ListCard
      as="section"
      className="ex-card"
      aria-labelledby="ex-export-title"
      titleId="ex-export-title"
      title="Export"
      note={<span className="ex-mono">{facts}</span>}
    >
      <div className="ex-body" data-walk="export.options">
        <fieldset className="ex-fieldset" disabled={optionsOff}>
          <legend className="ex-label">Format</legend>
          {FORMATS.map((f) => (
            <div key={f.value} className="ex-choice" data-on={format === f.value || undefined}>
              <Radio
                name="export-format"
                label={f.label}
                description={f.description}
                checked={format === f.value}
                disabled={optionsOff}
                onChange={() => onFormat(f.value)}
                style={{ flex: 1, minHeight: 44 }}
              />
              <FileTile kind={f.value === 'pdf' ? 'pdf' : 'word'} />
            </div>
          ))}
        </fieldset>
        <fieldset className="ex-fieldset" disabled={optionsOff}>
          <legend className="ex-label">Include</legend>
          <Checkbox
            label="Citations"
            description="Numbered markers, with their sources listed after the report"
            checked={citations}
            disabled={optionsOff}
            onChange={onCitations}
          />
          <Checkbox
            label="Photo appendix"
            description={
              appendixPhotos === null
                ? 'Appendix A: Site Photos'
                : appendixPhotos
                  ? `Appendix A: ${appendixPhotos} photo${appendixPhotos === 1 ? '' : 's'}, as chosen and ordered there`
                  : 'No photos are chosen for Appendix A'
            }
            checked={photos && appendixPhotos !== 0}
            disabled={optionsOff || appendixPhotos === 0}
            onChange={onPhotos}
          />
        </fieldset>
      </div>
      <div className="ex-foot">
        <Button
          variant="primary"
          pill
          iconLeft="download"
          fullWidth
          // Not offered yet: greyed out, with a reason box saying why (design system v2).
          disabledReason={notYet}
          disabled={busy}
          loading={busy}
          data-walk="export.button"
          onClick={onExport}
        >
          {`Export as ${FORMAT_LABEL[format]}`}
        </Button>
        <p className="ex-muted ex-status" role="status">
          {status}
        </p>
        {failure !== null && (
          <div role="alert">
            <Callout
              tone="danger"
              title="Nothing was exported"
              actions={
                <Button variant="secondary" size="sm" onClick={onExport}>
                  Retry
                </Button>
              }
            >
              {failure}
            </Callout>
          </div>
        )}
      </div>
    </ListCard>
  )
}

// The Export tab of a saved assessment (EX-01): the finished report leaves the
// tool as a PDF, to issue to the client, or an editable Word document, for
// Marsh's review rounds. The browser lays the report out in Marsh's page
// layout (RV-12) off screen (ExportPages) and the gateway makes the file from
// those pages, so the PDF matches them page for page (AC3).
// - Only the assigned engineer, with the export permission (F-05), is offered
//   an export (AC2); the gateway answers 403 to anyone else.
// - Only a complete report is exported (AC1): written and reviewed, the
//   check until RV-04. What is left to finish is listed here with where each
//   item is and a way to it; until it is done the export is greyed out.
// - Pending edits are saved first (AC1); the file downloads named with the
//   report reference and the export date.
// - Citations and the photo appendix are the engineer's choice, applied the
//   same way to both formats (AC6).
// - A file that cannot be made says why, with Retry; nothing is simulated (AC11).
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  IconButton,
  Radio,
  toast,
} from '../../../design-system'
import {
  ExportBlockedError,
  exportReport,
  GatewayError,
  getAppendix,
  getExportBlockers,
  getReviewWorkspace,
  getSummary,
  listObservations,
  listOfis,
  listSections,
  type AcceptedOfi,
  type Assessment,
  type ExportBlocker,
  type ExportFormat,
  type ReportSection,
  type ReviewWorkspace,
  type SavedObservation,
  type Summary,
} from '../api'
import { ExportPages } from '../document/export/ExportPages'
import { marshDay } from '../document/page/frontMatter'
import { savePendingEdits } from '../pendingSaves'
import './export.css'

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', docx: 'Word' }

// What the export is doing, for its status line.
type Step =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'reading' }
  | { kind: 'laying-out'; inputs: ExportInputs }
  | { kind: 'making' }
  | { kind: 'done'; fileName: string }
  | { kind: 'failed'; message: string }

// Everything the export lays out, read fresh once pending edits are saved.
type ExportInputs = {
  workspace: ReviewWorkspace
  summary: Summary | null
  sections: ReportSection[] | null
  ofis: AcceptedOfi[]
  observations: SavedObservation[]
  appendixPhotos: number
}

const STATUS: Partial<Record<Step['kind'], string>> = {
  saving: 'Saving your latest changes…',
  reading: 'Reading the report…',
  'laying-out': 'Laying out the pages…',
  making: 'Making the file…',
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof GatewayError || error instanceof Error ? error.message : fallback

// Hands the browser the file to save.
function download(file: Blob, fileName: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ReportExport({
  reference,
  assessment,
  canExport,
  onReview,
  onGenerate,
}: {
  reference: string
  // The assessment with its client and site, for the cover and the summary.
  assessment: Assessment | null
  // The assigned engineer, with the export permission (AC2).
  canExport: boolean
  // Open the review workspace and Generation, where what is left is finished.
  onReview: () => void
  onGenerate: () => void
}) {
  const [blockers, setBlockers] = useState<ExportBlocker[] | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [appendixPhotos, setAppendixPhotos] = useState<number | null>(null)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [citations, setCitations] = useState(true)
  const [photos, setPhotos] = useState(true)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [checks, setChecks] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getExportBlockers(reference, controller.signal).then(setBlockers, (error: unknown) => {
      if (!controller.signal.aborted)
        setCheckError(messageOf(error, 'The export check could not be run.'))
    })
    getAppendix(reference, controller.signal).then(
      (list) => setAppendixPhotos(Array.isArray(list?.selected) ? list.selected.length : 0),
      () => undefined,
    )
    return () => controller.abort()
  }, [reference, checks])

  const busy = step.kind !== 'idle' && step.kind !== 'done' && step.kind !== 'failed'

  const start = async () => {
    setStep({ kind: 'saving' })
    if (!(await savePendingEdits())) {
      setStep({
        kind: 'failed',
        message:
          'Your latest changes could not be saved, so nothing was exported. Save them, then export again.',
      })
      return
    }
    setStep({ kind: 'reading' })
    try {
      // Checked again as the report now stands, saved edits included.
      const remaining = await getExportBlockers(reference)
      setBlockers(remaining)
      if (remaining.length) {
        setStep({ kind: 'idle' })
        return
      }
      const [workspace, summary, sections, ofis, observations, appendix] = await Promise.all([
        getReviewWorkspace(reference),
        getSummary(reference).catch(() => null),
        listSections(reference).catch(() => null),
        listOfis(reference),
        listObservations(reference),
        getAppendix(reference),
      ])
      setAppendixPhotos(appendix.selected.length)
      setStep({
        kind: 'laying-out',
        inputs: {
          workspace,
          summary,
          sections,
          ofis: Array.isArray(ofis?.accepted) ? ofis.accepted : [],
          observations,
          appendixPhotos: appendix.selected.length,
        },
      })
    } catch (error: unknown) {
      setStep({
        kind: 'failed',
        message: messageOf(error, 'The report could not be read for export. Try again.'),
      })
    }
  }

  const onReady = useCallback(
    (html: string) => {
      setStep({ kind: 'making' })
      exportReport(reference, { format, citations, photos, html }).then(
        ({ file, fileName }) => {
          download(file, fileName)
          setStep({ kind: 'done', fileName })
          toast.success(`Downloaded ${fileName}`)
        },
        (error: unknown) => {
          if (error instanceof ExportBlockedError) {
            setBlockers(error.blockers)
            setStep({ kind: 'idle' })
            return
          }
          setStep({
            kind: 'failed',
            message: messageOf(error, 'The file could not be made. Try exporting again.'),
          })
        },
      )
    },
    [reference, format, citations, photos],
  )
  const onFail = useCallback((message: string) => setStep({ kind: 'failed', message }), [])

  const details = [assessment?.site.name, assessment?.client].filter(Boolean)
  // Why the export is not offered yet, for its reason box; null once it is.
  const left = blockers?.length ?? 0
  const notYet = !canExport
    ? {
        title: "Can't export",
        text: "Only the assessment's assigned engineer exports its report.",
      }
    : checkError || !blockers
      ? { title: "Can't export yet", text: 'The report has not been checked yet.' }
      : left
        ? {
            title: "Can't export yet",
            text: `The report is not complete: ${left} item${left === 1 ? ' is' : 's are'} left to finish. Finish them, then export.`,
          }
        : null
  const visited = marshDay(assessment?.siteVisitDate)
  const label = FORMAT_LABEL[format]

  return (
    <div className="ex-wrap">
      <div className="ex-grid">
        <div className="ex-main">
          {checkError ? (
            <Callout
              tone="danger"
              title="The export check could not be run"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCheckError(null)
                    setChecks((n) => n + 1)
                  }}
                >
                  Try again
                </Button>
              }
            >
              {checkError}
            </Callout>
          ) : !blockers ? (
            <p className="ex-muted" role="status">
              Checking the report…
            </p>
          ) : left ? (
            <Callout
              tone="danger"
              title={`Export blocked: ${left} item${left === 1 ? '' : 's'} left`}
            >
              Only a complete report is exported: Sections 2 to 12 written, Sections 4 and 5's
              figures entered, at least one OFI accepted, and every finding decided, with none
              unsupported, out of date or citing a withdrawn source.
            </Callout>
          ) : (
            <Callout tone="success" title="Ready to export">
              The report is complete: every section is written and every finding reviewed.
            </Callout>
          )}

          <Card title="Left to finish" padding="0">
            {blockers?.length ? (
              <ul className="ex-items">
                {blockers.map((b, i) => (
                  <li key={`${b.sectionId}-${i}`} className="ex-item">
                    <Icon name="triangle-alert" size={15} color="var(--status-moderate-fg)" />
                    <div className="ex-item-body">
                      <span className="ex-item-title">{b.title}</span>
                      <span className="ex-item-reason">{b.reason}</span>
                    </div>
                    {b.where === 'generation' ? (
                      <IconButton
                        icon="chevron-right"
                        label={`Open Generation for ${b.title}`}
                        tooltip="Open Generation"
                        onClick={onGenerate}
                      />
                    ) : (
                      <IconButton
                        icon="chevron-right"
                        label={`Open review for ${b.title}`}
                        tooltip="Open review"
                        onClick={onReview}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ padding: '20px' }}>
                <EmptyState
                  icon="circle-check"
                  title={blockers ? 'Nothing left to finish' : 'Not checked yet'}
                  description={
                    blockers
                      ? 'Every section is written and every finding reviewed.'
                      : 'What is left to finish shows here once the report is checked.'
                  }
                />
              </div>
            )}
          </Card>
        </div>

        <aside className="ex-side">
          <Card title="Export" padding="0">
            <>
              <div className="ex-body">
                <fieldset className="ex-fieldset" disabled={busy || !canExport}>
                  <legend className="ex-label">Format</legend>
                  <Radio
                    name="export-format"
                    label="PDF (.pdf)"
                    description="Fixed, laid out as the page layout: to issue to the client"
                    checked={format === 'pdf'}
                    disabled={busy || !canExport}
                    onChange={() => setFormat('pdf')}
                  />
                  <Radio
                    name="export-format"
                    label="Word document (.docx)"
                    description="Editable: for review rounds"
                    checked={format === 'docx'}
                    disabled={busy || !canExport}
                    onChange={() => setFormat('docx')}
                  />
                </fieldset>
                <fieldset className="ex-fieldset ex-include" disabled={busy || !canExport}>
                  <legend className="ex-label">Include</legend>
                  <Checkbox
                    label="Citations"
                    description="Numbered markers, with the sources they cite listed in References after the report"
                    checked={citations}
                    disabled={busy || !canExport}
                    onChange={setCitations}
                  />
                  <Checkbox
                    label="Photo appendix"
                    description={
                      appendixPhotos === null
                        ? 'Appendix A: Site Photos'
                        : appendixPhotos
                          ? `Appendix A: ${appendixPhotos} photo${appendixPhotos === 1 ? '' : 's'}, as chosen and ordered there`
                          : 'No photos are chosen for Appendix A, so it is left out'
                    }
                    checked={photos && appendixPhotos !== 0}
                    disabled={busy || !canExport || appendixPhotos === 0}
                    onChange={setPhotos}
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
                  disabledReason={notYet ?? undefined}
                  disabled={busy}
                  loading={busy}
                  onClick={() => void start()}
                >
                  {`Export as ${label}`}
                </Button>
                <p className="ex-muted" role="status">
                  {STATUS[step.kind] ??
                    (step.kind === 'done'
                      ? `Downloaded ${step.fileName}.`
                      : notYet
                        ? ''
                        : `Unsaved changes are saved first. The file is named with the report reference and today's date.`)}
                </p>
                {step.kind === 'failed' && (
                  <div role="alert">
                    <Callout
                      tone="danger"
                      title="Nothing was exported"
                      actions={
                        <Button variant="secondary" size="sm" onClick={() => void start()}>
                          Retry
                        </Button>
                      }
                    >
                      {step.message}
                    </Callout>
                  </div>
                )}
              </div>
            </>
          </Card>

          <Card title="Report" padding="16px 18px">
            <dl className="ex-report">
              <dt>Reference</dt>
              <dd className="ex-mono">{reference}</dd>
              {details.length > 0 && (
                <>
                  <dt>Site</dt>
                  <dd>{details.join(' · ')}</dd>
                </>
              )}
              <dt>Assessed</dt>
              <dd>
                {[visited ?? 'Date not entered', assessment?.engineer?.name]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </dl>
          </Card>
        </aside>
      </div>
      {step.kind === 'laying-out' && (
        <ExportPages
          reference={reference}
          assessment={assessment}
          workspace={step.inputs.workspace}
          summary={step.inputs.summary}
          listedSections={step.inputs.sections}
          ofis={step.inputs.ofis}
          observations={step.inputs.observations}
          options={{ citations, photos, appendixPhotos: step.inputs.appendixPhotos }}
          onReady={onReady}
          onFail={onFail}
        />
      )}
    </div>
  )
}

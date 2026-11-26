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
// - Comment threads (RV-03) never reach the file; while any are open, how
//   many is shown as a reminder, which does not block the export (RV-03 AC9).
// - Ask conversations (AS-03) never reach the file either: nothing here or in
//   document/export/ reads them (AS-03 AC4).
import { useCallback, useEffect, useState } from 'react'
import { Button, CheckpointHeader, toast } from '../../../design-system'
import {
  ExportBlockedError,
  exportReport,
  GatewayError,
  getAppendix,
  getExportBlockers,
  getExportCheck,
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
import { formatDay } from '../format'
import { savePendingEdits } from '../pendingSaves'
import { ExportChecklist } from '../components/ExportChecklist'
import { ExportOptions } from '../components/ExportOptions'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import './export.css'

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
  // Open the review workspace (on a blocker's own section) and Generation,
  // where what is left is finished.
  onReview: (section?: string) => void
  onGenerate: () => void
}) {
  const [blockers, setBlockers] = useState<ExportBlocker[] | null>(null)
  // Comment threads still open (RV-03 AC9).
  const [openThreads, setOpenThreads] = useState(0)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [appendixPhotos, setAppendixPhotos] = useState<number | null>(null)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [citations, setCitations] = useState(true)
  const [photos, setPhotos] = useState(true)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [checks, setChecks] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getExportCheck(reference, controller.signal).then(
      (check) => {
        setBlockers(check.blockers)
        setOpenThreads(check.openThreads)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setCheckError(messageOf(error, 'The export check could not be run.'))
      },
    )
    getAppendix(reference, controller.signal).then(
      (list) => setAppendixPhotos(Array.isArray(list?.selected) ? list.selected.length : 0),
      () => undefined,
    )
    return () => controller.abort()
  }, [reference, checks])

  // The walkthrough engine (F-12) hears the export check has answered (or failed to).
  useWalkthroughScreen('export', blockers !== null || checkError !== null)

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
  const visited = assessment?.siteVisitDate
    ? `Assessed ${formatDay(new Date(assessment.siteVisitDate))}`
    : null
  const optionsOff = busy || !canExport
  const sections = new Set(blockers?.map((b) => b.title)).size
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  // The status header: checking, the check failed, blocked, or ready (GN-13's checkpoint card).
  const status = checkError
    ? {
        swapKey: 'error',
        tone: 'bad' as const,
        icon: 'triangle-alert',
        title: 'The export check could not be run',
        line: checkError,
        action: (
          <Button
            variant="secondary"
            pill
            iconLeft="rotate-ccw"
            onClick={() => {
              setCheckError(null)
              setChecks((n) => n + 1)
            }}
          >
            Try again
          </Button>
        ),
      }
    : !blockers
      ? {
          swapKey: 'checking',
          tone: 'ai' as const,
          icon: 'file-search',
          busy: true,
          title: 'Checking the report…',
          line: 'Every export starts with a check that the report is complete.',
        }
      : left
        ? {
            swapKey: 'blocked',
            tone: 'warn' as const,
            icon: 'list-checks',
            title: `Export blocked: ${plural(left, 'item')} left`,
            line: canExport
              ? `Finish what is listed below in ${plural(sections, 'section')}, then you can export the report.`
              : `The assigned engineer can export once what is listed below in ${plural(sections, 'section')} is finished.`,
          }
        : {
            swapKey: 'ready',
            tone: 'ok' as const,
            icon: 'file-check',
            title: 'Ready to export',
            line: 'Every section is written and every finding reviewed.',
          }

  return (
    <div className="ex-wrap">
      {/* The status, whichever of the four it is: one tag for the walkthrough (F-12). */}
      <div data-walk="export.status">
        <CheckpointHeader {...status} />
      </div>
      <div className="ex-grid">
        <div className="ex-main">
          <ExportChecklist
            blockers={blockers}
            openThreads={openThreads}
            canExport={canExport}
            onReview={onReview}
            onGenerate={onGenerate}
          />
        </div>
        <aside className="ex-side">
          <ExportOptions
            facts={[reference, visited, assessment?.engineer?.name].filter(Boolean).join(' · ')}
            format={format}
            onFormat={setFormat}
            citations={citations}
            onCitations={setCitations}
            photos={photos}
            onPhotos={setPhotos}
            appendixPhotos={appendixPhotos}
            optionsOff={optionsOff}
            busy={busy}
            notYet={notYet ?? undefined}
            status={
              STATUS[step.kind] ?? (step.kind === 'done' ? `Downloaded ${step.fileName}.` : '')
            }
            failure={step.kind === 'failed' ? step.message : null}
            onExport={() => void start()}
          />
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

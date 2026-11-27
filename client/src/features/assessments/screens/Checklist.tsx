import { useState } from 'react'
import { Button, Callout, EmptyState, IconAction, toast } from '../../../design-system'
import { downloadChecklistPdf, generateChecklist, GatewayError, type ChecklistChoice } from '../api'
import { ChecklistBuild } from '../components/ChecklistBuild'
import { ChecklistItems, type ChecklistAnswering } from '../components/ChecklistItems'
import { ChecklistRegenerated, type Changes } from '../components/ChecklistRegenerated'
import { formatDay } from '../format'
import { Tip } from '../../help/Tip'
import { useActivity } from '../../marshbot/useActivity'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import { useChecklist } from '../useChecklist'

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

// The assessment's Checklist tab: the standards that apply to the site, ticked
// to choose which the checklist uses (CP-30 AC1-2), and the latest checklist
// (AC9), shown and answered as on site (CP-31). Only the assigned engineer
// generates and answers; anyone who can open the assessment reads it.
export function Checklist({
  reference,
  canGenerate,
  answering,
  onViewObservation,
  area,
  item,
  archived,
}: {
  reference: string
  canGenerate: boolean
  answering: ChecklistAnswering | null
  onViewObservation: (observationId: string) => void
  // An area's title to scroll to once the checklist is in, from a MarshBot link (AS-06).
  area?: string
  // A checklist item's id to scroll to and flash, from a MarshBot link (AS-06).
  item?: string
  // The assessment is archived: no walkthrough is offered on it (F-12).
  archived?: boolean
}) {
  const { view, setView, loadError, reload } = useChecklist(reference)
  // F-12: ready once the checklist has loaded; nothing is offered over an error or an archive.
  useWalkthroughScreen('checklist', !!view, archived || !!loadError)
  // AS-06: the assigned engineer's time here and which items they saw (an admin's is not counted).
  useActivity(reference, 'checklist', canGenerate, true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Pressing Regenerate shows the build view again; null when nothing is to be said after.
  const [rebuilding, setRebuilding] = useState(false)
  const [regenerated, setRegenerated] = useState<{
    lost: string[]
    replacing: Set<string>
    changes: Changes | null
  } | null>(null)
  const [downloading, setDownloading] = useState(false)

  if (loadError) {
    return (
      <div className="ck-page cl-cards">
        <Callout tone="danger" title="The checklist could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  }
  if (!view)
    return (
      <div className="ck-page" aria-busy="true">
        <p className="cl-note">Loading the checklist…</p>
      </div>
    )

  const answered = view.checklist?.items.filter((i) => i.check) ?? []
  // The engineer's own changes (CP-32), kept when it is generated again.
  const customised =
    view.checklist?.items.some((i) => i.origin === 'manual' || i.edited || i.removed) ?? false
  const generate = async (choice: ChecklistChoice) => {
    setRunning(true)
    setError(null)
    setRegenerated(null)
    try {
      const generated = await generateChecklist(reference, choice)
      setView(generated)
      setRebuilding(false)
      if (answered.length || customised) {
        setRegenerated({
          lost: generated.carryOver?.dropped ?? [],
          replacing: new Set(generated.carryOver?.mayReplace ?? []),
          changes: generated.carryOver?.changes ?? null,
        })
      }
    } catch (failure: unknown) {
      setError(
        failure instanceof GatewayError
          ? failure.message
          : 'The checklist could not be generated. Try again.',
      )
    } finally {
      setRunning(false)
    }
  }
  const generated = view.checklist && new Date(view.checklist.provenance.generated_at)
  // The PDF to take on site (CP-32), for anyone who can open the assessment.
  const downloadPdf = async () => {
    setDownloading(true)
    try {
      const { file, fileName } = await downloadChecklistPdf(reference)
      download(file, fileName)
      toast.success(`Downloaded ${fileName}`)
    } catch (failure: unknown) {
      toast.error("Couldn't download the checklist", {
        description: failure instanceof GatewayError ? failure.message : 'Try again.',
      })
    } finally {
      setDownloading(false)
    }
  }

  // Before any checklist, and when Regenerate is pressed, the engineer builds one.
  const building = canGenerate && (!view.checklist || rebuilding)
  return (
    <div className="ck-page cl-cards">
      {!building && (
        <div className="cl-top">
          <div className="cl-top-title">
            <h2 className="cl-title">Pre-survey checklist</h2>
            {/* Only the date: the model, standards count and version are not the reader's concern. */}
            {generated && <p className="cl-meta">Generated {formatDay(generated)}</p>}
          </div>
          <div className="cl-top-actions">
            {view.checklist && (
              <IconAction
                icon="download"
                label="Download checklist PDF"
                tooltip="Download PDF"
                shaded
                data-walk="checklist.download"
                disabled={downloading}
                onClick={() => void downloadPdf()}
              />
            )}
            {canGenerate && view.checklist && (
              <Button variant="pill" iconLeft="sparkles" onClick={() => setRebuilding(true)}>
                Regenerate checklist
              </Button>
            )}
            {canGenerate && view.checklist && <Tip id="checklist.regenerate" align="right" />}
          </div>
        </div>
      )}
      {regenerated && (
        <ChecklistRegenerated
          lost={regenerated.lost}
          replacing={regenerated.replacing.size}
          changes={regenerated.changes}
          onDismiss={() => setRegenerated(null)}
        />
      )}
      {error && (
        <Callout tone="danger" title="Couldn't generate the checklist">
          {error}
          {view.checklist && ' The checklist below is the last one generated.'}
        </Callout>
      )}
      {building ? (
        <ChecklistBuild
          view={view}
          running={running}
          note={
            view.checklist
              ? 'Your answers stay with the items that come back, and your edited, added and removed items are kept. Nothing is removed from Observations.'
              : undefined
          }
          onGenerate={(choice) => void generate(choice)}
          onCancel={view.checklist ? () => setRebuilding(false) : undefined}
        />
      ) : view.checklist ? (
        <ChecklistItems
          key={view.checklist.id}
          reference={reference}
          view={{ ...view, checklist: view.checklist }}
          setView={setView}
          reload={reload}
          answering={answering}
          customising={canGenerate}
          openArea={area}
          openItem={item}
          highlight={regenerated?.replacing}
          regenerateHint={
            canGenerate
              ? 'Regenerate it for the site as it is now.'
              : "The assessment's assigned engineer can regenerate it."
          }
          onViewObservation={onViewObservation}
        />
      ) : (
        <EmptyState
          icon="list-checks"
          title="No checklist yet"
          description="The assessment's assigned engineer generates its checklist."
        />
      )}
    </div>
  )
}

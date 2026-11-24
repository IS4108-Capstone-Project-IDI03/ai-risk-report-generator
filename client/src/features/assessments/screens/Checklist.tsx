import { useState } from 'react'
import { Button, Callout, EmptyState, IconButton, toast } from '../../../design-system'
import { downloadChecklistPdf, generateChecklist, GatewayError, type ChecklistChoice } from '../api'
import { caption, heading, muted } from '../checklistChecks'
import { ChecklistBuild } from '../components/ChecklistBuild'
import { ChecklistItems, type ChecklistAnswering } from '../components/ChecklistItems'
import { formatDay } from '../format'
import { plural } from '../reviewDisplay'
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

type Changes = { edited: number; added: number; removed: number }

// "Your 2 edited, 1 added and 1 removed items are kept.", or null for none (CP-32).
function changesKept({ edited, added, removed }: Changes) {
  const parts = [
    edited && `${edited} edited`,
    added && `${added} added`,
    removed && `${removed} removed`,
  ].filter(Boolean) as string[]
  if (!parts.length) return null
  const total = edited + added + removed
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `Your ${list} ${total === 1 ? 'item is' : 'items are'} kept.`
}

// What regenerating an answered or customised checklist did to its answers
// (CP-31) and the engineer's changes (CP-32), until dismissed: that they were
// all kept; or how many answers were not, with the items as they were worded,
// folded away, since the new items that may replace them are highlighted in
// the checklist below. Nothing is said of a checklist with neither.
function Regenerated({
  lost,
  replacing,
  changes,
  onDismiss,
}: {
  lost: string[]
  // How many new items may replace them, highlighted below.
  replacing: number
  changes: Changes | null
  onDismiss: () => void
}) {
  const dismiss = (
    <Button variant="link" size="sm" onClick={onDismiss}>
      Dismiss
    </Button>
  )
  const kept = changes && changesKept(changes)
  if (lost.length === 0) {
    return (
      <Callout tone="success" title="Checklist regenerated">
        {[kept, 'All your answers are kept.'].filter(Boolean).join(' ')}
        <div style={{ marginTop: 'var(--space-3)' }}>{dismiss}</div>
      </Callout>
    )
  }
  const one = lost.length === 1
  const highlighted =
    replacing === 0
      ? ''
      : `${replacing === 1 ? 'An item that' : 'Items that'} may replace ${one ? 'it' : 'them'} ${replacing === 1 ? 'is' : 'are'} tinted below. `
  return (
    <Callout
      tone="warning"
      title={`Checklist regenerated: ${plural(lost.length, 'answer')} ${one ? 'was' : 'were'} not kept`}
    >
      {one ? 'This item was' : 'These items were'} reworded, so{' '}
      {one ? 'its answer' : 'their answers'} did not carry over. {highlighted}What you recorded is
      still in Observations.{kept && ` ${kept}`}
      {/* For an item removed rather than reworded, which nothing below shows. */}
      <details style={{ margin: 'var(--space-3) 0' }}>
        <summary style={{ cursor: 'pointer' }}>Show the earlier wording ({lost.length})</summary>
        <ul style={{ margin: 'var(--space-3) 0 0', paddingLeft: 'var(--space-6)' }}>
          {lost.map((text, i) => (
            <li key={i + text}>{text}</li>
          ))}
        </ul>
      </details>
      {dismiss}
    </Callout>
  )
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
      <div style={{ padding: '24px' }}>
        <Callout tone="danger" title="The checklist could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  }
  if (!view) return <p style={{ ...muted, padding: '24px' }}>Loading the checklist…</p>

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        padding: 'var(--space-8)',
        maxWidth: '760px',
      }}
    >
      {!building && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-5)',
          }}
        >
          <h2
            style={{
              ...heading,
              fontSize: 'var(--text-h2-size)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--marsh-navy)',
              flex: '1 1 360px',
            }}
          >
            Pre-survey checklist
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {view.checklist && (
              <IconButton
                icon="download"
                label="Download checklist PDF"
                tooltip="Download PDF"
                variant="outline"
                data-walk="checklist.download"
                disabled={downloading}
                onClick={() => void downloadPdf()}
              />
            )}
            {canGenerate && view.checklist && (
              <Button variant="secondary" iconLeft="sparkles" onClick={() => setRebuilding(true)}>
                Regenerate checklist
              </Button>
            )}
            {canGenerate && view.checklist && <Tip id="checklist.regenerate" align="right" />}
          </div>
        </div>
      )}
      {regenerated && (
        <Regenerated
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
      ) : view.checklist && generated ? (
        <>
          <p style={caption}>
            Generated {formatDay(generated)}{' '}
            {generated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {view.checklist.provenance.model ?? 'no model called'} ·{' '}
            {plural(view.checklist.standards.length, 'standard')} ·{' '}
            {view.checklist.provenance.checklist_version}
          </p>
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
        </>
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

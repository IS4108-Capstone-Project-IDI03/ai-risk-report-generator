// The left card of the reading screen (CP-23 AC1, AC3, AC4, AC22, boards 10,
// 11, 14): "Reading N documents · X of N read · about N s left", Cancel, one
// progress bar for every file, then each file's status and a Failed group.
// Status words are simulated on a timer (one request reads everything) and
// finish on the real result. Used by screens/ReadingDocuments.tsx.
import { useState } from 'react'
import { Button, Icon } from '../../../design-system'
import { plural } from '../../clients/formatClient'
import { EXPECTED_SECONDS, type Intake } from '../useIntake'
import { failureOf, stepAt, stepsFor } from '../reading'
import { ReadingFileRow, type FileRow } from './ReadingFileRow'

// "Attachment: Plan.pdf (from Request.eml)", as ingestion names an attachment.
const attachmentName = (name: string) => /^Attachment: (.+) \(from .+\)$/.exec(name)?.[1] ?? name

/** Returns every row the card lists, in order, and the failed ones apart. */
function rowsOf(intake: Intake) {
  const { phase, files, added, read, revealed, elapsed } = intake
  const after = !!read
  const pasted = !!added.text.trim()
  // Before the gateway answers, the files as added; then as it listed them.
  const listed = files.length
    ? files.filter((f) => f.status !== 'refused' && f.status !== 'failed')
    : added.files.map((f) => ({ id: null, name: f.name }))
  const top = [
    ...(pasted ? [{ id: 'pasted-text', name: 'Pasted text', pasted: true }] : []),
    ...listed.map((f) => ({ ...f, pasted: false })),
  ]
  const rows: FileRow[] = []
  top.forEach((f, k) => {
    const steps = stepsFor(f.name, f.pasted)
    const done = after && k < revealed
    const words = phase === 'uploading' ? 'Uploading' : stepAt(steps, k, elapsed)
    rows.push({
      key: f.id ?? 'local-' + k,
      name: f.name,
      pasted: f.pasted,
      state: done ? 'done' : after || words ? 'working' : 'waiting',
      label: after ? 'Almost done' : (words ?? undefined),
    })
    // An email's attachments, known once read, tick with their email.
    for (const s of read?.sources ?? [])
      if (s.fileId === f.id && s.documentId !== f.id)
        rows.push({
          key: s.documentId,
          name: attachmentName(s.name),
          inEmail: f.name,
          state: done ? 'done' : 'working',
          label: 'Almost done',
        })
  })
  const failed: FileRow[] = files
    .filter((f) => f.status === 'refused' || f.status === 'failed')
    .map((f, k) => ({
      key: f.id ?? 'failed-' + k,
      name: f.name,
      state: 'done',
      failure: failureOf(f),
    }))
  return { rows, failed, total: top.length, read: after ? Math.min(revealed, top.length) : 0 }
}

export function ReadingCard({
  intake,
  onRetry,
  onFillIn,
}: {
  intake: Intake
  // Reads again and fills the form in (screens/NewAssessment.tsx).
  onRetry: () => void
  onFillIn: () => void
}) {
  const { phase } = intake
  // Failed files the engineer removed from the list.
  const [removed, setRemoved] = useState<string[]>([])
  const { rows, failed, total, read } = rowsOf(intake)
  const finished = phase === 'held' || phase === 'done' || phase === 'leaving'
  // Simulated while reading, held short of full until the result lands.
  const progress = finished
    ? 1
    : phase === 'revealing'
      ? 0.85 + (0.15 * read) / Math.max(1, total)
      : phase === 'uploading'
        ? 0.05
        : Math.min(0.85, 0.05 + (0.8 * intake.elapsed) / EXPECTED_SECONDS)
  const shownFailed = failed.filter((r) => !removed.includes(r.key))
  return (
    <section className="na-card na-reading" aria-label="Reading documents">
      <div className="na-reading-head">
        <h2>
          {finished ? plural(total, 'document') + ' read' : 'Reading ' + plural(total, 'document')}
        </h2>
        {/* Announced to a screen reader only; the bar shows progress (board 24). */}
        <span className="na-sr-only" aria-live="polite">{`${read} of ${total} read`}</span>
        <span className="na-card-actions">
          {/* A read that went wrong can be tried again, or the form filled in by hand. */}
          {phase === 'failed' && (
            <>
              <Button variant="pill" iconLeft="rotate-ccw" onClick={onRetry}>
                {'Try again'}
              </Button>
              <Button variant="pill" iconLeft="pencil" onClick={onFillIn}>
                {'Fill in the form'}
              </Button>
            </>
          )}
          <Button variant="ghost" className="na-text-btn" onClick={intake.cancel}>
            {'Cancel'}
          </Button>
        </span>
      </div>
      <div
        className={'na-bar' + (finished ? ' is-done' : phase === 'failed' ? ' is-stopped' : '')}
        role="progressbar"
        aria-label="Reading progress"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      {phase === 'failed' ? (
        <p className="na-read-error" role="alert">
          <Icon name="circle-alert" size={14} />
          <strong>{'Not read.'}</strong> {intake.error}
        </p>
      ) : (
        <p className="na-hint">
          <Icon name="info" size={14} />
          {'The form opens when every document is read.'}
        </p>
      )}
      <ul className="na-files" aria-label="Documents">
        {rows.map((r) => (
          <ReadingFileRow key={r.key} row={r} />
        ))}
      </ul>
      {!!shownFailed.length && (
        <>
          <div className="na-files-group">{'Failed'}</div>
          <ul className="na-files" aria-label="Failed documents">
            {shownFailed.map((r) => (
              <ReadingFileRow
                key={r.key}
                row={r}
                onRemove={() => setRemoved([...removed, r.key])}
                onRetry={onRetry}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

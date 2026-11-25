// One job in the activity popover (F-11): what it is, what it belongs to, and
// how far it has got, drawn by what can honestly be measured. Pressing it opens
// the job's own place. Called by BackgroundWorkList.
import { useState } from 'react'
import { Button, Icon, ProgressBar, RowMark, SegmentBar, toast } from '../../../design-system'
import { retryWork, type BackgroundWorkRow } from '../api'
import { openWork } from '../openWork'
import { countWords, plainReason, stageWords, timedWords } from '../words'

export function BackgroundWorkItem({
  row,
  onOpen,
  onRetried,
}: {
  row: BackgroundWorkRow
  // Called before the job's place opens, so the popover can close.
  onOpen: () => void
  // Called once a Try again was accepted, so the list reads itself again.
  onRetried: () => void
}) {
  const [retrying, setRetrying] = useState(false)
  const tryAgain = (retry: NonNullable<BackgroundWorkRow['retry']>) => {
    setRetrying(true)
    retryWork(retry)
      .then(onRetried)
      .catch(() =>
        toast.error("Couldn't try again", {
          description: 'Open it to see what happened, or try again in a minute.',
        }),
      )
      .finally(() => setRetrying(false))
  }
  const open = () => {
    onOpen()
    openWork(row)
  }
  return (
    // The whole row opens the job by pointer, its reason included; its buttons
    // (open, Try again) handle their own presses, and the keyboard uses the open button.
    <li className="bgw-row" onClick={(e) => !(e.target as HTMLElement).closest('button') && open()}>
      <button type="button" className="bgw-row__open" onClick={open}>
        <span className="bgw-row__title">{row.title}</span>
        <span className="bgw-row__context">{row.context.label}</span>
        <Progress row={row} />
      </button>
      {row.state === 'failed' && (
        <div className="bgw-row__failed">
          {/* A few plain words, never the gateway's own sentence; the whole reason is on the
              job's own page, which the row opens. */}
          <p className="bgw-row__error">
            <Icon name="circle-alert" size={14} />
            <span className="bgw-row__reason">{plainReason(row.error)}</span>
          </p>
          {row.retry && (
            <Button
              variant="secondary"
              size="xs"
              iconLeft="refresh-cw"
              loading={retrying}
              onClick={() => tryAgain(row.retry!)}
            >
              Try again
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function Progress({ row }: { row: BackgroundWorkRow }) {
  const { progress } = row
  const { current, total } = progress
  // Waiting on you: what to do is the whole message.
  if (row.state === 'waiting_on_you')
    return <span className="bgw-progress__step">{progress.stage}</span>
  // Queued: nothing to measure yet, only the wait.
  if (row.state === 'queued')
    return <span className="bgw-progress__step">{timedWords('Queued', row.startedAt)}</span>
  // Parts or stages the gateway marked, failed or not: one segment each, so a
  // failure shows where it fell. Named stages (ingestion) say which, with the
  // pages done in it as words under them, so a row has one bar.
  if (progress.segments?.length) {
    const staged = Boolean(progress.step && progress.steps)
    return (
      <div className="bgw-progress">
        <SegmentBar
          segments={progress.segments}
          count={current ?? 0}
          total={progress.segments.length}
          word={progress.unit ?? ''}
          {...(staged && { label: stageWords(progress) })}
        />
        {staged && row.state === 'running' && total ? (
          <span className="bgw-progress__count">{countWords(progress)}</span>
        ) : null}
      </div>
    )
  }
  // One AI call: no bar, since nothing measures how far it has got.
  if (progress.type === 'working' && row.state === 'running')
    return (
      <span className="bgw-progress__step">
        <RowMark kind="working" />
        {timedWords(progress.stage ?? 'Working', row.startedAt)}
      </span>
    )
  // Pages or regions: fine enough for a bar, and the count is real, never estimated.
  if (progress.type === 'count' && current !== undefined && total)
    return (
      <div className="bgw-progress">
        <ProgressBar
          value={Math.round((current / total) * 100)}
          label={stageWords(progress)}
          showValue={false}
        />
        <span className="bgw-progress__count">{countWords(progress)}</span>
      </div>
    )
  // Recordings or parts sent without their marks: one segment each by the
  // count, the next one marked as being worked on.
  if (progress.type === 'stages' && current !== undefined && total)
    return (
      <div className="bgw-progress">
        <SegmentBar
          segments={Array.from({ length: total }, (_, i) =>
            i < current ? 'done' : i === current ? 'working' : 'empty',
          )}
          count={current}
          total={total}
          word={progress.unit ?? ''}
        />
      </div>
    )
  return null
}

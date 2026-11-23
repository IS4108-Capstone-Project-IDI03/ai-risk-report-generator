// One job in the activity popover (F-11): what it is, what it belongs to, and
// how far it has got, drawn by what can honestly be measured. Called by
// BackgroundWorkList.
import { ProgressBar, RowMark, SegmentBar } from '../../../design-system'
import type { BackgroundWorkRow } from '../api'
import { countWords, stageWords, timedWords } from '../words'

export function BackgroundWorkItem({ row }: { row: BackgroundWorkRow }) {
  return (
    <li className="bgw-row">
      <div className="bgw-row__body">
        <span className="bgw-row__title">{row.title}</span>
        <span className="bgw-row__context">{row.context.label}</span>
        <Progress row={row} />
      </div>
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
  // Recordings or parts: too few for a smooth bar, so one segment each, the
  // next one marked as being worked on.
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

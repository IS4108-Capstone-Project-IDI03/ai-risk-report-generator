// One file on the reading screen (CP-23 AC1, AC3, AC4, boards 10, 14): its
// tile and name, then its status words and indicator at the right; an email's
// attachment indented under it "in <email>"; a failed file with its short
// error in red, the fix in grey, and a bin or retry icon. Used by ReadingCard.tsx.
import { FileTile, Icon, IconButton, ReadingStatus } from '../../../design-system'
import type { Failure } from '../reading'

export type FileRow = {
  key: string
  name: string
  // The email an attachment came in; set only for attachments.
  inEmail?: string
  pasted?: boolean
  state: 'working' | 'waiting' | 'done'
  label?: string
  failure?: Failure
}

export function ReadingFileRow({
  row,
  onRemove,
  onRetry,
}: {
  row: FileRow
  onRemove?: () => void
  onRetry?: () => void
}) {
  const tile = <FileTile name={row.name} kind={row.pasted ? 'text' : undefined} />
  if (row.failure)
    return (
      <li className="na-file is-failed">
        {tile}
        <span className="na-file-text">
          <span className="na-file-name" dir="auto" title={row.name}>
            {row.name}
          </span>
          <span className="na-file-error">
            <Icon name="circle-alert" size={14} />
            <strong>{row.failure.error}</strong> {row.failure.fix}
          </span>
        </span>
        {row.failure.retry
          ? onRetry && (
              <IconButton
                icon="rotate-ccw"
                label={'Try ' + row.name + ' again'}
                tooltip="Try again"
                onClick={onRetry}
              />
            )
          : onRemove && (
              <IconButton
                icon="trash-2"
                label={'Remove ' + row.name}
                tooltip="Remove file"
                onClick={onRemove}
              />
            )}
      </li>
    )
  return (
    <li className={'na-file' + (row.inEmail ? ' is-attachment' : '')}>
      {row.inEmail && <Icon name="corner-down-right" size={14} className="na-file-in" />}
      {tile}
      <span className="na-file-text na-file-line">
        <span className="na-file-name" dir="auto" title={row.name}>
          {row.name}
        </span>
        {row.inEmail && (
          <span className="na-file-email" dir="auto" title={row.inEmail}>
            {'in ' + row.inEmail}
          </span>
        )}
      </span>
      <ReadingStatus state={row.state} label={row.label} />
    </li>
  )
}

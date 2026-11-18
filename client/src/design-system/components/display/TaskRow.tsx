// Task row (GN-13, NEW pattern): its own icon tile, a title over its place ("Section 4"), then
// one mark: a chevron while it is open, when the whole row is a button that opens it, or a green
// tick once done. `active` tints the tile amber: it is the person's turn. Used by Generation's
// step 2. Calls RowMark.
import { Icon } from '../core/Icon'
import { RowMark } from './RowMark'
import './steps.css'

export type TaskRowProps = {
  icon: string
  title: string
  detail: string
  done?: boolean
  active?: boolean
  // Opens the task; without it (or once done) the row is not a button.
  onOpen?: () => void
}

/** Returns one task; a button while it can be opened. */
export function TaskRow({
  icon,
  title,
  detail,
  done = false,
  active = false,
  onOpen,
}: TaskRowProps) {
  const body = (
    <>
      <span className="ds-task-tile">
        <Icon name={icon} size={15} />
      </span>
      <span className="ds-task-name">
        {title}
        <small>{detail}</small>
      </span>
      <span className="ds-srow-end">
        {done ? <RowMark kind="done" /> : onOpen ? <RowMark kind="open" /> : null}
      </span>
    </>
  )
  const flags = {
    'data-done': done ? '' : undefined,
    'data-active': active && !done ? '' : undefined,
  }
  return onOpen && !done ? (
    <button type="button" className="ds-task" onClick={onOpen} {...flags}>
      {body}
    </button>
  ) : (
    <div className="ds-task" {...flags}>
      {body}
    </div>
  )
}

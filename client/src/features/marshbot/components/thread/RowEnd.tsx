// The one slot every card row ends in (AS-06 rule 4), 128 px wide and flush right: a soft-blue
// pill with the row's verb, a round arrow that only opens something, "Done" or "Transcribing"
// where the button was, or a tick. Earlier sessions are read-only, so their slots stay empty.
// Used by CardRow.tsx. Reads the thread's actions from context.ts.
import { useContext, useEffect, useRef, type ReactNode } from 'react'
import { Button, Icon, IconButton, Tooltip } from '../../../../design-system'
import { TurnContext, useMarshBot } from '../../context'
import type { CardRow } from '../../types'

// "Done" with a green tick, or a spinner with "Transcribing", where the button was. A status that
// replaces the pressed Try Again (`takeFocus`) keeps keyboard focus, which would otherwise fall to
// the page's top with the button; it stays the same element as the row's later states.
function Status({
  status,
  label,
  takeFocus = false,
}: {
  status: 'done' | 'busy'
  label: string
  takeFocus?: boolean
}) {
  const self = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (takeFocus && document.activeElement === document.body) self.current?.focus()
  }, [takeFocus])
  return (
    <span ref={self} className="mbt-status" data-status={status} role="status" tabIndex={-1}>
      {status === 'busy' ? (
        <span className="mbt-spinner" aria-hidden="true" />
      ) : (
        <Icon name="circle-check" size={16} />
      )}
      {label}
    </span>
  )
}

/** Returns the row's ending: its button, arrow, status or tick. */
export function RowEnd({ row }: { row: CardRow }) {
  const bot = useMarshBot()
  const past = useContext(TurnContext)?.past ?? false
  const end = row.end
  let view: ReactNode
  // a. A pressed Try again shows as running until the gateway reports the row's next state.
  if (past) view = null
  else if (end.type === 'button' && end.action && bot.busy.has(row.id))
    view = <Status status="busy" label="Transcribing" takeFocus />
  else if (end.type === 'button') {
    const link = end.link
    view = (
      <Button
        variant="tonal"
        pill
        iconLeft={end.icon ?? undefined}
        // Named with its row: a list of bare "Review"s says nothing to a screen reader.
        aria-label={`${end.label} ${row.title}`}
        onClick={() => (end.action ? bot.retry(row) : link && bot.openLink(link))}
        style={{
          width: '100%',
          height: 'var(--mbt-control)',
          color: 'var(--marsh-navy)',
          fontWeight: 600,
          border: '1px solid var(--ink-100)',
        }}
      >
        {end.label}
      </Button>
    )
  } else if (end.type === 'open') {
    const link = end.link
    view = (
      <Tooltip label={end.label} placement="top-end">
        <IconButton
          icon="chevron-right"
          label={`${end.label}: ${row.title}`}
          // The Tooltip says it; an empty title keeps the browser's own from showing twice.
          tooltip=""
          onClick={() => bot.openLink(link)}
          className="mbt-open"
        />
      </Tooltip>
    )
  } else if (end.type === 'status') view = <Status status={end.status} label={end.label} />
  else
    view = (
      <span className="mbt-tick" role="img" aria-label="Done">
        <Icon name="circle-check" size={18} />
      </span>
    )
  return <span className="mbt-end">{view}</span>
}

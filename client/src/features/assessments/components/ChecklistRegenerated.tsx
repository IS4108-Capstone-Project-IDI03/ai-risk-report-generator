// What regenerating the checklist did to the engineer's answers (CP-31) and changes (CP-32), shown
// on the Checklist tab until dismissed. Moved out of screens/Checklist.tsx, which renders it.
import { Button, Callout } from '../../../design-system'
import { plural } from '../reviewDisplay'

export type Changes = { edited: number; added: number; removed: number }

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

/** Returns the callout: everything kept, or how many answers were not, with their old wording folded away. */
export function ChecklistRegenerated({
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

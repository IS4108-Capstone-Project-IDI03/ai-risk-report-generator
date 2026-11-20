// The Observations list's footer (CP-24, AC11): "27 observations · 4 to check", the count a
// link that filters to To check (hidden at 0); while filtered, "4 of 27 observations".
// Called by screens/Observations.tsx.
import { TableFooter } from '../../../design-system'

const count = (n: number) => `${n} observation${n === 1 ? '' : 's'}`

/** Returns the footer line under the table. */
export function ObservationFooter({
  total,
  shown,
  toCheck,
  filtered,
  onToCheck,
}: {
  total: number
  shown: number
  toCheck: number
  filtered: boolean
  onToCheck: () => void
}) {
  if (filtered) return <TableFooter>{`${shown} of ${count(total)}`}</TableFooter>
  return (
    <TableFooter
      tone="warn"
      late={toCheck > 0 ? `${toCheck} to check` : undefined}
      onLateClick={onToCheck}
    >
      {count(total)}
    </TableFooter>
  )
}

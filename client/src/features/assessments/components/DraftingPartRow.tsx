// One part as a row of a Generation step card (GN-13): its number, name and ONE mark, read from
// the part's state. Flagged rows: red when drafting failed, amber when out of date or (before
// step 1) when it has no observations. Rendered by screens/DraftingSteps.tsx.
import { RowCount, RowMark, SectionRow, Tooltip } from '../../../design-system'
import type { GenerationPart } from '../generation/types'
import { outOfDateReason } from '../generation/words'
import { plural } from '../reviewDisplay'

// "1,284 observations", as RowCount shows the number.
const COUNT = new Intl.NumberFormat('en-GB')

/** Returns the part's row; `showCount` puts its observation count where the mark goes. */
export function DraftingPartRow({ part, showCount }: { part: GenerationPart; showCount: boolean }) {
  const row = { number: part.id, name: part.title }
  // a. Work under way comes first: it is what is happening now.
  if (part.job === 'drafting')
    return <SectionRow {...row} mark={<RowMark kind="working" label="Drafting" />} />
  if (part.job === 'queued')
    return <SectionRow {...row} mark={<RowMark kind="waiting" label="Waiting to be drafted" />} />
  // b. A failure counts only while there is no draft: a failed redraft keeps the old one.
  if (part.job === 'failed' && !part.drafted)
    return (
      <SectionRow
        {...row}
        flag="bad"
        reason={
          <>
            <b>Drafting failed</b> after {plural(part.attempts, 'attempt')}
          </>
        }
        mark={
          // The gateway's plain reason, on the red mark: board 09 keeps the row to one short line.
          <Tooltip label={part.error ?? 'Drafting failed.'} placement="top-end" maxWidth={260} tap>
            <RowMark kind="failed" label={`Not drafted: ${part.error ?? 'Drafting failed.'}`} />
          </Tooltip>
        }
      />
    )
  if (part.outOfDate)
    return (
      <SectionRow
        {...row}
        flag="warn"
        reason={outOfDateReason(part.outOfDate)}
        mark={<RowMark kind="stale" label="Out of date" />}
      />
    )
  if (part.drafted) return <SectionRow {...row} mark={<RowMark kind="done" label="Drafted" />} />
  // c. Not drafted yet: step 1 shows what it will be drafted from; 0 blocks drafting.
  if (showCount && part.observations !== null) {
    const none = part.observations === 0
    const count = (
      <RowCount
        count={part.observations}
        icon="camera"
        label={`${COUNT.format(part.observations)} observation${part.observations === 1 ? '' : 's'}`}
        warn={none}
      />
    )
    return <SectionRow {...row} flag={none ? 'warn' : undefined} mark={count} />
  }
  return <SectionRow {...row} />
}

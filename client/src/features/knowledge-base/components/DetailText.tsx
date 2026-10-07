// A detail's text, as an amber chip with a warning icon when it is Unconfirmed
// (IN-05), so the detail to fill in stands out. Used by components/DocumentRow.tsx,
// components/DocumentDetails.tsx and components/UploadedDocuments.tsx.
import { Badge, IconRegistry } from '../../../design-system'
import { UNCONFIRMED } from '../display'

/** Returns the text, flagged when it is the Unconfirmed placeholder. */
export function DetailText({ text }: { text: string | null }) {
  return text === UNCONFIRMED || text === null ? (
    // The same badge as Needs review (components/DocumentRow.tsx), so the two match.
    <Badge tone="moderate" icon={IconRegistry.status.flagged.icon}>
      {UNCONFIRMED}
    </Badge>
  ) : (
    <>{text}</>
  )
}

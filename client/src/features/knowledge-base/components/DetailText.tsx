// A detail's text, as an amber pill with a warning icon when it is Unconfirmed
// (IN-05), so the detail to fill in stands out. Used by components/DocumentRow.tsx,
// components/DocumentDetails.tsx and components/UploadedDocuments.tsx.
import { IconRegistry } from '../../../design-system'
import { UNCONFIRMED } from '../display'
import { TonePill } from './TonePill'

/** Returns the text, flagged when it is the Unconfirmed placeholder. */
export function DetailText({ text }: { text: string | null }) {
  return text === UNCONFIRMED || text === null ? (
    // The same amber as Needs review (components/DocumentRow.tsx), so the two match.
    <TonePill tone="amber" icon={IconRegistry.status.flagged.icon}>
      {UNCONFIRMED}
    </TonePill>
  ) : (
    <>{text}</>
  )
}

// A detail's text, in muted type when it is Unconfirmed (IN-05). Used by
// components/DocumentRow.tsx and components/DocumentDetails.tsx.
import { UNCONFIRMED } from '../display'

/** Returns the text, muted when it is the Unconfirmed placeholder. */
export function DetailText({ text }: { text: string | null }) {
  return text === UNCONFIRMED || text === null ? (
    <span className="kb-unconfirmed">{UNCONFIRMED}</span>
  ) : (
    <>{text}</>
  )
}

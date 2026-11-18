// A line above a part in Review about its background drafting (GN-13): a drafting run is
// redrafting it now, or its last redraft failed. Rendered by screens/ReviewWorkspace.tsx.
import { Callout } from '../../../design-system'

/** Returns the notice for `name` ("Section 7"), or nothing while its drafting is fine. */
export function PartJobNotice({
  name,
  redrafting = false,
  failed = null,
}: {
  name: string
  // A drafting run is redrafting it: its finding controls are off until the job clears.
  redrafting?: boolean
  // Why its last redraft failed.
  failed?: string | null
}) {
  if (redrafting)
    return (
      <div role="status">
        <Callout tone="info">
          {name} is being redrafted. You can review it again when it&apos;s ready.
        </Callout>
      </div>
    )
  if (failed)
    return (
      <div role="alert">
        <Callout tone="warning" title={`${name} was not redrafted`}>
          {failed} The saved draft is unchanged.
        </Callout>
      </div>
    )
  return null
}

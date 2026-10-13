// Section 3 in the Review tab: the suggested OFIs to accept, each with its sources
// and precedent, then the OFIs in the report in Marsh's category order (GN-05 AC2-AC4).
// Accepting moved here from Generation, which only generates (GN-07, Miya 12 Oct).
// Rendered by screens/ReviewWorkspace.tsx. Calls the gateway's accept route (api.ts).
import { useState } from 'react'
import { Button, Callout } from '../../../design-system'
import { acceptOfi, GatewayError, type OfiList, type SavedObservation } from '../api'
import { OFI_CATEGORIES } from '../reviewDisplay'
import { OfiBlock } from './OfiSuggestions'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function OfiReviewPanel({
  reference,
  ofis,
  setOfis,
  observations,
  canAccept,
  onAccepted,
}: {
  reference: string
  ofis: OfiList
  // Shows the list each accept returns, so what is shown is what is saved.
  setOfis: (list: OfiList) => void
  observations: SavedObservation[]
  // The assigned engineer, on an assessment not archived; the gateway checks it too.
  canAccept: boolean
  // Told after accepts change Section 3, which the Executive Summary summarises.
  onAccepted?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Accepts one or several suggestions, one call each, in the order shown. Busy
  // until done: each call returns the whole list, so two at once could show a stale one.
  const accept = async (ids: string[]) => {
    setBusy(true)
    setFailure(null)
    try {
      for (const id of ids) setOfis(await acceptOfi(reference, id))
    } catch (error: unknown) {
      setFailure(error instanceof GatewayError ? error.message : 'A suggestion was not accepted.')
    }
    // Even after a failure, since the accepts before it went through.
    onAccepted?.()
    setBusy(false)
  }

  const { suggestions, accepted } = ofis
  return (
    <>
      {failure && (
        <Callout tone="danger" title="Not accepted">
          {failure}
        </Callout>
      )}
      {suggestions.length > 0 && (
        <section aria-label="Suggested Opportunities for Improvement" className="rv-ofi-group">
          <div className="rv-ofi-group-head">
            <p className="rv-muted">
              {plural(suggestions.length, 'suggestion')}, not in the report until accepted. Accept
              each one that should be in Section 3.
            </p>
            {canAccept && suggestions.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                iconLeft="check-check"
                disabled={busy}
                onClick={() => void accept(suggestions.map((o) => o.id))}
              >
                Accept all
              </Button>
            )}
          </div>
          {suggestions.map((o) => (
            <OfiBlock
              key={o.id}
              ofi={o}
              observations={observations}
              busy={busy}
              onAccept={canAccept ? () => void accept([o.id]) : undefined}
            />
          ))}
        </section>
      )}
      <section aria-label="Opportunities for Improvement in the report" className="rv-ofi-group">
        {suggestions.length > 0 && <h3 className="rv-label">In the report</h3>}
        {accepted.length === 0 ? (
          <p className="rv-muted">No Opportunities for Improvement are in the report yet.</p>
        ) : (
          OFI_CATEGORIES.flatMap((c) => accepted.filter((o) => o.category === c)).map((o) => (
            <OfiBlock key={o.id} ofi={o} number={o.number} observations={observations} />
          ))
        )}
      </section>
    </>
  )
}

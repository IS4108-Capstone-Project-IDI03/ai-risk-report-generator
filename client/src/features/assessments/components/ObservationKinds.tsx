// An observation's tags on its page (CP-36 AC3): the picker while it can be changed, else the
// badges. A choice saves at once; clearing every chip sends null. A refused save puts the chips
// back. Rendered by screens/ObservationPage.tsx and site-walk/screens/ProposalPage.tsx.
import { useState } from 'react'
import type { Kind } from '../api'
import { KindBadges } from './KindBadges'
import { KindPicker } from './KindPicker'

export function ObservationKinds({
  kinds,
  canChange,
  save,
  reference,
  text,
  blurred,
}: {
  kinds?: Kind[]
  canChange: boolean
  // Saves the tags (null clears them); true when it went through.
  save: (kinds: Kind[] | null) => Promise<boolean>
  reference?: string
  text: string
  blurred?: string
}) {
  // The choice while its save is on its way; null otherwise, so the chips follow the saved tags.
  const [pending, setPending] = useState<Kind[] | null>(null)
  const shown = pending ?? kinds ?? []
  if (!canChange)
    return (
      <section className="cpp-card" aria-label="Tags">
        <h3 className="cpp-card-title">{'Tags'}</h3>
        {kinds?.length ? (
          <KindBadges kinds={kinds} />
        ) : (
          <p className="cpp-note-text">{'None (a Fact).'}</p>
        )}
      </section>
    )
  return (
    <section className="cpp-card" aria-label="Tags">
      <KindPicker
        value={shown}
        reference={reference}
        text={text}
        blurred={blurred}
        onChange={async (next) => {
          setPending(next)
          await save(next.length ? next : null)
          // Saved: the tags now come from the observation. Refused: back to what it had.
          setPending(null)
        }}
      />
    </section>
  )
}

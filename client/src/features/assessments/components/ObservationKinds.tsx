// An observation's tags on its page (CP-36 AC3): the picker while it can be changed, else the
// tags. A choice saves at once; clearing every tag sends null. A refused save puts the tags
// back. Rendered by screens/ObservationPage.tsx and site-walk/screens/ProposalPage.tsx.
import { useState } from 'react'
import type { Kind } from '../api'
import { KindBadges } from './KindBadges'
import { KindPicker } from './KindPicker'

type Change = { kinds?: Kind[] | null; labels?: string[] | null }

export function ObservationKinds({
  kinds,
  labels,
  canChange,
  save,
  reference,
  text,
  blurred,
  withLabels = true,
}: {
  kinds?: Kind[]
  labels?: string[]
  canChange: boolean
  // Saves a change (null clears); true when it went through.
  save: (change: Change) => Promise<boolean>
  reference?: string
  text: string
  blurred?: string
  // A site walk proposal has no labels yet.
  withLabels?: boolean
}) {
  // The choice while its save is on its way; empty otherwise, so the tags follow the saved ones.
  const [pending, setPending] = useState<Change>({})
  const shownKinds = pending.kinds !== undefined ? (pending.kinds ?? []) : (kinds ?? [])
  const shownLabels = pending.labels !== undefined ? (pending.labels ?? []) : (labels ?? [])
  async function change(next: Change) {
    setPending((p) => ({ ...p, ...next }))
    await save(next)
    // Saved: the tags now come from the observation. Refused: back to what it had.
    setPending({})
  }
  if (!canChange)
    return (
      <section className="cpp-card" aria-label="Tags">
        <h3 className="cpp-card-title">{'Tags'}</h3>
        {kinds?.length || labels?.length ? (
          <KindBadges kinds={kinds} labels={labels} />
        ) : (
          <p className="cpp-note-text">{'None (a Fact).'}</p>
        )}
      </section>
    )
  return (
    <section className="cpp-card" aria-label="Tags">
      <KindPicker
        mode="saved"
        value={shownKinds}
        labels={shownLabels}
        reference={reference}
        text={text}
        blurred={blurred}
        onChange={(next) => void change({ kinds: next.length ? next : null })}
        onLabels={
          withLabels ? (next) => void change({ labels: next.length ? next : null }) : undefined
        }
      />
    </section>
  )
}

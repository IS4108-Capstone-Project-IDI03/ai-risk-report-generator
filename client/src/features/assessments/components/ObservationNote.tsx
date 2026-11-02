// An observation's note, edited in place on its page (CP-08 AC8, CP-22): the
// text box itself, saved exactly as typed when the engineer leaves it. A
// refused save keeps what was typed. Rendered by screens/ObservationPage.tsx.
import { useId, useRef, useState } from 'react'
import type { ObservationChange } from '../useAssessmentWorkflow'

export function ObservationNote({
  note,
  canChange,
  save,
  live = false,
}: {
  note: string
  canChange: boolean
  save: (change: ObservationChange) => Promise<boolean>
  // Saves on every key (a site walk proposal's page, round 5): its saves are
  // local and debounced, and without this a note typed then left by browser
  // Back is lost, since an unmounted box never blurs.
  live?: boolean
}) {
  const id = useId()
  // What is typed; follows the saved note until the engineer edits it.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? note
  // The text last sent, while its save may still be on its way: a change back
  // to the saved note must still be sent, or the pending one would win.
  const lastSent = useRef<string | null>(null)
  return (
    <section className="ob-card ob-section">
      <label htmlFor={id} className="ob-section-head">
        <span>{'Note'}</span>
      </label>
      {canChange ? (
        <textarea
          id={id}
          className="ob-note"
          rows={4}
          maxLength={5000}
          placeholder="What did you see? Write as you would for the record."
          value={text}
          onChange={(event) => {
            setDraft(event.target.value)
            if (live) void save({ note: event.target.value })
          }}
          onBlur={async () => {
            // Still being saved: keep it on screen until that save is confirmed.
            if (draft !== null && draft === lastSent.current) return
            // Back to the saved note is only "no change" when nothing else is on its way.
            if (draft === null || (draft === note && lastSent.current === null))
              return setDraft(null)
            // Kept on failure, so nothing typed is lost. Cleared only if
            // unchanged: without this, text typed while saving would vanish.
            const sent = draft
            lastSent.current = sent
            const ok = await save({ note: sent })
            if (lastSent.current === sent) lastSent.current = null
            if (ok) setDraft((d) => (d === sent ? null : d))
          }}
        />
      ) : (
        <p id={id} className="ob-transcript">
          {text || 'No note.'}
        </p>
      )}
    </section>
  )
}

// The state of the Split note panel (CP-35): asking the gateway to sort the note, the parts
// being edited, the confirmed summary, and the "note changed" rule. Called by SplitNotePanel.
// Only the confirmed parts live in the workflow (fParts); everything else stays here.
import { useEffect, useRef, useState } from 'react'
import { GatewayError, splitNote, type Part } from '../api'
import { getSettings, saveMine } from '../../settings/api'

export type SplitProblem = { problem: string; fix: string }
type Status = 'closed' | 'loading' | 'open' | 'confirmed'

// What went wrong, in two parts: the short problem and what to do. The note is never touched.
function describe(error: unknown): SplitProblem {
  const known = error instanceof GatewayError && error.status !== null
  return {
    // A 502 reads as null here (api.ts treats it as a proxy that is down), so say it plainly.
    problem: known ? error.message : 'The note could not be sorted just now.',
    fix: 'Your note is unchanged. Try again, or save it as it is.',
  }
}

export function useSplitNote(
  reference: string,
  note: string,
  parts: Part[] | null,
  setParts: (parts: Part[] | null) => void,
) {
  const [status, setStatus] = useState<Status>(parts ? 'confirmed' : 'closed')
  const [draft, setDraft] = useState<Part[]>(parts ?? [])
  const [error, setError] = useState<SplitProblem | null>(null)
  const [stale, setStale] = useState(false)
  // The note the parts were made from. Without this, parts for an old note could be saved.
  const basis = useRef<string | null>(parts ? note : null)

  useEffect(() => {
    if (basis.current === null || note === basis.current) return
    // Only a note still being written asks to be split again; a save clears it to ''.
    setStale(status === 'confirmed' && !!note.trim())
    basis.current = null
    setParts(null)
    setStatus('closed')
    setDraft([])
  }, [note]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError(null)
    setStale(false)
    setStatus('loading')
    try {
      const proposed = await splitNote(reference, note)
      basis.current = note
      setDraft(proposed)
      setStatus('open')
    } catch (e) {
      setError(describe(e))
      setStatus('closed')
    }
  }
  const confirm = () => {
    const kept = draft.filter((p) => p.text.trim())
    setDraft(kept)
    setParts(kept)
    setStatus('confirmed')
  }
  // Cancel goes back to the confirmed parts when editing them, else closes with the note unsplit.
  const cancel = () => {
    setError(null)
    if (parts) {
      setDraft(parts)
      setStatus('confirmed')
    } else {
      basis.current = null
      setStatus('closed')
    }
  }
  // Adds one term to the person's glossary; the gateway rejects a bad one with its own message.
  const addTerm = async (term: string, meaning: string) => {
    const mine = (await getSettings()).noteTaking.glossary
    await saveMine({ glossary: [...mine, { term, meaning }] })
  }
  return {
    status,
    draft,
    setDraft,
    error,
    stale,
    start,
    confirm,
    cancel,
    addTerm,
    edit: () => setStatus('open'),
    confirmed: parts,
  }
}

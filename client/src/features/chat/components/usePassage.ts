// Loads the passage behind an opened citation (CB-02). Used by CitationPanel.
import { useEffect, useState } from 'react'
import { fetchPassage, type Passage } from '../api'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; passage: Passage }

/** Returns the passage's load state; an unknown id (older answer) is an error, not a wait. */
export function usePassage(id?: string): State {
  const [loaded, setLoaded] = useState<{ id: string; state: State } | null>(null)
  useEffect(() => {
    if (!id) return
    const abort = new AbortController()
    fetchPassage(id, abort.signal)
      .then((passage) => setLoaded({ id, state: { status: 'ready', passage } }))
      .catch(() => !abort.signal.aborted && setLoaded({ id, state: { status: 'error' } }))
    return () => abort.abort()
  }, [id])
  if (!id) return { status: 'error' }
  // A result for the previous citation must not show under the new one.
  return loaded?.id === id ? loaded.state : { status: 'loading' }
}

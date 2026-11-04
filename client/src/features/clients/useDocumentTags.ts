// The tags a client's documents can take (CP-23): Whole client, its sites and
// its assessments, for the Tag picker and the Tag filter. Called by screens/DocumentsTab.
import { useEffect, useState } from 'react'
import type { TagOption } from '../../design-system'
import { getDocumentTags, type DocumentTag } from './api'

// A tag's value in the picker is its placement as text, so it goes back to the gateway as it came.
export const tagValue = (t: DocumentTag) => JSON.stringify(t.placement)

/** Returns the client's tags as picker options (empty until loaded). */
export function useDocumentTags(clientId: string): TagOption[] {
  const [loaded, setLoaded] = useState<{ id: string; tags: DocumentTag[] } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getDocumentTags(clientId, controller.signal).then(
      (tags) => setLoaded({ id: clientId, tags }),
      () => undefined,
    )
    return () => controller.abort()
  }, [clientId])
  return (loaded?.id === clientId ? loaded.tags : []).map((t) => ({
    value: tagValue(t),
    label: t.label,
    group: t.placement.kind,
  }))
}

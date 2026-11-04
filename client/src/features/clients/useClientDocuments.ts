// The client's documents (CP-23), for the client page. Called by ClientRecord
// and screens/DocumentsTab. Calls api.ts. A failed load is kept apart from "no documents".
import { useCallback, useEffect, useState } from 'react'
import {
  deleteClientDocument,
  getClientDocuments,
  retagClientDocument,
  uploadClientDocuments,
  type ClientDocument,
  type Placement,
} from './api'

/** Returns the client's documents (null while loading), whether the load failed, and upload, retag and remove. */
export function useClientDocuments(clientId: string) {
  const [loaded, setLoaded] = useState<{ id: string; documents: ClientDocument[] } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getClientDocuments(clientId, controller.signal).then(
      (documents) => {
        setLoaded({ id: clientId, documents })
        setFailed(null)
      },
      () => {
        if (!controller.signal.aborted) setFailed(clientId)
      },
    )
    return () => controller.abort()
  }, [clientId])

  // Deletes on the gateway, then drops the row; a failure throws to the dialog.
  const remove = useCallback(async (id: string) => {
    await deleteClientDocument(id)
    setLoaded((l) => l && { ...l, documents: l.documents.filter((d) => d.id !== id) })
  }, [])

  // Uploads, then lists the kept files first; returns what became of each file.
  const upload = useCallback(
    async (files: File[]) => {
      const results = await uploadClientDocuments(clientId, files)
      const kept = results.flatMap((r) => (r.status === 'kept' ? [r.document] : []))
      if (kept.length) setLoaded((l) => l && { ...l, documents: [...kept, ...l.documents] })
      return results
    },
    [clientId],
  )

  // Moves one document to another tag and shows it there.
  const retag = useCallback(async (id: string, placement: Placement) => {
    const updated = await retagClientDocument(id, placement)
    setLoaded((l) => l && { ...l, documents: l.documents.map((d) => (d.id === id ? updated : d)) })
  }, [])

  return {
    documents: loaded?.id === clientId ? loaded.documents : null,
    failed: failed === clientId,
    remove,
    upload,
    retag,
  }
}

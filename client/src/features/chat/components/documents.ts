// The knowledge documents a chat answer can cite, looked up once per chat screen (CB-01 AC1).
// Passages carry only a document id; title, edition and file live in the knowledge base list.
import { createContext, useContext, useEffect, useState } from 'react'
import { listIngestedDocuments, type KnowledgeDocument } from '../../knowledge-base/api'

/** What a citation shows about its document. */
export type DocSummary = {
  title: string
  kind: 'standard' | 'report'
  edition?: string | null
  date?: string | null
  fileUrl: string
  withdrawn: boolean
  // Set when this edition has a later one in the knowledge base (CB-02 AC4).
  newerEdition?: KnowledgeDocument['newerEdition']
}

export const DocumentsContext = createContext<Map<string, DocSummary>>(new Map())

function summaryOf(d: KnowledgeDocument): DocSummary {
  const report = d.sourceType === 'marsh_report'
  const standard = `${d.issuingBody ?? ''} ${d.standardNumber ?? ''}`.trim()
  return {
    title: report ? d.title : standard || d.title,
    kind: report ? 'report' : 'standard',
    edition: d.edition,
    date: d.effectiveDate,
    fileUrl: d.fileUrl,
    withdrawn: Boolean(d.withdrawn),
    newerEdition: d.newerEdition,
  }
}

/** Returns "NFPA 13 (2022)" or "Office report (2026-03-05)": a document as citations name it. */
export function documentLabel(doc: DocSummary): string {
  const when = doc.kind === 'report' ? doc.date : doc.edition
  return when ? `${doc.title} (${when})` : doc.title
}

/** Returns a map of document id → summary, empty until the list has loaded. */
export function useDocumentMap(): Map<string, DocSummary> {
  const [docs, setDocs] = useState(new Map<string, DocSummary>())
  useEffect(() => {
    const abort = new AbortController()
    listIngestedDocuments(abort.signal)
      .then((list) => setDocs(new Map(list.map((d) => [d.id, summaryOf(d)]))))
      // Without the list a citation still shows its page and quoted words, so a failed load is not fatal.
      .catch(() => {})
    return () => abort.abort()
  }, [])
  return docs
}

/** Returns one document's summary, or undefined if unknown. */
export function useDocument(documentId?: string): DocSummary | undefined {
  return useContext(DocumentsContext).get(documentId ?? '')
}

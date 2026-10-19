import { createContext } from 'react'
import type { AcceptedOfi } from '../api'

// What the document's locked parts show (LockedBlockView), and the way to
// change them.
export type DocumentParts = {
  reference: string
  purposeAndScope: (string | string[])[] | null
  ofis: AcceptedOfi[]
  // Leaves the document for the review workspace, on this section.
  onOpen: (sectionId: string) => void
}
export const DocumentPartsContext = createContext<DocumentParts | null>(null)

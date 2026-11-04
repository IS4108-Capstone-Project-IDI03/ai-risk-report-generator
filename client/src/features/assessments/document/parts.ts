import { createContext } from 'react'
import type { AcceptedOfi, SavedObservation } from '../api'

// What the document's locked parts show (LockedBlockView), and the way to
// change them.
export type DocumentParts = {
  reference: string
  purposeAndScope: (string | string[])[] | null
  ofis: AcceptedOfi[]
  // The assessment's observations, for the photos in Section 3's OFI records.
  observations: SavedObservation[]
  // Whether the document is in Marsh's page layout (RV-12): the parts then
  // read as the report has them.
  pageLayout: boolean
  // Leaves the document for the review workspace, on this section.
  onOpen: (sectionId: string) => void
}
export const DocumentPartsContext = createContext<DocumentParts | null>(null)

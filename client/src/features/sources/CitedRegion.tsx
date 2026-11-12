// Where a cited passage's region of the original page goes (KB-02): in the chat's Passage tab
// (PassageDetails) and the review workspace's source panel (SourcePanel). pdf.js downloads only
// when a passage has a region; one that can't be drawn leaves nothing, with no note (AC4).
import { lazy, Suspense } from 'react'
import type { Passage } from '../chat/api'
import { PdfErrorBoundary } from '../chat/components/PdfErrorBoundary'

const SourceRegion = lazy(() => import('./SourceRegion').then((m) => ({ default: m.SourceRegion })))

type Props = { fileUrl: string; region: Passage['region'] }

/** The region of the original file, or nothing when the passage records none. */
export function CitedRegion({ fileUrl, region }: Props) {
  if (!region) return null
  return (
    <PdfErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <SourceRegion fileUrl={fileUrl} kind={region.kind} boxes={region.boxes} />
      </Suspense>
    </PdfErrorBoundary>
  )
}

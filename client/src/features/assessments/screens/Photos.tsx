// All Photos (CP-04 AC3, CP-22): every photo saved with this assessment's
// observations except a deleted observation's, as a table with a thumbnail per
// row. The report's photo appendix (EX-01) draws on the same photos.
// Opened from the location navigator; rendered by AssessmentApp.
import { useState } from 'react'
import { EmptyState } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { plural } from '../reviewDisplay'
import { PhotoTable } from '../components/PhotoTable'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../observations.css'

export function Photos({ v }: { v: AssessmentWorkflow }) {
  const photos = v.photoCollection
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  return (
    <div className="ob">
      <ScreenHeader title="All Photos" back="Observations" onBack={v.goObservations} />
      {photos.length === 0 ? (
        <EmptyState
          icon="image"
          title="No photos yet"
          description="Photos appear here once they are saved with an observation."
        />
      ) : (
        <PhotoTable
          label="Site photographs"
          rows={photos}
          count={`${plural(photos.length, 'photo')} across ${plural(new Set(photos.map((p) => p.where)).size, 'location')}`}
          onOpen={(r) => setViewing({ name: r.name, url: r.url, context: r.where })}
        />
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

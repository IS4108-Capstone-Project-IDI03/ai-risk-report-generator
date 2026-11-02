// All Handwritten Pages (CP-19, CP-22): every page saved with this assessment's
// observations except a deleted observation's, as a table with a thumbnail per
// row. A page's transcript is read on its observation's page, which the
// observation's text opens. Opened from the location navigator; rendered by AssessmentApp.
import { useState } from 'react'
import { EmptyState, IconRegistry } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { plural } from '../reviewDisplay'
import { PhotoTable } from '../components/PhotoTable'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../observations.css'

export function Scans({ v }: { v: AssessmentWorkflow }) {
  const scans = v.scanCollection
  const [viewing, setViewing] = useState<ViewedPhoto | null>(null)
  return (
    <div className="ob">
      <ScreenHeader title="All Handwritten Pages" back="Observations" onBack={v.goObservations} />
      {scans.length === 0 ? (
        <EmptyState
          icon={IconRegistry.evidence.handwriting}
          title="No handwritten pages yet"
          description="Pages appear here once they are saved with an observation in Scan mode."
        />
      ) : (
        <PhotoTable
          label="Handwritten pages"
          rows={scans.map((s) => ({ ...s, name: s.page.name, url: s.page.url }))}
          // The count, and where a page's transcript is read.
          count={`${plural(scans.length, 'page')} · open its observation to read the transcript`}
          onOpen={(r) => setViewing({ name: r.name, url: r.url, context: r.where })}
        />
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

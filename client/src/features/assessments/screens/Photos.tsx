// All Photos (CP-04 AC3, CP-22): every photo saved with this assessment's
// observations except a deleted observation's, as a table with a thumbnail per
// row. Each photo's line opens the AI's description of its observation's
// photos, once written, saying which of them it describes (CP-12's line, no
// points of its own). The report's photo appendix (EX-01) draws on the same
// photos. Opened from the location navigator; rendered by AssessmentApp.
import { useState } from 'react'
import { EmptyState, Icon } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { plural } from '../reviewDisplay'
import { PhotoTable } from '../components/PhotoTable'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../observations.css'

type Described = {
  text: string
  outOfDate: boolean
  thisOne: boolean
  others: number
}

// Which photos the description covers, as one sentence, and whether they
// changed since, in the observation page's words.
function covers(d: Described) {
  const which = !d.thisOne
    ? 'Written before this photo was added.'
    : d.others === 0
      ? 'Describes this photo.'
      : `Describes this photo and ${plural(d.others, 'other')}.`
  return d.outOfDate ? which + ' Its evidence changed since.' : which
}

// The AI's description, marked as the AI's, as on the observation's page.
function description(d: Described) {
  return (
    <>
      <p className="ob-pt-note">
        <Icon name="sparkles" size={13} color="var(--ai-fg)" />
        {covers(d)}
      </p>
      <p className="ob-pt-ai">{d.text}</p>
    </>
  )
}

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
          rows={photos.map((p) => ({
            ...p,
            item: {
              detail: p.description && {
                label: 'Description',
                body: description(p.description),
              },
            },
          }))}
          count={`${plural(photos.length, 'photo')} across ${plural(new Set(photos.map((p) => p.where)).size, 'location')}`}
          onOpen={(r) => setViewing({ name: r.name, url: r.url, context: r.where })}
        />
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

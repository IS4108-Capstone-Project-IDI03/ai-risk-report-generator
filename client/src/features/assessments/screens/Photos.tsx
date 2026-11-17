// All Photos (CP-04 AC3, CP-22): every photo saved with this assessment's
// observations except a deleted observation's, as a table with a thumbnail per
// row. Each photo's line opens the AI's description of its observation's
// photos, once written, saying which of them it describes (CP-12's line,
// counted in CP-13). A search finds a photo by its description, only where
// it describes that photo, its name or its observation's text, and filters
// them by location, category, severity and description (CP-13). The
// report's photo appendix (EX-01) draws on the same photos. Opened from the
// location navigator; rendered by AssessmentApp.
import { useState } from 'react'
import { EmptyState, Icon } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { HitText } from '../components/HitText'
import { evidenceMenus, matchesEvidence, PHOTO_FILTER } from '../evidenceFilters'
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

// The AI's description, marked as the AI's, as on the observation's page,
// with a search's words marked where it describes this photo.
function description(d: Described, words: readonly string[]) {
  return (
    <>
      <p className="ob-pt-note">
        <Icon name="sparkles" size={13} color="var(--ai-fg)" />
        {covers(d)}
      </p>
      <p className="ob-pt-ai">
        <HitText text={d.text} words={d.thisOne ? words : []} />
      </p>
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
                body: (words: readonly string[]) => description(p.description!, words),
              },
              // A description written before this photo was added says nothing of it.
              searchText: p.description?.thisOne ? p.description.text : null,
            },
          }))}
          count={`${plural(photos.length, 'photo')} across ${plural(new Set(photos.map((p) => p.where)).size, 'location')}`}
          search={{
            query: v.evidenceQuery,
            onQuery: v.setEvidenceQuery,
            noun: 'photo',
            label: 'Search photos',
          }}
          filters={{
            menus: evidenceMenus(v, photos, PHOTO_FILTER),
            values: v.evidenceFilters,
            onChoose: v.setEvidenceFilter,
            onClear: v.clearEvidenceFilters,
            matches: matchesEvidence,
          }}
          onOpen={(r) => setViewing({ name: r.name, url: r.url, context: r.where })}
        />
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

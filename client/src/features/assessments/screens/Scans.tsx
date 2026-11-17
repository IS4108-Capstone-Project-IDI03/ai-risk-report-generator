// All Handwritten Pages (CP-19, CP-22): every page saved with this assessment's
// observations except a deleted observation's, as a table with a thumbnail per
// row. Each page's line says where its transcription stands, with Retry, and
// opens its transcript as the observation's page shows it (CP-12's line,
// counted in CP-13); correcting it is done there, which the observation's
// text opens. A search finds a page by its text as shown (the correction, or
// else the model's reading), its name or its observation's text, and filters
// them by location, category, severity and status (CP-13).
// Opened from the location navigator; rendered by AssessmentApp.
import { useState } from 'react'
import { EmptyState, IconRegistry } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { evidenceMenus, matchesEvidence, PAGE_FILTER } from '../evidenceFilters'
import { hitRanges } from '../evidenceSearch'
import { plural } from '../reviewDisplay'
import { HitText } from '../components/HitText'
import { PhotoTable } from '../components/PhotoTable'
import { PageTranscript } from '../components/PageTranscript'
import type { PageView } from '../components/PageEntry'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../observations.css'

// Whether a page has finished text to show: transcribed, or written by hand
// in the demo.
const finished = (p: PageView) =>
  p.status === 'transcribed' || (p.status === null && !!p.correction)

// A finished page's text as the observation's page shows it: the engineer's
// correction plainly, else the model's reading behind the AI rule with its
// unsure words marked; a search's words marked in either.
function pageText(p: PageView, words: readonly string[]) {
  if (p.correction)
    return (
      <p className="ob-transcript">
        <HitText text={p.transcript ?? ''} words={words} />
      </p>
    )
  if (!p.transcript?.trim())
    return <p className="ob-pt-note">No handwriting was found on this page.</p>
  return (
    <PageTranscript
      text={p.transcript}
      uncertain={p.uncertain}
      hits={hitRanges(p.transcript, words)}
    />
  )
}

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
          rows={scans.map((s) => ({
            ...s,
            name: s.page.name,
            url: s.page.url,
            item: {
              status: s.page.status,
              retry: s.page.retry,
              detail: finished(s.page)
                ? {
                    label: 'Transcript',
                    body: (words: readonly string[]) => pageText(s.page, words),
                  }
                : null,
              searchText: finished(s.page) ? s.page.transcript : null,
            },
          }))}
          count={plural(scans.length, 'page')}
          search={{
            query: v.evidenceQuery,
            onQuery: v.setEvidenceQuery,
            noun: 'page',
            label: 'Search pages',
          }}
          filters={{
            menus: evidenceMenus(v, scans, PAGE_FILTER),
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

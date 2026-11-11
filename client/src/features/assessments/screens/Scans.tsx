// All Handwritten Pages (CP-19, CP-22): every page saved with this assessment's
// observations except a deleted observation's, as a table with a thumbnail per
// row. Each page's line says where its transcription stands, with Retry, and
// opens its transcript as the observation's page shows it (CP-12's line, no
// points of its own); correcting it is done there, which the observation's
// text opens. Opened from the location navigator; rendered by AssessmentApp.
import { useState } from 'react'
import { EmptyState, IconRegistry } from '../../../design-system'
import { ScreenHeader } from '../components/ScreenHeader'
import { plural } from '../reviewDisplay'
import { PhotoTable } from '../components/PhotoTable'
import { PageTranscript } from '../components/PageTranscript'
import type { PageView } from '../components/PageEntry'
import { PhotoDialog, type ViewedPhoto } from '../components/PhotoReferences'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import '../observations.css'

// A finished page's text as the observation's page shows it: the engineer's
// correction plainly, else the model's reading behind the AI rule with its
// unsure words marked. Null while there is none to show.
function pageText(p: PageView) {
  if (p.status !== 'transcribed' && !(p.status === null && p.correction)) return null
  if (p.correction) return <p className="ob-transcript">{p.transcript}</p>
  if (!p.transcript?.trim())
    return <p className="ob-pt-note">No handwriting was found on this page.</p>
  return <PageTranscript text={p.transcript} uncertain={p.uncertain} />
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
          rows={scans.map((s) => {
            const text = pageText(s.page)
            return {
              ...s,
              name: s.page.name,
              url: s.page.url,
              item: {
                status: s.page.status,
                retry: s.page.retry,
                detail: text && { label: 'Transcript', body: text },
              },
            }
          })}
          count={plural(scans.length, 'page')}
          onOpen={(r) => setViewing({ name: r.name, url: r.url, context: r.where })}
        />
      )}
      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

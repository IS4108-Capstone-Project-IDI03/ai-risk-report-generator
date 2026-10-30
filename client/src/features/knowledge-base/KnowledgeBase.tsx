// The Knowledge base screen, as three tabs: Documents (the knowledge base
// itself, KB-01, in KnowledgeDocuments.tsx), Add documents (IN-01, in
// AddDocuments.tsx) and Requests (CB-07, in Requests.tsx). At /admin/knowledge-base/review/<id> it shows one
// document's Review page instead (IN-07, ReviewDocument.tsx). Shown by
// AssessmentApp.tsx.
import { useEffect, useState } from 'react'
import { Tabs } from '../../design-system'
import { KNOWLEDGE_REVIEW_PATH, reviewIdForPath, SCREEN_PATHS } from '../auth/access'
import { listIngestedDocuments, listKnowledgeRequests } from './api'
import { knowledgeTab } from './openTab'
import { needsReview } from './display'
import { AddDocuments } from './screens/AddDocuments'
import { KnowledgeDocuments, type Filters } from './screens/KnowledgeDocuments'
import { Requests } from './screens/Requests'
import { ReviewDocument } from './screens/ReviewDocument'
import './knowledge-base.css'

export function KnowledgeBase({
  narrow,
  notify,
}: {
  narrow: boolean
  // Shows a toast, e.g. to confirm a saved correction.
  notify: (message: string) => void
}) {
  const [tab, setTab] = useState(knowledgeTab.current)
  // How many documents in the knowledge base need review (IN-05), for the
  // Documents tab's count. The Documents tab reports it after loads and saves;
  // on Add documents it is re-read whenever an upload finishes.
  const [needReview, setNeedReview] = useState(0)
  // How many knowledge requests are open (CB-07), for the Requests tab's count.
  const [openRequests, setOpenRequests] = useState(0)
  const [visit, setVisit] = useState(0)
  const [completed, setCompleted] = useState(0)
  // Decisions made on a Review page change the count too (IN-07).
  const [decided, setDecided] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    // A failed read keeps the last count; the Documents tab shows the error.
    listIngestedDocuments(controller.signal).then(
      (list) => setNeedReview(list.filter(needsReview).length),
      () => undefined,
    )
    return () => controller.abort()
  }, [completed, decided])
  useEffect(() => {
    const controller = new AbortController()
    listKnowledgeRequests(controller.signal).then(
      (list) => setOpenRequests(list.length),
      () => undefined,
    )
    return () => controller.abort()
  }, [])
  // Which document's Review page is open, if any. It follows the URL, so the
  // page can be linked to, reloaded, and left with the browser's Back.
  const [reviewId, setReviewId] = useState(() => reviewIdForPath(window.location.pathname))
  useEffect(() => {
    const follow = () => {
      setReviewId(reviewIdForPath(window.location.pathname))
      // A tab chosen from elsewhere (openKnowledgeTab) shows on arrival.
      setTab(knowledgeTab.current)
      // A new visit re-reads which request to highlight, even if Requests is already open.
      setVisit((v) => v + 1)
    }
    window.addEventListener('popstate', follow)
    return () => window.removeEventListener('popstate', follow)
  }, [])
  // The list's filters ride along in the history entries, so coming back from
  // a Review page finds the list as it was left.
  const openReview = (id: string, filters: Filters) => {
    window.history.replaceState({ kbFilters: filters }, '')
    window.history.pushState(
      { kbFilters: filters },
      '',
      KNOWLEDGE_REVIEW_PATH + encodeURIComponent(id),
    )
    setReviewId(id)
  }
  // Goes back to the list. When the previous history entry is the list (the
  // page was opened from it), step back so the browser's Back does not reopen
  // a Review URL that may be dead; the popstate listener shows the list.
  // `then` runs once the list is back, e.g. to show a toast.
  const closeReview = (then?: () => void) => {
    if (window.history.state?.kbFilters) {
      // The app clears any toast on popstate, so one shown now would vanish:
      // wait for the step back to land first. Listeners run in the order they
      // were added, so this runs after the app's.
      if (then) window.addEventListener('popstate', then, { once: true })
      window.history.back()
      return
    }
    window.history.pushState(window.history.state, '', SCREEN_PATHS.knowledge)
    setReviewId(null)
    then?.()
  }
  const open = (value: string) => {
    knowledgeTab.current = value
    setTab(value)
  }
  if (reviewId) {
    return (
      <div className="kb">
        <ReviewDocument
          key={reviewId}
          id={reviewId}
          onBack={() => closeReview()}
          onDecided={(message) => {
            setDecided((n) => n + 1)
            closeReview(() => notify(message))
          }}
        />
      </div>
    )
  }
  return (
    <div className="kb">
      <Tabs
        items={[
          {
            value: 'documents',
            label: 'Documents',
            count: needReview || undefined,
            alert: needReview
              ? `${needReview} ${needReview === 1 ? 'needs' : 'need'} review`
              : undefined,
          },
          { value: 'add', label: 'Add documents' },
          {
            value: 'requests',
            label: 'Requests',
            count: openRequests || undefined,
            // The same amber pill as Documents' review count: open requests are a to-do list.
            alert: openRequests ? `${openRequests} open` : undefined,
          },
        ]}
        value={tab}
        onChange={open}
      />
      {tab === 'documents' ? (
        <KnowledgeDocuments
          notify={notify}
          onAdd={() => open('add')}
          onNeedReview={setNeedReview}
          onReview={openReview}
        />
      ) : tab === 'requests' ? (
        <Requests key={visit} notify={notify} onCount={setOpenRequests} />
      ) : (
        <AddDocuments
          narrow={narrow}
          onCompleted={setCompleted}
          // From Add documents the list has no filters to keep.
          onReview={(id) =>
            openReview(id, { title: '', jurisdiction: '', facilityType: '', status: '' })
          }
        />
      )}
    </div>
  )
}

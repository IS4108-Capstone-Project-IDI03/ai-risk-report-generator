// The Knowledge base screen, as two tabs: Documents (the knowledge base
// itself, KB-01, in KnowledgeDocuments.tsx) and Add documents (IN-01, in
// AddDocuments.tsx). Shown by AssessmentApp.tsx.
import { useEffect, useState } from 'react'
import { Tabs } from '../../design-system'
import { listIngestedDocuments } from './api'
import { needsReview } from './display'
import { AddDocuments } from './screens/AddDocuments'
import { KnowledgeDocuments } from './screens/KnowledgeDocuments'
import './knowledge-base.css'

// Kept outside React so coming back to the screen reopens the tab you left,
// e.g. to see how an upload went (a module variable outlives the screen).
let lastTab = 'documents'

export function KnowledgeBase({
  narrow,
  notify,
}: {
  narrow: boolean
  // Shows a toast, e.g. to confirm a saved correction.
  notify: (message: string) => void
}) {
  const [tab, setTab] = useState(lastTab)
  // How many documents in the knowledge base need review (IN-05), for the
  // Documents tab's count. The Documents tab reports it after loads and saves;
  // on Add documents it is re-read whenever an upload finishes.
  const [needReview, setNeedReview] = useState(0)
  const [completed, setCompleted] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    // A failed read keeps the last count; the Documents tab shows the error.
    listIngestedDocuments(controller.signal).then(
      (list) => setNeedReview(list.filter(needsReview).length),
      () => undefined,
    )
    return () => controller.abort()
  }, [completed])
  const open = (value: string) => {
    lastTab = value
    setTab(value)
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
        ]}
        value={tab}
        onChange={open}
      />
      {tab === 'documents' ? (
        <KnowledgeDocuments
          notify={notify}
          onAdd={() => open('add')}
          onNeedReview={setNeedReview}
        />
      ) : (
        <AddDocuments narrow={narrow} onCompleted={setCompleted} />
      )}
    </div>
  )
}

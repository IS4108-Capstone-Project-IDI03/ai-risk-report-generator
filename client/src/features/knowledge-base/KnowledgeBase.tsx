// The Knowledge base screen, as two tabs: Documents (the knowledge base
// itself, KB-01, in KnowledgeDocuments.tsx) and Add documents (IN-01, in
// AddDocuments.tsx). Shown by AssessmentApp.tsx.
import { useState } from 'react'
import { Tabs } from '../../design-system'
import { AddDocuments } from './screens/AddDocuments'
import { KnowledgeDocuments } from './screens/KnowledgeDocuments'
import './knowledge-base.css'

const TABS = [
  { value: 'documents', label: 'Documents' },
  { value: 'add', label: 'Add documents' },
]
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
  const open = (value: string) => {
    lastTab = value
    setTab(value)
  }
  return (
    <div className="kb">
      <Tabs items={TABS} value={tab} onChange={open} />
      {tab === 'documents' ? (
        <KnowledgeDocuments notify={notify} onAdd={() => open('add')} />
      ) : (
        <AddDocuments narrow={narrow} />
      )}
    </div>
  )
}

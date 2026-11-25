// The Usage and costs screen (EV-04). Shown by features/assessments/AssessmentApp.tsx,
// loaded on first open (it brings the chart library). Opens on the
// report-generation overview; choosing an assessment opens its drill-in. A
// knowledge admin also has the Documents tab: what reading each knowledge
// document cost, each document opening its own detail page.
// Draws its own top bar (title, helper line, tabs, bell), like every page.
import { useState, type ReactNode } from 'react'
import { Tabs } from '../../../design-system'
import type { DocumentUsage, OverviewGroup } from '../api'
import { UsageHeader } from '../components/UsageHeader'
import '../usage.css'
import { AssessmentUsageDetail } from './AssessmentUsageDetail'
import { ChatUsageDetail } from './ChatUsageDetail'
import { DocumentUsageDetail } from './DocumentUsageDetail'
import { IngestionUsageTab } from './IngestionUsageTab'
import { ReportUsageOverview } from './ReportUsageOverview'

type Tab = 'reports' | 'ingestion'

export function UsageCosts({ isAdmin, bell }: { isAdmin: boolean; bell?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('reports')
  const [assessment, setAssessment] = useState<OverviewGroup | null>(null)
  const [document, setDocument] = useState<DocumentUsage | null>(null)
  // The chatbot's page is open.
  const [chat, setChat] = useState(false)
  if (assessment)
    return (
      <AssessmentUsageDetail
        assessment={assessment}
        onBack={() => setAssessment(null)}
        bell={bell}
      />
    )
  if (chat) return <ChatUsageDetail onBack={() => setChat(false)} bell={bell} />
  if (document)
    return <DocumentUsageDetail document={document} onBack={() => setDocument(null)} bell={bell} />
  return (
    <>
      <UsageHeader
        title="Usage and Costs"
        helper="What the AI calls cost, how much they were used, and how fast they ran."
        bell={bell}
        tabs={
          isAdmin ? (
            <Tabs
              value={tab}
              onChange={(v) => setTab(v as Tab)}
              items={[
                // Words only, like the Knowledge base's and the client page's tabs.
                { value: 'reports', label: 'Report generation' },
                { value: 'ingestion', label: 'Documents', walk: 'usage.tab.ingestion' },
              ]}
            />
          ) : undefined
        }
      />
      {!isAdmin || tab === 'reports' ? (
        <ReportUsageOverview
          isAdmin={isAdmin}
          onOpen={setAssessment}
          onOpenChat={() => setChat(true)}
        />
      ) : (
        <IngestionUsageTab onOpen={setDocument} />
      )}
    </>
  )
}

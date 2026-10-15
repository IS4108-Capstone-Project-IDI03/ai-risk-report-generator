// The Usage and costs screen (EV-04). Shown by features/assessments/AssessmentApp.tsx,
// loaded on first open (it brings the chart library). Opens on the
// report-generation overview; choosing an assessment opens its drill-in. A
// knowledge admin also has the Ingestion tab: what reading each knowledge
// document cost.
import { useState } from 'react'
import { IconRegistry, Tabs } from '../../../design-system'
import type { OverviewGroup } from '../api'
import '../usage.css'
import { AssessmentUsageDetail } from './AssessmentUsageDetail'
import { IngestionUsageTab } from './IngestionUsageTab'
import { ReportUsageOverview } from './ReportUsageOverview'

type Tab = 'reports' | 'ingestion'

export function UsageCosts({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>('reports')
  const [assessment, setAssessment] = useState<OverviewGroup | null>(null)
  if (assessment)
    return <AssessmentUsageDetail assessment={assessment} onBack={() => setAssessment(null)} />
  if (!isAdmin) return <ReportUsageOverview isAdmin={false} onOpen={setAssessment} />
  return (
    <div className="uc-tabs">
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={[
          { value: 'reports', label: 'Report generation', icon: IconRegistry.object.report },
          // The knowledge base's own navigation icon.
          { value: 'ingestion', label: 'Ingestion', icon: 'library' },
        ]}
      />
      {tab === 'reports' ? (
        <ReportUsageOverview isAdmin onOpen={setAssessment} />
      ) : (
        <IngestionUsageTab />
      )}
    </div>
  )
}

// The Usage and costs screen (EV-04). Shown by features/assessments/AssessmentApp.tsx,
// loaded on first open (it brings the chart library). Opens on the
// report-generation overview; choosing an assessment opens its drill-in.
import { useState } from 'react'
import type { OverviewGroup } from '../api'
import '../usage.css'
import { AssessmentUsageDetail } from './AssessmentUsageDetail'
import { ReportUsageOverview } from './ReportUsageOverview'

export function UsageCosts({ isAdmin }: { isAdmin: boolean }) {
  const [assessment, setAssessment] = useState<OverviewGroup | null>(null)
  if (assessment)
    return <AssessmentUsageDetail assessment={assessment} onBack={() => setAssessment(null)} />
  return <ReportUsageOverview isAdmin={isAdmin} onOpen={setAssessment} />
}

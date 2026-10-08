// The report picker at the top of Usage and costs (EV-04, AC2). Changing it
// reloads the whole page for that report. Used by screens/UsageCosts.tsx.
import { Select } from '../../../design-system'

export function ReportSelect({
  reports,
  value,
  isAdmin,
  onChange,
}: {
  reports: string[]
  value: string
  isAdmin: boolean
  onChange: (reportId: string) => void
}) {
  const all = isAdmin ? 'All reports' : 'All my reports'
  return (
    <Select
      label="Report"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: '', label: all }, ...reports.map((r) => ({ value: r, label: r }))]}
    />
  )
}

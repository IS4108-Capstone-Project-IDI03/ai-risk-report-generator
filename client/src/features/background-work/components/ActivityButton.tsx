// The header's activity icon (F-11), beside the bell: shown only while the
// user has work queued, running, failed or waiting on them. It carries no
// count badge, since red counts are the Inbox's and the bell's (design
// system); its name says how many. Placed by AssessmentApp next to each bell.
import { IconButton } from '../../../design-system'
import { useBackgroundWork } from '../useBackgroundWork'
import { activityLabel } from '../words'
import '../background-work.css'

export function ActivityButton({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { rows } = useBackgroundWork()
  if (!rows.length) return null
  const working = rows.some((r) => r.state === 'running' || r.state === 'queued')
  const failed = rows.some((r) => r.state === 'failed')
  return (
    <IconButton
      icon="activity"
      label={activityLabel(rows)}
      size="lg"
      className={[
        'activity-button',
        `activity-button--${tone}`,
        working && 'activity-button--working',
        failed && 'activity-button--failed',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

// The header's activity icon (F-11), beside the bell: shown only while the
// user has work queued, running, failed or waiting on them. It carries no
// count badge, since red counts are the Inbox's and the bell's (design
// system); its name says how many. It opens the list of that work, as the
// bell opens its own. Placed by AssessmentApp next to each bell.
import { useState } from 'react'
import { IconButton, Popover } from '../../../design-system'
import { useBackgroundWork } from '../useBackgroundWork'
import { activityLabel } from '../words'
import { BackgroundWorkList } from './BackgroundWorkList'
import '../background-work.css'

export function ActivityButton({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState(false)
  const { rows } = useBackgroundWork()
  if (!rows.length) return null
  const working = rows.some((r) => r.state === 'running' || r.state === 'queued')
  const failed = rows.some((r) => r.state === 'failed')
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Background work"
      align="right"
      surfaceClassName="notification-popover-surface"
      sheetCancel
      sheetClassName="notif-sheet"
      trigger={
        <IconButton
          icon="activity"
          label={activityLabel(rows)}
          size="lg"
          selected={open}
          onClick={() => setOpen(!open)}
          className={[
            'activity-button',
            `activity-button--${tone}`,
            working && 'activity-button--working',
            failed && 'activity-button--failed',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      }
    >
      <BackgroundWorkList rows={rows} />
    </Popover>
  )
}

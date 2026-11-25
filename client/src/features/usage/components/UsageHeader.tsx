// The usage screens' top bar (EV-04): the app's one page header, with Back on a detail page
// and the admin's tabs. Used by screens/UsageCosts.tsx and the three detail screens.
// The eyebrow hides on a phone, as on the Inbox and the client page.
import type { ReactNode } from 'react'
import { TopBar, useIsPhone } from '../../../design-system'

export function UsageHeader({
  title,
  helper,
  eyebrow = 'Reporting',
  back,
  action,
  tabs,
  bell,
}: {
  title: string
  helper?: string
  eyebrow?: string
  back?: { label: string; onClick: () => void }
  action?: ReactNode
  tabs?: ReactNode
  bell?: ReactNode
}) {
  const phone = useIsPhone()
  return (
    <TopBar
      eyebrow={phone ? undefined : eyebrow}
      title={title}
      helper={helper}
      back={back}
      action={action}
      tabs={tabs}
      bell={bell}
      // On a phone the title takes its own row and Export wraps under it.
      stack={!!action}
    />
  )
}

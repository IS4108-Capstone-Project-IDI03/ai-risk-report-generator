// The User accounts top bar (F-03, F-08): the app's one page header. Called by UserAccounts.tsx.
// The eyebrow hides on a phone.
import type { ReactNode } from 'react'
import { TopBar, useIsPhone } from '../../../design-system'

export function AccountsHeader({
  title,
  helper,
  action,
  bell,
}: {
  title: string
  helper?: string
  action?: ReactNode
  bell?: ReactNode
}) {
  const phone = useIsPhone()
  return (
    <TopBar
      eyebrow={phone ? undefined : 'Administration'}
      title={title}
      helper={helper}
      action={action}
      bell={bell}
    />
  )
}

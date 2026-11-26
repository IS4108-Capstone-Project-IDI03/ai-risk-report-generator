// The User accounts top bar (F-03, F-08): the app's one page header, with Back inside a profile
// or the new-account form. Called by every screen in screens/. The eyebrow hides on a phone.
import type { ReactNode } from 'react'
import { TopBar, useIsPhone } from '../../../design-system'

export function AccountsHeader({
  title,
  helper,
  back,
  lead,
  action,
  bell,
  stack,
}: {
  title: string
  helper?: string
  back?: { label: string; onClick: () => void }
  // Before the title, e.g. a person's initials.
  lead?: ReactNode
  action?: ReactNode
  bell?: ReactNode
  // On a phone the action wraps under the title (TopBar `stack`), so a long name keeps its line.
  stack?: boolean
}) {
  const phone = useIsPhone()
  return (
    <TopBar
      eyebrow={phone ? undefined : 'Administration'}
      title={title}
      helper={helper}
      back={back}
      lead={lead}
      action={action}
      bell={bell}
      stack={stack}
    />
  )
}

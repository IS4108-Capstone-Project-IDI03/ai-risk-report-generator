// For an account whose owner has not set a password yet (F-08): when their invitation link
// expires, and what came of emailing them a new one. The Resend invitation button itself sits in
// the account panel's footer with its other actions (useResendInvitation.ts).
// Called by components/AccountPanel.tsx.
import { useState } from 'react'
import { Callout } from '../../../design-system'
import type { UserAccount } from '../api'
import { formatWhen } from '../accountFormat'
import type { ResendResult } from './useResendInvitation'

/** Returns the invitation's status note and the last resend's result. */
export function InvitationNote({ user, result }: { user: UserAccount; result: ResendResult }) {
  // Read once, as the profile opens: whether the link has lapsed only needs
  // to be right when the admin looks.
  const [openedAt] = useState(() => Date.now())

  const expiresAt = user.invitationExpiresAt
  const linkOpen = expiresAt !== null && Date.parse(expiresAt) > openedAt
  const status = !user.active
    ? 'Reactivate the account to send them an invitation.'
    : expiresAt === null
      ? 'No invitation link is open. Send one so they can set a password.'
      : linkOpen
        ? `The link in their invitation email works until ${formatWhen(expiresAt)}.`
        : `Their invitation link expired on ${formatWhen(expiresAt)}. Send a new one so they can set a password.`

  return (
    <>
      <div className="accounts-body-note">
        <Callout
          tone={linkOpen || !user.active ? 'info' : 'warning'}
          title="They have not set a password yet"
        >
          {status}
        </Callout>
      </div>
      {result && (
        <div role={result.tone === 'danger' ? 'alert' : 'status'} className="accounts-body-note">
          <Callout
            tone={result.tone}
            title={result.tone === 'danger' ? 'Invitation not sent' : 'Invitation sent'}
          >
            {result.text}
          </Callout>
        </div>
      )}
    </>
  )
}

// For an account whose owner has not set a password yet (F-08): when their invitation link
// expires, and a way to email them a new one, e.g. after it expired or never arrived. A new link
// cancels the earlier one. Called by screens/AccountProfile.tsx.
import { useState } from 'react'
import { Button, Callout } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { resendInvitation, type UserAccount } from '../api'
import { formatWhen, problem } from '../accountFormat'

export function InvitationNote({
  user,
  onSent,
}: {
  user: UserAccount
  onSent: (user: UserAccount) => void
}) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ tone: string; text: string } | null>(null)
  // Read once, as the profile opens: whether the link has lapsed only needs
  // to be right when the admin looks.
  const [openedAt] = useState(() => Date.now())

  async function resend() {
    if (sending) return
    setSending(true)
    setResult(null)
    try {
      const stored = await resendInvitation(user.id)
      setResult({
        tone: 'success',
        text: `A new invitation was emailed to ${stored.email}. Any earlier link no longer works.`,
      })
      onSent(stored)
    } catch (error: unknown) {
      setResult({
        tone: 'danger',
        text:
          error instanceof GatewayError && (error.status === 409 || error.status === 503)
            ? error.message
            : problem(error, 'the invitation was not sent'),
      })
    } finally {
      setSending(false)
    }
  }

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
          actions={
            user.active ? (
              <Button
                variant="secondary"
                size="sm"
                pill
                iconLeft="mail"
                disabled={sending}
                onClick={resend}
              >
                {sending ? 'Sending…' : 'Resend invitation'}
              </Button>
            ) : undefined
          }
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

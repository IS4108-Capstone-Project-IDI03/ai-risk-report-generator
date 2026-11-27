// Resending an account's invitation (F-08): emails a new link, which cancels the earlier one, and
// keeps the result for InvitationNote to show. The Resend invitation button sits in the account
// panel's footer. Used by AccountPanel.tsx. Calls resendInvitation (api.ts).
import { useState } from 'react'
import { GatewayError } from '../../assessments/api'
import { resendInvitation, type UserAccount } from '../api'
import { problem } from '../accountFormat'

export type ResendResult = { tone: string; text: string } | null

/** Returns resend() for one account's invitation, whether it is sending, and its last result. */
export function useResendInvitation(user: UserAccount | null, onSent: (user: UserAccount) => void) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<ResendResult>(null)

  async function resend() {
    if (sending || !user) return
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
  return { sending, result, resend, clear: () => setResult(null) }
}

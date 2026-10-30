import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Callout, Input } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { acceptInvitation, lookUpInvitation } from './api'
import './sign-in.css'

// The gateway applies the same rule (newPasswordSchema in
// server/src/services/invitation.service.ts); checking it here first saves a
// round trip.
const PASSWORD_RULE = 'Use at least 12 characters, including a number and a symbol.'
const meetsRule = (password: string) =>
  password.length >= 12 && /\d/.test(password) && /[^\w\s]/.test(password)

type Link =
  | { state: 'checking' }
  | { state: 'open'; name: string; email: string }
  | { state: 'closed' }
  | { state: 'unreachable' }

// A new employee sets their first password from the link in their invitation
// email (F-08). Its own screen, not the password reset: an invitation sets a
// password the account never had. onDone gets the email to sign in with.
export function SetPassword({
  token,
  onDone,
  onBack,
}: {
  token: string
  onDone: (email: string) => void
  onBack: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [link, setLink] = useState<Link>({ state: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Check the link as the screen opens, so one that no longer works says so
  // before a password is typed.
  useEffect(() => {
    const controller = new AbortController()
    lookUpInvitation(token, controller.signal).then(
      (invitation) => setLink({ state: 'open', ...invitation }),
      (failure: unknown) => {
        if (controller.signal.aborted) return
        setLink(
          failure instanceof GatewayError && failure.status === 400
            ? { state: 'closed' }
            : { state: 'unreachable' },
        )
      },
    )
    return () => controller.abort()
  }, [token, attempt])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const problems = {
      password: meetsRule(password) ? undefined : PASSWORD_RULE,
      confirm: confirm === password ? undefined : 'The passwords do not match.',
    }
    setErrors(problems)
    setError('')
    if (problems.password || problems.confirm) return
    setBusy(true)
    try {
      onDone((await acceptInvitation(token, password)).email)
    } catch (failure: unknown) {
      if (failure instanceof GatewayError && failure.fields.password) {
        setErrors({ password: failure.fields.password })
      } else if (failure instanceof GatewayError && failure.status === 400) {
        setLink({ state: 'closed' })
      } else {
        setError(
          failure instanceof GatewayError && failure.status === null
            ? 'The gateway could not be reached, so your password was not set. Try again.'
            : 'Something went wrong, so your password was not set. Try again.',
        )
      }
      setBusy(false)
    }
  }

  return (
    <main className="sign-in">
      <div className="sign-in-brand">
        <strong>Marsh</strong>
        <span>Risk Report Generator</span>
      </div>
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <header>
          <h1 id="sign-in-title">Set your password</h1>
          <p>
            {link.state === 'open'
              ? `Welcome, ${link.name}. Choose the password you will sign in with.`
              : 'Your invitation lets you choose the password you will sign in with.'}
          </p>
        </header>
        {link.state === 'checking' && (
          <p className="sign-in-status" role="status">
            Checking your invitation link…
          </p>
        )}
        {link.state === 'closed' && (
          <div role="alert">
            <Callout tone="danger" title="This invitation link no longer works">
              It may have expired, since links last 72 hours, or have been used already. Ask a
              knowledge admin to send you a new invitation.
            </Callout>
          </div>
        )}
        {link.state === 'unreachable' && (
          <div role="alert">
            <Callout
              tone="danger"
              title="Your invitation could not be checked"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLink({ state: 'checking' })
                    setAttempt((a) => a + 1)
                  }}
                >
                  Try again
                </Button>
              }
            >
              The gateway could not be reached. Check your connection, then try again.
            </Callout>
          </div>
        )}
        {link.state === 'open' && (
          <>
            {error && (
              <div role="alert">
                <Callout tone="danger" title={error} />
              </div>
            )}
            <form noValidate onSubmit={submit} className="sign-in-form">
              <Input
                label="Work email"
                type="email"
                value={link.email}
                readOnly
                autoComplete="username"
              />
              <Input
                label="New password"
                type="password"
                required
                value={password}
                error={errors.password}
                hint={PASSWORD_RULE}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                label="Confirm password"
                type="password"
                required
                value={confirm}
                error={errors.confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
                {busy ? 'Setting password…' : 'Set password'}
              </Button>
            </form>
          </>
        )}
        <p className="sign-in-switch">
          <button className="text-link" type="button" onClick={onBack}>
            Back to sign in
          </button>
        </p>
      </section>
    </main>
  )
}

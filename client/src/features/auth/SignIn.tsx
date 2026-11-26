import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Callout, Input } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { signIn as requestSignIn, requestPasswordReset, resetPassword, type Session } from './api'
import { meetsRule, PASSWORD_RULE } from './passwordRule'
import { SetPassword } from './SetPassword'
import marshLogo from '../../assets/marsh-logo.png'
import './sign-in.css'

// The Marsh logo over the product name, as the sidebar shows them, but larger.
function SignInBrand() {
  return (
    <div className="sign-in-brand">
      <img src={marshLogo} alt="Marsh" />
      <span>Risk Report Generator</span>
    </div>
  )
}

// Why a sign-in attempt failed. Wrong credentials always read the same, so the
// message never reveals whether the email has an account (F-04).
function signInProblem(error: unknown) {
  if (error instanceof GatewayError && error.status === 401) return 'Incorrect email or password.'
  if (error instanceof GatewayError && error.status === 429) return error.message
  if (error instanceof GatewayError && error.status === null)
    return "Can't reach the server, so you weren't signed in. Check your connection, then try again."
  return "Something went wrong, so you weren't signed in. Try again."
}

// The reset code in an emailed link (F-06): /?reset=<code>.
const emailedResetCode = () => new URLSearchParams(window.location.search).get('reset') ?? ''
// The code in a new employee's invitation link (F-08): /?invite=<code>.
const emailedInviteCode = () => new URLSearchParams(window.location.search).get('invite') ?? ''

export function SignIn({ onSignIn }: { onSignIn: (session: Session) => void }) {
  // A reset link opens straight at the new-password step.
  const [mode, setMode] = useState(() => (emailedResetCode() ? 'reset-confirm' : 'signin'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetToken, setResetToken] = useState(emailedResetCode)
  const [newPassword, setNewPassword] = useState('')
  const [passwordProblem, setPasswordProblem] = useState('')
  // An invitation link opens the set-password screen instead.
  const [inviteToken, setInviteToken] = useState(emailedInviteCode)
  // Remove the code from the address bar so it isn't kept in history or shared.
  useEffect(() => {
    if (emailedResetCode() || emailedInviteCode())
      window.history.replaceState(null, '', window.location.pathname)
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setNotice('')
    if (!email.trim() || !password.trim()) {
      setError('Complete the required fields before continuing.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid work email address.')
      return
    }
    setError('')
    setPassword('')
    setBusy(true)
    try {
      onSignIn(await requestSignIn(email, password))
    } catch (failure: unknown) {
      setError(signInProblem(failure))
    } finally {
      setBusy(false)
    }
  }

  async function submitResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !resetEmail.trim()) return
    setBusy(true)
    setError('')
    try {
      await requestPasswordReset(resetEmail)
      setMode('reset-confirm')
      setNotice('If that email has an account, a reset link has been sent. Check your inbox.')
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitResetConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !resetToken.trim() || !newPassword.trim()) return
    // The gateway refuses it too; checking here says why before the reset code is spent on nothing.
    if (!meetsRule(newPassword)) {
      setPasswordProblem(PASSWORD_RULE)
      return
    }
    setPasswordProblem('')
    setBusy(true)
    setError('')
    try {
      await resetPassword(resetToken, newPassword)
      setMode('signin')
      setResetToken('')
      setNewPassword('')
      setNotice('Password updated. Sign in with your new password.')
    } catch (failure: unknown) {
      setError(
        failure instanceof GatewayError ? failure.message : 'Something went wrong. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (inviteToken) {
    return (
      <SetPassword
        token={inviteToken}
        onDone={(invitedEmail) => {
          setInviteToken('')
          setMode('signin')
          setEmail(invitedEmail)
          setError('')
          setNotice('Password set. Sign in with your work email and new password.')
        }}
        onBack={() => setInviteToken('')}
      />
    )
  }

  if (mode === 'reset-request' || mode === 'reset-confirm') {
    return (
      <main className="sign-in">
        <SignInBrand />
        <section className="sign-in-card" aria-labelledby="sign-in-title">
          <header>
            <h1 id="sign-in-title">Reset your password</h1>
            <p>
              {mode === 'reset-request'
                ? "Enter your work email and we'll send you a reset link."
                : 'Choose a new password. Open the link in your reset email, or paste its code here.'}
            </p>
          </header>
          {error && (
            <div role="alert">
              <Callout tone="danger" title={error} />
            </div>
          )}
          {notice && (
            <div role="status">
              <Callout tone="info" title={notice} />
            </div>
          )}
          {mode === 'reset-request' ? (
            <form noValidate onSubmit={submitResetRequest} className="sign-in-form">
              <Input
                label="Work email"
                type="email"
                placeholder="name@marsh.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
                autoComplete="username"
              />
              <Button type="submit" variant="primary" pill size="lg" fullWidth disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          ) : (
            <form noValidate onSubmit={submitResetConfirm} className="sign-in-form">
              <Input
                label="Reset code"
                placeholder="From your reset email"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                required
              />
              <Input
                label="New password"
                type="password"
                placeholder="Enter a new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                error={passwordProblem || undefined}
                hint={PASSWORD_RULE}
              />
              <Button type="submit" variant="primary" pill size="lg" fullWidth disabled={busy}>
                {busy ? 'Updating…' : 'Set new password'}
              </Button>
            </form>
          )}
          <p className="sign-in-switch">
            <button
              className="text-link"
              type="button"
              onClick={() => {
                setMode('signin')
                setError('')
                setNotice('')
              }}
            >
              Back to sign in
            </button>
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="sign-in">
      <SignInBrand />
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <header>
          <h1 id="sign-in-title">Sign in</h1>
          <p>Use your Marsh work account.</p>
        </header>
        {error && (
          <div role="alert">
            <Callout tone="danger" title={error} />
          </div>
        )}
        <form noValidate onSubmit={submit} className="sign-in-form">
          <Input
            label="Work email"
            type="email"
            placeholder="name@marsh.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
          <Input
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="sign-in-options">
            <button
              className="text-link"
              type="button"
              onClick={() => {
                setError('')
                setNotice('')
                setMode('reset-request')
              }}
            >
              Reset password
            </button>
          </div>
          <Button type="submit" variant="primary" pill size="lg" fullWidth disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {notice && (
          <div role="status">
            <Callout tone="info" title={notice} />
          </div>
        )}
      </section>
      <p className="sign-in-footer">
        Internal use only. Your regional risk engineering lead grants access.
      </p>
    </main>
  )
}

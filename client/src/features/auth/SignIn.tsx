import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Callout, Checkbox, Input, Tabs } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { signIn as requestSignIn, requestPasswordReset, resetPassword, type Session } from './api'
import './sign-in.css'

// Why a sign-in attempt failed. Wrong credentials always read the same, so the
// message never reveals whether the email has an account (F-04).
function signInProblem(error: unknown) {
  if (error instanceof GatewayError && error.status === 401) return 'Incorrect email or password.'
  if (error instanceof GatewayError && error.status === 429) return error.message
  if (error instanceof GatewayError && error.status === null)
    return 'The gateway could not be reached, so you were not signed in. Check that the server is running, then try again.'
  return 'Something went wrong, so you were not signed in. Try again.'
}

// The reset code in an emailed link (F-06): /?reset=<code>.
const emailedResetCode = () => new URLSearchParams(window.location.search).get('reset') ?? ''

export function SignIn({ onSignIn }: { onSignIn: (session: Session) => void }) {
  // A reset link opens straight at the new-password step.
  const [mode, setMode] = useState(() => (emailedResetCode() ? 'reset-confirm' : 'signin'))
  const [name, setName] = useState('')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetToken, setResetToken] = useState(emailedResetCode)
  const [newPassword, setNewPassword] = useState('')
  // Remove the code from the address bar so it isn't kept in history or shared.
  useEffect(() => {
    if (emailedResetCode()) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  const requestAccess = mode === 'signup'
  function changeMode(value: string) {
    setMode(value)
    setChecked(false)
    setError('')
    setNotice('')
    setPassword('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setNotice('')
    if (!email.trim() || !password.trim() || (requestAccess && !name.trim())) {
      setError('Complete the required fields before continuing.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid work email address.')
      return
    }
    if (
      requestAccess &&
      (password.length < 12 || !/\d/.test(password) || !/[^\w\s]/.test(password))
    ) {
      setError('Use at least 12 characters, including a number and a symbol.')
      return
    }
    if (requestAccess && !checked) {
      setError('Accept the acceptable-use terms before requesting access.')
      return
    }
    setError('')
    setPassword('')
    if (requestAccess) {
      setNotice('Demo access request complete. No request was sent and no account was created.')
      return
    }
    setBusy(true)
    try {
      onSignIn(await requestSignIn(email, password))
    } catch (failure: unknown) {
      setError(signInProblem(failure))
    } finally {
      setBusy(false)
    }
  }
  function unavailable(message: string) {
    setError('')
    setNotice(message)
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

  if (mode === 'reset-request' || mode === 'reset-confirm') {
    return (
      <main className="sign-in">
        <div className="sign-in-brand">
          <strong>Marsh</strong>
          <span>Risk Report Generator</span>
        </div>
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
              <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          ) : (
            <form noValidate onSubmit={submitResetConfirm} className="sign-in-form">
              <Input
                label="Reset token"
                placeholder="Filled in when you open the emailed link"
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
              />
              <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
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
      <div className="sign-in-brand">
        <strong>Marsh</strong>
        <span>Risk Report Generator</span>
      </div>
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <header>
          <h1 id="sign-in-title">{requestAccess ? 'Request access' : 'Sign in'}</h1>
          <p>
            {requestAccess
              ? 'Accounts are issued to Marsh risk engineers. Your request goes to your regional lead for approval.'
              : 'Use your Marsh work account to reach your assessments.'}
          </p>
        </header>
        <div className="sign-in-tabs">
          <Tabs
            items={[
              { value: 'signin', label: 'Sign in' },
              { value: 'signup', label: 'Request access' },
            ]}
            value={mode}
            onChange={changeMode}
          />
        </div>
        {error && (
          <div role="alert">
            <Callout tone="danger" title={error} />
          </div>
        )}
        <form noValidate onSubmit={submit} className="sign-in-form">
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            iconLeft="building-2"
            onClick={() =>
              unavailable(
                'Single sign-on is not connected in this demo. Use the form to explore the sample workflow.',
              )
            }
          >
            Continue with Marsh single sign-on
          </Button>
          <div className="sign-in-divider">
            <span />
            Or
            <span />
          </div>
          {requestAccess && (
            <>
              <Input
                label="Full name"
                placeholder="e.g. Alison Rowe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
              <Input
                label="Employee number"
                placeholder="MMC-000000"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                hint="Found on your Marsh McLennan staff record."
              />
            </>
          )}
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
            placeholder={requestAccess ? 'At least 12 characters' : 'Enter your password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={requestAccess ? 'new-password' : 'current-password'}
            hint={
              requestAccess ? '12 characters minimum, including a number and a symbol.' : undefined
            }
          />
          <div className="sign-in-options">
            <Checkbox
              label={
                requestAccess
                  ? 'I accept the acceptable-use terms'
                  : 'Keep me signed in on this device'
              }
              checked={checked}
              onChange={setChecked}
            />
            {!requestAccess && (
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
            )}
          </div>
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
            {requestAccess ? 'Request access' : busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="sign-in-switch">
          {requestAccess ? 'Already have an account?' : 'No account yet?'}{' '}
          <button
            className="text-link"
            type="button"
            onClick={() => changeMode(requestAccess ? 'signin' : 'signup')}
          >
            {requestAccess ? 'Sign in' : 'Request access'}
          </button>
        </p>
        {notice && (
          <div role="status">
            <Callout tone="info" title={notice} />
          </div>
        )}
      </section>
      <p className="sign-in-footer">
        Internal use only. Access is granted by your regional risk engineering lead.
      </p>
    </main>
  )
}

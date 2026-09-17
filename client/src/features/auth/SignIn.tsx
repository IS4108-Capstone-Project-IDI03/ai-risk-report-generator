import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Callout, Checkbox, Input, Tabs } from '../../design-system'
import './sign-in.css'

export function SignIn({ onSignIn }: { onSignIn: () => void }) {
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestAccess = mode === 'signup'
  function changeMode(value: string) {
    setMode(value)
    setChecked(false)
    setError('')
    setNotice('')
    setPassword('')
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    if (requestAccess)
      setNotice('Demo access request complete. No request was sent and no account was created.')
    else onSignIn()
  }
  function unavailable(message: string) {
    setError('')
    setNotice(message)
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
                onClick={() =>
                  unavailable('Password reset is not connected in this demo. No email was sent.')
                }
              >
                Reset password
              </button>
            )}
          </div>
          <Button type="submit" variant="primary" size="lg" fullWidth>
            {requestAccess ? 'Request access' : 'Sign in'}
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

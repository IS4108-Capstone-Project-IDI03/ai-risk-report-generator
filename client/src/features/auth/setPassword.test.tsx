import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function respond(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

const PRIYA = { name: 'Priya Nair', email: 'priya.nair@example.com' }

// No session yet; the invitation routes answer as given. Returns the calls
// made to them, with their parsed bodies.
function mockGateway(replies: {
  lookUp?: () => Promise<Response>
  accept?: () => Promise<Response>
}) {
  const calls: { url: string; body: Record<string, string> }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return respond(401, { error: 'Sign in required.' })
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : {} })
    if (url === '/api/auth/invitation') return (replies.lookUp ?? (() => respond(200, PRIYA)))()
    if (url === '/api/auth/invitation/accept')
      return (replies.accept ?? (() => respond(200, { email: PRIYA.email })))()
    return Promise.reject(new Error(`unexpected ${url}`))
  })
  return calls
}

// The new employee opens the link in their invitation email.
function openInvitation(code = 'abc123') {
  window.history.replaceState(null, '', `/?invite=${code}`)
  render(<App />)
}

function choose(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: password } })
  fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('Set password from an invitation (F-08)', () => {
  it('opens its own screen from the emailed link and greets the employee', async () => {
    const calls = mockGateway({})
    openInvitation()

    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument()
    expect(await screen.findByText(/Welcome, Priya Nair\./)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Work email/)).toHaveValue('priya.nair@example.com')
    expect(calls[0]).toEqual({ url: '/api/auth/invitation', body: { token: 'abc123' } })
    // It is not the password reset (F-06).
    expect(screen.queryByRole('heading', { name: 'Reset your password' })).toBeNull()
    expect(screen.queryByLabelText(/Reset token/)).toBeNull()
    // The code is a secret: it is removed from the address bar once read.
    expect(window.location.search).toBe('')
  })

  it('sets the password, then returns to sign-in with the email filled in', async () => {
    const calls = mockGateway({})
    openInvitation()
    await screen.findByText(/Welcome, Priya Nair\./)

    choose('first-password-1')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(calls[1]).toEqual({
      url: '/api/auth/invitation/accept',
      body: { token: 'abc123', password: 'first-password-1' },
    })
    expect(screen.getByLabelText(/^Work email/)).toHaveValue('priya.nair@example.com')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Password set. Sign in with your work email and new password.',
    )
  })

  it('checks the password rules and the confirmation before sending', async () => {
    const calls = mockGateway({})
    openInvitation()
    await screen.findByText(/Welcome, Priya Nair\./)

    choose('short')
    expect(screen.getByLabelText(/^New password/)).toHaveAccessibleDescription(
      'Use at least 12 characters, including a number and a symbol.',
    )
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('aria-invalid', 'true')

    choose('first-password-1', 'first-password-2')
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAccessibleDescription(
      'The passwords do not match.',
    )
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('aria-invalid', 'false')
    expect(calls).toHaveLength(1)
  })

  it('shows the password problem the gateway reports', async () => {
    mockGateway({
      accept: () =>
        respond(400, {
          error: 'The password is not strong enough.',
          fields: { password: 'Use 72 characters or fewer.' },
        }),
    })
    openInvitation()
    await screen.findByText(/Welcome, Priya Nair\./)

    choose('first-password-1')

    expect(await screen.findByText('Use 72 characters or fewer.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument()
  })

  it('says when the link no longer works, and asks for a new invitation', async () => {
    mockGateway({
      lookUp: () =>
        respond(400, {
          error: 'This invitation link is invalid, has expired or has already been used.',
        }),
    })
    openInvitation('stale')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation link no longer works',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ask a knowledge admin to send you a new invitation.',
    )
    expect(screen.queryByLabelText(/^New password/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('says when the link stopped working while the password was being chosen', async () => {
    mockGateway({
      accept: () =>
        respond(400, {
          error: 'This invitation link is invalid, has expired or has already been used.',
        }),
    })
    openInvitation()
    await screen.findByText(/Welcome, Priya Nair\./)

    choose('first-password-1')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation link no longer works',
    )
  })

  it('lets the employee try again when the gateway cannot be reached', async () => {
    let reachable = false
    mockGateway({
      lookUp: () =>
        reachable ? respond(200, PRIYA) : Promise.reject(new TypeError('Failed to fetch')),
    })
    openInvitation()

    expect(await screen.findByText('Your invitation could not be checked')).toBeInTheDocument()
    reachable = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/Welcome, Priya Nair\./)).toBeInTheDocument()
  })
})

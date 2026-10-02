import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function respond(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

function mockGateway(reply: (url: string, body: unknown) => Promise<Response>) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    reply(url, init?.body ? JSON.parse(init.body as string) : undefined),
  )
}

function openResetRequest() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
}

describe('Reset password (F-06)', () => {
  it('requests a reset link and moves to the confirm screen', async () => {
    mockGateway((url) =>
      url === '/api/auth/request-reset'
        ? respond(200, { message: 'sent' })
        : Promise.reject(new Error(`unexpected ${url}`)),
    )
    openResetRequest()
    fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument(),
    )
    expect(screen.getByLabelText(/Reset token/)).toBeInTheDocument()
  })

  it('sets a new password and returns to sign-in', async () => {
    openResetRequest()
    mockGateway((url) =>
      url === '/api/auth/request-reset'
        ? respond(200, { message: 'sent' })
        : respond(200, { message: 'updated' }),
    )
    fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => screen.getByLabelText(/Reset token/))

    fireEvent.change(screen.getByLabelText(/Reset token/), { target: { value: 'abc123' } })
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'a new one!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Sign in with your new password')
  })

  it('shows the gateway error for an invalid or expired token', async () => {
    openResetRequest()
    mockGateway((url) =>
      url === '/api/auth/request-reset'
        ? respond(200, { message: 'sent' })
        : respond(400, { error: 'This reset link is invalid or has expired.' }),
    )
    fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => screen.getByLabelText(/Reset token/))

    fireEvent.change(screen.getByLabelText(/Reset token/), { target: { value: 'stale-token' } })
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'a new one!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired'),
    )
  })
})

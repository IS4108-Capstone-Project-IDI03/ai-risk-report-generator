import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'

const JIDE = {
  id: '6ab39017e45cf009e4507732',
  staffId: 'MRE-0002',
  name: 'Jide Okafor',
  email: 'jide.okafor@example.com',
  role: 'risk_engineer',
  jobTitle: 'Risk engineer · Property',
  phone: null,
  office: 'SG',
  active: true,
  updatedAt: '2026-09-25T04:00:00.000Z',
}
const ALEX = {
  ...JIDE,
  id: '6ab39017e45cf009e4507731',
  staffId: 'MRE-0001',
  name: 'Alex Rowe',
  email: 'alex.rowe@example.com',
}

function respond(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}
function mockGateway(...replies: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn()
  for (const reply of replies) fetchMock.mockImplementationOnce(reply)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
function openAccounts() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'User accounts' })[0])
}
async function openJide() {
  fireEvent.click(await screen.findByRole('button', { name: 'Open profile for Jide Okafor' }))
  return screen.findByRole('region', { name: 'Profile for Jide Okafor' })
}
function field(label: RegExp) {
  return screen.getByLabelText(label) as HTMLInputElement
}

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('User accounts (F-03)', () => {
  it('lists accounts and opens a profile with the option to edit', async () => {
    const fetchMock = mockGateway(
      () => respond(200, [ALEX, JIDE]),
      () => respond(200, JIDE),
    )
    openAccounts()

    expect(await screen.findByRole('button', { name: 'Open profile for Alex Rowe' })).toBeVisible()
    const profile = await openJide()

    expect(fetchMock).toHaveBeenLastCalledWith(`/api/users/${JIDE.id}`, expect.anything())
    expect(within(profile).getByText('jide.okafor@example.com')).toBeInTheDocument()
    expect(within(profile).getByText('Singapore')).toBeInTheDocument()
    expect(within(profile).getByRole('button', { name: 'Edit profile' })).toBeInTheDocument()
  })

  it('saves the edited fields and shows them when the profile is reopened', async () => {
    const edited = { ...JIDE, jobTitle: 'Senior risk engineer · Property', office: 'MY' }
    const fetchMock = mockGateway(
      () => respond(200, [ALEX, JIDE]),
      () => respond(200, JIDE),
      () => respond(200, edited),
      () => respond(200, [ALEX, edited]),
      () => respond(200, edited),
    )
    openAccounts()
    await openJide()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    fireEvent.change(field(/^Job title/), { target: { value: 'Senior risk engineer · Property' } })
    fireEvent.change(field(/^Office/), { target: { value: 'MY' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[2]
    expect(url).toBe(`/api/users/${JIDE.id}`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      name: 'Jide Okafor',
      email: 'jide.okafor@example.com',
      role: 'risk_engineer',
      jobTitle: 'Senior risk engineer · Property',
      phone: '',
      office: 'MY',
      active: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to accounts' }))
    const reopened = await openJide()

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(within(reopened).getByText('Senior risk engineer · Property')).toBeInTheDocument()
    expect(within(reopened).getByText('Malaysia')).toBeInTheDocument()
  })

  it('identifies the invalid field when the gateway rejects the profile', async () => {
    mockGateway(
      () => respond(200, [ALEX, JIDE]),
      () => respond(200, JIDE),
      () =>
        respond(400, {
          error: 'The profile details are invalid.',
          fields: { email: 'Enter an email address such as name@example.com.' },
        }),
    )
    openAccounts()
    await openJide()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    fireEvent.change(field(/^Email/), { target: { value: 'jide.okafor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Enter an email address such as name@example.com.'),
    ).toBeInTheDocument()
    expect(field(/^Email/)).toHaveAttribute('aria-invalid', 'true')
    expect(field(/^Email/)).toHaveAccessibleDescription(
      'Enter an email address such as name@example.com.',
    )
    expect(field(/^Name/)).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByText('Correct the highlighted fields, then save again.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('explains when the gateway cannot be reached', async () => {
    mockGateway(() => Promise.reject(new TypeError('Failed to fetch')))
    openAccounts()

    expect(
      await screen.findByText(/The gateway could not be reached, so the accounts could not be/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

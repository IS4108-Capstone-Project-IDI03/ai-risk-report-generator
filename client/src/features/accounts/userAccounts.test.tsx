import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { SESSIONS, signIn } from '../../test/session'

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
// A knowledge admin starts on the knowledge base (F-05), which loads its
// document list; that request, and the dashboard's work list (RV-10), are
// answered as unreachable, so fetchMock only sees the account requests.
function mockGateway(...replies: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn()
  for (const reply of replies) fetchMock.mockImplementationOnce(reply)
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url.startsWith('/api/assessments') || url.startsWith('/api/knowledge-documents')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : fetchMock(url, init),
  )
  return fetchMock
}
async function openAccounts() {
  render(<App />)
  await signIn('knowledge_admin')
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
    await openAccounts()

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
    await openAccounts()
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
    await openAccounts()
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
    await openAccounts()

    expect(
      await screen.findByText(/The gateway could not be reached, so the accounts could not be/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('Role assignment (F-05)', () => {
  it('offers only the two agreed roles and saves the one assigned', async () => {
    const promoted = { ...JIDE, role: 'knowledge_admin' }
    const fetchMock = mockGateway(
      () => respond(200, [ALEX, JIDE]),
      () => respond(200, JIDE),
      () => respond(200, promoted),
    )
    await openAccounts()
    await openJide()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    const role = field(/^Role/)
    expect(
      within(role)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Risk engineer', 'Knowledge admin'])
    fireEvent.change(role, { target: { value: 'knowledge_admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls[2]
    expect(JSON.parse(init.body)).toMatchObject({ role: 'knowledge_admin' })
    const saved = screen.getByRole('region', { name: 'Profile for Jide Okafor' })
    expect(within(saved).getAllByText('Knowledge admin').length).toBeGreaterThan(0)
  })

  it('does not let an admin change their own role or deactivate themselves', async () => {
    const self = {
      ...JIDE,
      id: SESSIONS.knowledge_admin.user.id,
      staffId: 'MRE-0004',
      name: 'Sana Patel',
      email: 'sana.patel@example.com',
      role: 'knowledge_admin',
    }
    mockGateway(
      () => respond(200, [JIDE, self]),
      () => respond(200, self),
    )
    await openAccounts()
    fireEvent.click(await screen.findByRole('button', { name: 'Open profile for Sana Patel' }))
    await screen.findByRole('region', { name: 'Profile for Sana Patel' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))

    expect(field(/^Role/)).toBeDisabled()
    expect(screen.getByText('Another knowledge admin must change your role.')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Account active' })).toBeDisabled()
    expect(field(/^Job title/)).toBeEnabled()
  })
})

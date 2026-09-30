import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { GatewayError, SESSION_ENDED_EVENT } from '../assessments/api'
import { signIn as requestSignIn } from './api'
import { signIn } from '../../test/session'

const unreachable = vi.fn<(url: string) => Promise<Response>>(() =>
  Promise.reject(new TypeError('Failed to fetch')),
)
const requested = () => unreachable.mock.calls.map(([url]) => url)

// Opens the app at a URL, as typing it or following a link would.
function openAt(path: string) {
  window.history.replaceState(null, '', path)
  render(<App />)
}
const nav = () => screen.getAllByRole('navigation')[0]
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  // No gateway: screens fall back to their sample data.
  vi.stubGlobal('fetch', unreachable)
})
afterEach(() => {
  cleanup()
  unreachable.mockClear()
  vi.unstubAllGlobals()
})

describe('Sign-in (F-04)', () => {
  it('shows the sign-in screen for a workspace URL until someone signs in', () => {
    openAt('/admin/users')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(requested()).not.toContain('/api/users')
  })

  it('keeps the user signed out with a generic error when the credentials are wrong', async () => {
    vi.mocked(requestSignIn).mockRejectedValueOnce(
      new GatewayError(401, 'Incorrect email or password.'),
    )
    render(<App />)
    fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(requestSignIn).toHaveBeenLastCalledWith('a@example.com', 'wrong')
  })

  it('returns to sign-in when the gateway says the session has ended', async () => {
    render(<App />)
    await signIn()
    act(() => {
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
    })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('Route guard (F-05)', () => {
  it('opens each role at its own workspace', async () => {
    openAt('/')
    await signIn('knowledge_admin')
    expect(screen.getByRole('heading', { name: 'Knowledge base' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
    cleanup()

    openAt('/')
    await signIn('risk_engineer')
    expect(screen.getByRole('heading', { name: 'Your assessments' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/assessments'))
  })

  it('opens the URL asked for after sign-in when the role allows it', async () => {
    openAt('/admin/users')
    await signIn('knowledge_admin')
    expect(screen.getByRole('heading', { name: 'User accounts' })).toBeInTheDocument()
  })

  it.each([
    ['/admin/users', 'User accounts', '/api/users'],
    ['/admin/knowledge-base', 'Knowledge base', '/api/knowledge-documents'],
  ])('blocks a risk engineer from %s', async (path, screenName, api) => {
    openAt(path)
    await signIn('risk_engineer')

    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page')
    expect(screen.getByRole('alert')).toHaveTextContent('Risk engineer')
    expect(screen.queryByRole('heading', { name: screenName })).not.toBeInTheDocument()
    expect(requested()).not.toContain(api)
    // Nor is it offered in the navigation.
    expect(within(nav()).queryByRole('button', { name: screenName })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go to your workspace' }))
    expect(screen.getByRole('heading', { name: 'Your assessments' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/assessments')
  })

  it.each(['/assessments/new', '/site-observation'])(
    'blocks a knowledge admin from %s',
    async (path) => {
      openAt(path)
      await signIn('knowledge_admin')

      expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page')
      expect(requested().some((url) => url.includes('/capture-session'))).toBe(false)
    },
  )

  it('lets a knowledge admin read assessments without the controls that change them', async () => {
    openAt('/assessments')
    await signIn('knowledge_admin')

    expect(screen.getByRole('heading', { name: 'Your assessments' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New assessment' })).not.toBeInTheDocument()
    expect(within(nav()).getByRole('button', { name: 'User accounts' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tilbury Distribution Centre' }))
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs.some((name) => name?.startsWith('Overview'))).toBe(true)
    expect(tabs.some((name) => name?.startsWith('Observations'))).toBe(true)
    expect(tabs.some((name) => name?.startsWith('Report generation'))).toBe(false)
    expect(screen.queryByRole('button', { name: /^Site observation/ })).not.toBeInTheDocument()
  })

  it('follows the browser back button between screens', async () => {
    openAt('/')
    await signIn('knowledge_admin')
    fireEvent.click(within(nav()).getByRole('button', { name: 'User accounts' }))
    expect(window.location.pathname).toBe('/admin/users')

    act(() => {
      window.history.replaceState(null, '', '/admin/knowledge-base')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('heading', { name: 'Knowledge base' })).toBeInTheDocument()
  })
})

describe('auth api', () => {
  it('reads the session and its permissions, or none after a 401', async () => {
    const actual = await vi.importActual<typeof import('./api')>('./api')
    const session = {
      user: { id: 'u1', name: 'Sana Patel', role: 'knowledge_admin' },
      permissions: ['users:manage'],
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(session))
        .mockResolvedValueOnce(json({ error: 'Sign in required.' }, 401)),
    )

    expect(await actual.currentSession()).toEqual(session)
    expect(await actual.currentSession()).toBeNull()
  })

  it('posts the credentials and rejects wrong ones with the status', async () => {
    const actual = await vi.importActual<typeof import('./api')>('./api')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'Incorrect email or password.' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(actual.signIn(' a@example.com ', 'pw')).rejects.toMatchObject({ status: 401 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@example.com', password: 'pw' })
  })
})

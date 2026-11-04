// CP-23 round 12: the Clients list's labelled Sort pill reorders its rows, and a Remove the
// server refuses is greyed with its reason (no request is sent). Calls App through the sidebar.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
  )
const visit = (reference: string, client: string, clientId: string, due: string) => ({
  id: 'id-' + reference,
  reference,
  client,
  clientId,
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-05-01',
  reportDueDate: due,
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'capturing',
  captureStartedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  site: {
    id: 's-' + clientId,
    code: 'SITE-' + clientId,
    name: 'Site of ' + client,
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Office',
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
  },
})
const REASON = 'Alpha has 6 open assessments. Archive them, then remove the client.'

function openClients() {
  const posts: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') posts.push(`${init.method} ${url}`)
    if (url === '/api/assessments')
      return json([
        visit('RPT-1', 'Alpha', 'c1', '2027-03-01'),
        visit('RPT-2', 'Beta', 'c2', '2026-12-01'),
      ])
    if (url === '/api/clients')
      return json([
        {
          id: 'c1',
          name: 'Alpha',
          division: null,
          sites: 1,
          rename: { allowed: true, reason: null },
          remove: { allowed: false, reason: REASON },
        },
        {
          id: 'c2',
          name: 'Beta',
          division: null,
          sites: 1,
          rename: { allowed: true, reason: null },
          remove: { allowed: true, reason: null },
        },
      ])
    return json([])
  })
  return posts
}

const order = () =>
  within(screen.getByRole('table', { name: 'Your clients' }))
    .getAllByRole('button', { name: /^Open / })
    .map((b) => b.getAttribute('aria-label'))

async function show() {
  const posts = openClients()
  render(<App />)
  await signIn()
  fireEvent.click((await screen.findAllByRole('button', { name: 'Clients' }))[0])
  await screen.findByRole('heading', { name: 'Clients', level: 1 })
  return posts
}

it('the Sort pill names the order and reorders the rows', async () => {
  await show()
  expect(order()).toEqual(['Open Alpha', 'Open Beta'])
  fireEvent.click(screen.getByRole('button', { name: 'Sort clients: Name, A to Z' }))
  fireEvent.click(screen.getByRole('option', { name: 'Next report due, soonest first' }))
  expect(order()).toEqual(['Open Beta', 'Open Alpha'])
  expect(
    screen.getByRole('button', { name: 'Sort clients: Next report due, soonest first' }),
  ).toBeInTheDocument()
})

it('a Remove the server refuses is greyed with its reason and sends nothing', async () => {
  const posts = await show()
  const remove = await screen.findByRole('button', { name: 'Remove client Alpha' })
  await vi.waitFor(() => expect(remove).toHaveAttribute('aria-disabled', 'true'))
  fireEvent.click(remove)
  expect(await screen.findByText("Can't remove yet")).toBeInTheDocument()
  expect(screen.getByText(REASON)).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(posts).toEqual([])
  // Beta may be removed.
  expect(screen.getByRole('button', { name: 'Remove client Beta' })).not.toHaveAttribute(
    'aria-disabled',
  )
})

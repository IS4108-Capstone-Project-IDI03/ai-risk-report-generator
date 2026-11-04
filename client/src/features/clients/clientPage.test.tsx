import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { ClientPage, ClientPageSite } from './api'

// CP-18: a client's page lists the engineer's sites at it, with their own
// visits, and corrects, removes and restores them.

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
  window.history.replaceState(null, '', '/')
})

const allowed = { allowed: true, reason: null }
const refused = (reason: string) => ({ allowed: false, reason })
const NOT_ARCHIVED = '1 of its assessments is not archived. Archive it before removing this site.'
const OTHERS = "Another engineer's assessment uses this site, so it can't be changed."

function site(overrides: Partial<ClientPageSite> = {}): ClientPageSite {
  return {
    id: 's1',
    code: 'SITE-0001',
    name: 'Kent Ridge campus',
    address: '21 Lower Kent Ridge Road',
    jurisdiction: 'SG',
    facilityType: 'Mixed-use development',
    edited: null,
    removed: null,
    removedWithClient: false,
    nameTaken: false,
    assessments: 2,
    change: allowed,
    remove: refused(NOT_ARCHIVED),
    restore: { allowed: false, reason: null },
    visits: [
      {
        reference: 'RPT-2026-0412',
        siteVisitDate: '2026-03-12',
        surveyType: 'First survey',
        reportDueDate: null,
        status: 'capturing',
      },
      {
        reference: 'RPT-2025-0198',
        siteVisitDate: '2025-03-10',
        surveyType: 'First survey',
        reportDueDate: null,
        status: 'archived',
      },
    ],
    ...overrides,
  }
}

const BUKIT: ClientPageSite = site({
  id: 's2',
  code: 'SITE-0002',
  name: 'Bukit Timah campus',
  address: '1 Bukit Timah Road',
  facilityType: 'Office',
  assessments: 1,
  change: refused(OTHERS),
  remove: refused(OTHERS),
  visits: [
    {
      reference: 'RPT-2026-0430',
      siteVisitDate: '2026-04-20',
      surveyType: 'First survey',
      reportDueDate: null,
      status: 'not_started',
    },
  ],
})

function page(overrides: Partial<ClientPage> = {}): ClientPage {
  return {
    id: 'c1',
    name: 'NUS',
    edited: null,
    removed: false,
    rename: allowed,
    remove: refused(NOT_ARCHIVED),
    removedWithClient: 0,
    restore: { allowed: false, reason: null },
    sites: [BUKIT, site()],
    ...overrides,
  }
}

// One of the engineer's assessments on the work list, at a site of NUS.
const assessment = (reference: string, at: ClientPageSite) => ({
  id: 'id-' + reference,
  reference,
  client: 'NUS',
  clientId: 'c1',
  surveyType: 'Property risk survey',
  siteVisitDate: at.visits[0].siteVisitDate,
  reportDueDate: null,
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'capturing',
  captureStartedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  site: {
    id: at.id,
    code: at.code,
    name: at.name,
    address: at.address,
    jurisdiction: at.jurisdiction,
    facilityType: at.facilityType,
    removed: false,
    change: { ...at.change, assessments: at.assessments },
  },
})
const WORK_LIST = [assessment('RPT-2026-0412', site()), assessment('RPT-2026-0430', BUKIT)]

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The gateway: GETs answered from the page and work list as they are now;
// each change recorded, then answered by `change` (204 unless it says).
function gateway(
  current: { page: ClientPage | (() => Promise<Response>) },
  change: (call: string, body: unknown) => Promise<Response> | void = () => undefined,
) {
  const calls: { call: string; body: unknown }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      if (url === '/api/assessments') return json(WORK_LIST)
      if (url === '/api/clients/c1')
        return typeof current.page === 'function' ? current.page() : json(current.page)
      // The create form's list of NUS's sites.
      if (url === '/api/clients/c1/sites')
        return json([
          {
            id: 's1',
            code: 'SITE-0001',
            name: 'Kent Ridge campus',
            address: '21 Lower Kent Ridge Road',
            jurisdiction: 'SG',
            facilityType: 'Mixed-use development',
            latest: null,
          },
        ])
      return json([])
    }
    const call = `${method} ${url}`
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ call, body })
    return change(call, body) ?? json(undefined, 204)
  })
  return calls
}

async function openClientPage() {
  window.history.replaceState(null, '', '/clients/c1')
  render(<App />)
  await signIn()
  await screen.findByRole('heading', { name: 'NUS', level: 1 })
  showSites()
}
// The page opens on Open work; the site cards are on Sites.
const showSites = () => fireEvent.click(screen.getByRole('tab', { name: /^Sites/ }))
const card = (name: string) => screen.getByRole('listitem', { name })

describe('Opening a client (CP-18)', () => {
  it('opens at its address, with the engineer’s sites and assessments, newest first', async () => {
    gateway({ page: page() })
    window.history.replaceState(null, '', '/clients/c1')
    render(<App />)
    await signIn()

    await screen.findByRole('heading', { name: 'NUS', level: 1 })
    showSites()
    expect(window.location.pathname).toBe('/clients/c1')
    // The tabs carry the counts.
    expect(screen.getByRole('tab', { name: 'Open work, 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sites, 2' })).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('listitem', { name: /campus/ })
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['Bukit Timah campus', 'Kent Ridge campus'])
    const kent = card('Kent Ridge campus')
    expect(within(kent).getByText('21 Lower Kent Ridge Road')).toBeInTheDocument()
    expect(within(kent).getByText('Singapore')).toBeInTheDocument()
    expect(within(kent).getByText('Mixed-use development')).toBeInTheDocument()
    // Board 06: no site code chip on the site header.
    expect(within(kent).queryByText('SITE-0001')).not.toBeInTheDocument()
    // An assessment's row shows its status and report due, and opens it.
    // Archived assessments wait for Archived.
    const visit = within(kent).getByRole('row', { name: /RPT-2026-0412/ })
    const cells = within(visit).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('First survey')
    expect(cells[2]).toHaveTextContent('12 Mar 2026')
    expect(cells[3]).toHaveTextContent('Capturing')
    expect(cells[4]).toHaveTextContent('Not set')
    expect(within(kent).queryByText('RPT-2025-0198')).not.toBeInTheDocument()
    // The page leads back to the Clients list, and Rename and Remove sit beside the name.
    expect(screen.getByRole('button', { name: 'Back to Clients' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename client' })).toBeInTheDocument()

    fireEvent.click(visit)
    expect(await screen.findByRole('tab', { name: /Overview/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'Kent Ridge campus', level: 1 })).toBeInTheDocument()
  })

  it('shows the client’s site contacts in the facts, three until Show all, and hides the row without any', async () => {
    const person = (name: string) => ({ name, role: null, site: 'Bukit Timah campus' })
    gateway({
      page: page({
        contacts: [
          { name: 'Priya Nair', role: 'Facilities manager', site: 'Kent Ridge campus' },
          person('Ben Ong'),
          person('Cara Lim'),
          person('Dev Rao'),
          person('Eva Tan'),
        ],
      }),
    })
    await openClientPage()
    const facts = within(screen.getByLabelText('Client facts'))
    expect(facts.getByText('Site contacts')).toBeInTheDocument()
    // The name and the role, with the site on hover.
    expect(facts.getByText('Priya Nair')).toBeInTheDocument()
    expect(facts.getByText('· Facilities manager')).toBeInTheDocument()
    expect(facts.getAllByTitle('At Bukit Timah campus')).toHaveLength(2)
    expect(facts.queryByText('Dev Rao')).not.toBeInTheDocument()
    fireEvent.click(facts.getByRole('button', { name: 'Show all 5' }))
    expect(facts.getByText('Eva Tan')).toBeInTheDocument()
    expect(facts.queryByRole('button', { name: 'Show all 5' })).not.toBeInTheDocument()

    cleanup()
    gateway({ page: page() })
    await openClientPage()
    expect(screen.queryByText('Site contacts')).not.toBeInTheDocument()
  })

  it('lists the engineer’s clients from the sidebar, found by name or site, each opening its page', async () => {
    gateway({ page: page() })
    render(<App />)
    await signIn()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Clients' }))[0])

    await screen.findByRole('heading', { name: 'Clients', level: 1 })
    expect(window.location.pathname).toBe('/clients')
    const list = () => screen.getByRole('table', { name: 'Your clients' })
    const nus = within(list()).getByRole('row', { name: /NUS/ })
    // Sites, then open assessments.
    expect(
      within(nus)
        .getAllByRole('cell')
        .slice(1, 3)
        .map((c) => c.textContent),
    ).toEqual(['2', '2'])

    const search = screen.getByRole('searchbox', { name: 'Search clients by name or site' })
    fireEvent.change(search, { target: { value: 'bukit' } })
    expect(within(list()).getByRole('row', { name: /NUS/ })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'changi' } })
    expect(screen.getByText('No clients match')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: '' } })

    fireEvent.click(within(list()).getByRole('button', { name: 'Open NUS' }))
    await screen.findByRole('heading', { name: 'NUS', level: 1 })
    showSites()
    expect(window.location.pathname).toBe('/clients/c1')
    // Back leads back to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Back to Clients' }))
    expect(await screen.findByRole('heading', { name: 'Clients', level: 1 })).toBeInTheDocument()
  })

  it('keeps a client whose sites are all removed under Removed clients, as its page keeps removed sites', async () => {
    const terminal = assessment(
      'RPT-2024-0001',
      site({ id: 's9', code: 'SITE-0009', name: 'Terminal 5' }),
    )
    const removedVisit = {
      ...terminal,
      client: 'Changi Airport Group',
      clientId: 'c2',
      status: 'archived',
      site: { ...terminal.site, removed: true },
    }
    vi.stubGlobal('fetch', (url: string) =>
      json(url === '/api/assessments' ? [...WORK_LIST, removedVisit] : []),
    )
    render(<App />)
    await signIn()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Clients' }))[0])
    await screen.findByRole('heading', { name: 'Clients', level: 1 })
    // Counted and listed only once removed clients are asked for.
    expect(screen.getByText('1 client')).toBeInTheDocument()
    const list = () => screen.getByRole('table', { name: 'Your clients' })
    expect(within(list()).queryByRole('row', { name: /Changi/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Removed clients (1)' }))
    const changi = within(list()).getByRole('row', { name: /Changi Airport Group/ })
    expect(changi).toHaveTextContent('Removed')
    // A removed client is restored from its page, so its row offers Open only.
    expect(within(changi).queryByRole('button', { name: /^Rename client/ })).not.toBeInTheDocument()
    expect(within(list()).queryByRole('row', { name: /NUS/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to clients' }))
    expect(within(list()).getByRole('row', { name: /NUS/ })).toBeInTheDocument()
  })

  it('opens each screen at the top, not where the last one was scrolled to', async () => {
    gateway({ page: page() })
    render(<App />)
    await signIn()
    const scroller = await vi.waitFor(() => document.querySelector('main')!)
    scroller.scrollTop = 600
    fireEvent.click(screen.getAllByRole('button', { name: 'Clients' })[0])
    await screen.findByRole('heading', { name: 'Clients', level: 1 })
    expect(scroller.scrollTop).toBe(0)

    scroller.scrollTop = 600
    fireEvent.click(
      within(screen.getByRole('table', { name: 'Your clients' })).getByRole('button', {
        name: 'Open NUS',
      }),
    )
    await screen.findByRole('heading', { name: 'NUS', level: 1 })
    expect(scroller.scrollTop).toBe(0)
  })

  it('says when the engineer has no assessment for the client', async () => {
    gateway({
      page: () => json({ error: 'You have no assessments for this client.' }, 403),
    })
    window.history.replaceState(null, '', '/clients/c1')
    render(<App />)
    await signIn()
    expect(await screen.findByText('You have no assessments for this client')).toBeInTheDocument()
    expect(screen.getByText('A client opens from your own assessments.')).toBeInTheDocument()
  })

  it('filters sites by name or address, assessments by status, and shows archived ones on their own', async () => {
    gateway({ page: page() })
    await openClientPage()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sites by name or address' }), {
      target: { value: 'bukit timah road' },
    })
    expect(screen.getAllByRole('listitem', { name: /campus/ })).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sites by name or address' }), {
      target: { value: '' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Capturing' }))
    expect(
      screen
        .getAllByRole('listitem', { name: /campus/ })
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['Kent Ridge campus'])

    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }))
    expect(within(card('Kent Ridge campus')).getByText('RPT-2025-0198')).toBeInTheDocument()
    expect(within(card('Kent Ridge campus')).queryByText('RPT-2026-0412')).not.toBeInTheDocument()
  })

  it('starts a new assessment from its header: the create form with the client chosen and a new site to name', async () => {
    gateway({ page: page() })
    await openClientPage()
    fireEvent.click(screen.getByRole('button', { name: 'New assessment' }))
    // The New Assessment form opens; what it pre-fills is tested with the form.
    expect(await screen.findByRole('heading', { name: 'New Assessment' })).toBeInTheDocument()
  })

  it('offers no New assessment for a removed client, which is restored first', async () => {
    gateway({
      page: page({
        removed: true,
        removedWithClient: 1,
        restore: allowed,
        sites: [
          {
            ...site(),
            removed: { at: '2026-11-02T08:00:00.000Z', by: { id: 'u1', name: 'Alex Rowe' } },
          },
        ],
      }),
    })
    await openClientPage()
    expect(screen.getByText('This client is removed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New assessment' })).not.toBeInTheDocument()
  })
})

describe('Changing a client and its sites (CP-18)', () => {
  it('corrects a site, asking first about a new jurisdiction', async () => {
    const current = { page: page() }
    const calls = gateway(current, (call, body) => {
      if (call === 'PUT /api/sites/s1')
        current.page = page({ sites: [BUKIT, site(body as Partial<ClientPageSite>)] })
    })
    await openClientPage()

    // A site a colleague also uses says why, and offers no Edit.
    const bukit = card('Bukit Timah campus')
    expect(within(bukit).getByText(OTHERS)).toBeInTheDocument()
    expect(within(bukit).queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()

    fireEvent.click(
      within(card('Kent Ridge campus')).getByRole('button', { name: 'Edit Kent Ridge campus' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit Kent Ridge campus' })
    fireEvent.change(within(dialog).getByLabelText(/Jurisdiction/), { target: { value: 'MY' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(
      within(dialog).getByText(/changes the 2 assessments at Kent Ridge campus/),
    ).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change scope' }))

    expect(await screen.findByText(/Kent Ridge campus saved/)).toBeInTheDocument()
    expect(calls).toEqual([
      {
        call: 'PUT /api/sites/s1',
        body: {
          name: 'Kent Ridge campus',
          address: '21 Lower Kent Ridge Road',
          jurisdiction: 'MY',
          facilityType: 'Mixed-use development',
        },
      },
    ])
    await waitFor(() =>
      expect(within(card('Kent Ridge campus')).getByText(/Malaysia/)).toBeInTheDocument(),
    )
  })

  it('keeps what was typed when a correction is refused', async () => {
    gateway({ page: page() }, () =>
      json(
        {
          error: 'The site details are invalid.',
          fields: { name: 'This client already has a site named Bukit Timah campus.' },
        },
        400,
      ),
    )
    await openClientPage()
    fireEvent.click(
      within(card('Kent Ridge campus')).getByRole('button', { name: 'Edit Kent Ridge campus' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit Kent Ridge campus' })
    fireEvent.change(within(dialog).getByLabelText(/Site name/), {
      target: { value: 'Bukit Timah campus' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(
      await within(dialog).findByText('This client already has a site named Bukit Timah campus.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Site name/)).toHaveValue('Bukit Timah campus')
  })

  it('renames the client', async () => {
    const current = { page: page() }
    const calls = gateway(current, (call, body) => {
      if (call === 'PUT /api/clients/c1')
        current.page = page({ name: (body as { name: string }).name })
    })
    await openClientPage()
    // From the pencil beside the name.
    fireEvent.click(screen.getByRole('button', { name: 'Rename client' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename NUS' })
    fireEvent.change(within(dialog).getByLabelText(/Client name/), {
      target: { value: 'National University of Singapore' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    expect(
      await screen.findByRole('heading', { name: 'National University of Singapore', level: 1 }),
    ).toBeInTheDocument()
    expect(calls).toEqual([
      { call: 'PUT /api/clients/c1', body: { name: 'National University of Singapore' } },
    ])
  })

  it('disables Rename and Remove beside the name when they are not the engineer’s, saying why', async () => {
    const OTHERS = "Another engineer has assessments for this client, so it can't be changed."
    gateway({ page: page({ rename: refused(OTHERS), remove: refused(OTHERS) }) })
    await openClientPage()
    // Blocked but focusable (aria-disabled), clicking does nothing, the reason shows in a box.
    const rename = screen.getByRole('button', { name: 'Rename client' })
    const remove = screen.getByRole('button', { name: 'Remove client' })
    expect(rename).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(remove)
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('tooltip')).toHaveTextContent("Can't remove yet")
    expect(screen.getByRole('tooltip')).toHaveTextContent(OTHERS)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('on a phone, ⋯ opens the More sheet: Client details, Rename, and Remove greyed out with its reason', async () => {
    const OPEN = 'NUS has 6 open assessments. Archive them, then remove the client.'
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    const calls = gateway({ page: page({ remove: refused(OPEN) }) })
    await openClientPage()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const sheet = screen.getByRole('dialog', { name: 'NUS' })
    expect(within(sheet).getByText('Client details')).toBeInTheDocument()
    expect(within(sheet).getByText('Rename client')).toBeInTheDocument()
    expect(within(sheet).getByText(OPEN)).toBeInTheDocument()
    fireEvent.click(within(sheet).getByText('Remove client'))
    expect(screen.queryByRole('dialog', { name: 'Remove NUS?' })).not.toBeInTheDocument()
    expect(calls.map((c) => c.call)).not.toContain('POST /api/clients/c1/remove')
    vi.unstubAllGlobals()
  })

  it('removes the client from the bin beside its name once its assessments are all archived', async () => {
    const calls = gateway({ page: page({ remove: allowed }) })
    await openClientPage()
    // Rename is allowed; Remove too, so nothing is explained.
    expect(screen.getByRole('button', { name: 'Rename client' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove client' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove NUS?' })
    expect(
      within(dialog).getByText(/Its 2 sites won't be offered for new assessments/),
    ).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove client' }))
    expect(await screen.findByText(/NUS removed/)).toBeInTheDocument()
    expect(calls.map((c) => c.call)).toEqual(['POST /api/clients/c1/remove'])
  })

  it('removes a site whose visits are all archived, and restores it, under a new name when its own was taken', async () => {
    const archivedOnly = site({
      id: 's3',
      code: 'SITE-0003',
      name: 'Outram campus',
      remove: allowed,
      visits: [
        {
          reference: 'RPT-2024-0001',
          siteVisitDate: '2024-01-10',
          surveyType: 'First survey',
          reportDueDate: null,
          status: 'archived',
        },
      ],
    })
    const removed = {
      ...archivedOnly,
      removed: { at: '2026-11-02T08:00:00.000Z', by: { id: 'u1', name: 'Alex Rowe' } },
      nameTaken: true,
      change: refused('This site is removed. Restore it before changing it.'),
      restore: allowed,
    }
    const current = { page: page({ sites: [BUKIT, site(), archivedOnly] }) }
    const calls = gateway(current, (call) => {
      if (call === 'POST /api/sites/s3/remove')
        current.page = page({ sites: [BUKIT, site(), removed] })
    })
    await openClientPage()

    fireEvent.click(
      within(card('Outram campus')).getByRole('button', { name: 'Remove Outram campus' }),
    )
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Remove Outram campus?' })).getByRole('button', {
        name: 'Remove site',
      }),
    )
    expect(await screen.findByText(/Outram campus removed/)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Removed sites (1)' }))
    const gone = card('Outram campus')
    expect(within(gone).getByText(/Removed by Alex Rowe/)).toBeInTheDocument()
    fireEvent.click(within(gone).getByRole('button', { name: 'Restore Outram campus' }))
    const dialog = screen.getByRole('dialog', { name: 'Restore Outram campus' })
    fireEvent.change(within(dialog).getByLabelText(/New site name/), {
      target: { value: 'Outram campus (old)' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await screen.findByText('Outram campus restored as Outram campus (old).')
    expect(calls.map((c) => c.call)).toEqual([
      'POST /api/sites/s3/remove',
      'POST /api/sites/s3/restore',
    ])
    expect(calls[1].body).toEqual({ name: 'Outram campus (old)' })
  })

  it('says a client is removed, and restores the sites removed with it', async () => {
    const removedSite = {
      ...site(),
      removed: { at: '2026-11-02T08:00:00.000Z', by: { id: 'u1', name: 'Alex Rowe' } },
      removedWithClient: true,
      restore: allowed,
    }
    const calls = gateway(
      {
        page: page({
          removed: true,
          rename: refused('This client is removed. Restore it before changing it.'),
          removedWithClient: 1,
          restore: allowed,
          sites: [removedSite],
        }),
      },
      () => json({ restored: 1, nameTaken: [] }),
    )
    await openClientPage()
    expect(screen.getByText('This client is removed')).toBeInTheDocument()
    // Nothing to rename or remove: the icons go, and Restore is offered.
    expect(screen.queryByRole('button', { name: /^Rename client/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove client/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore client' }))
    expect(await screen.findByText('1 site restored.')).toBeInTheDocument()
    expect(calls.map((c) => c.call)).toEqual(['POST /api/clients/c1/restore'])
  })
})

describe('Client page access (CP-18)', () => {
  it('is for risk engineers only', async () => {
    gateway({ page: page() })
    window.history.replaceState(null, '', '/clients/c1')
    render(<App />)
    await signIn('knowledge_admin')
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()
  })
})

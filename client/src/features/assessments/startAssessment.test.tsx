import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

// Deliberately differs from the demo data, so passing tests prove the capture
// screen names the assessment from the server response.
const CAPTURE = {
  session: {
    id: '6ab39017e45cf009e4507731',
    status: 'active',
    startedAt: '2026-09-23T08:38:47.442Z',
  },
  assessment: {
    id: '6ab39003058299a45f20c9d4',
    reference: 'RPT-2026-0411',
    client: 'Harbourside Foods',
    site: { code: 'SYN-SG-HCS', name: 'Harbourside Cold Store' },
  },
}
const CAPTURE_URL = '/api/assessments/RPT-2026-0411/capture-session'

function respond(status: number, body: unknown = CAPTURE) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}
// The dashboard's GET of the work list is answered by listReply, so fetchMock
// sees only the POSTs a test queues. The list defaults to an unreachable gateway.
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'))
let listReply: () => Promise<Response> = unreachable
function mockGateway(...replies: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn()
  for (const reply of replies) fetchMock.mockImplementationOnce(reply)
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url === '/api/assessments/engineers'
      ? respond(200, [
          {
            id: '6ab39017e45cf009e4507731',
            name: 'Alex Rowe',
            staffId: 'MRE-0001',
            jobTitle: null,
          },
        ])
      : init?.method === 'GET'
        ? listReply()
        : fetchMock(url, init),
  )
  return fetchMock
}
async function openApp() {
  render(<App />)
  await signIn()
}
function openCapture() {
  fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
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
  listReply = unreachable
})

describe('Capture session (CP-01)', () => {
  it('starts a session only when capture opens', async () => {
    const fetchMock = mockGateway(() => respond(201))
    await openApp()
    expect(fetchMock).not.toHaveBeenCalled()

    openCapture()

    expect(await screen.findByText('Capture session started')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(CAPTURE_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('identifies the assessment from the session', async () => {
    mockGateway(() => respond(201))
    await openApp()

    openCapture()

    const notice = await screen.findByRole('status')
    await screen.findByText('Capture session started')
    // The live light sits beside Site observation in the navigation.
    expect(screen.getByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(notice).toHaveTextContent('Harbourside Cold Store · Harbourside Foods · RPT-2026-0411')
    expect(notice).toHaveTextContent(/Started \d{2} [A-Z][a-z]{2} \d{2}:\d{2}\./)
    expect(notice).toHaveTextContent('Notes and recordings are stored on the server')
    expect(
      screen.getByText('Harbourside Cold Store · RPT-2026-0411 · 3 observations captured'),
    ).toBeInTheDocument()
  })

  it('resumes the session in progress when capture reopens', async () => {
    const fetchMock = mockGateway(
      () => respond(201),
      () => respond(200),
    )
    await openApp()
    openCapture()
    await screen.findByText('Capture session started')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Back on the dashboard, only its own gateway notice may show.
    expect(screen.queryByText('Capture session started')).not.toBeInTheDocument()
    openCapture()

    expect(await screen.findByText('Capture session resumed')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps sample data usable when the gateway cannot be reached, then retries', async () => {
    const fetchMock = mockGateway(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => respond(201),
    )
    await openApp()
    openCapture()

    const notice = await screen.findByRole('status')
    await screen.findByText('Showing sample data')
    expect(screen.queryByRole('img', { name: 'live' })).not.toBeInTheDocument()
    expect(notice).toHaveTextContent(
      'No capture session was started: the gateway could not be reached.',
    )
    expect(
      screen.getByText('Tilbury Distribution Centre · RPT-2026-0411 · 3 observations captured'),
    ).toBeInTheDocument()
    // Without the gateway, the sample assessment offers its sample locations.
    fireEvent.click(screen.getByRole('button', { name: /^Pump house/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Offline sprinkler observation' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    expect(screen.getByText('Offline sprinkler observation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Capture session started')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    [502, 'the gateway could not be reached', 'Start the gateway'],
    [404, 'RPT-2026-0411 is not on the server', 'Seed the sample assessment or create a new one'],
    [500, 'the gateway returned HTTP 500', 'Check the gateway logs'],
  ])('explains an HTTP %i from the gateway', async (status, cause, next) => {
    mockGateway(() => respond(status, { error: 'unused' }))
    await openApp()

    openCapture()

    await screen.findByText('Showing sample data')
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(`No capture session was started: ${cause}.`)
    expect(notice).toHaveTextContent(next)
  })
})

const CREATED = {
  id: '6ab3a1c0e45cf009e4507801',
  reference: 'RPT-2026-0001',
  client: 'Straits Logistics',
  policyReference: null,
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  standards: ['FM Global 2-0', 'NFPA 13'],
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'not_started',
  createdAt: '2026-09-23T09:00:00.000Z',
  site: {
    code: 'SITE-0001',
    name: 'Jurong Distribution Hub',
    address: null,
    jurisdiction: 'MY',
    facilityType: 'Distribution warehouse',
  },
}
const CREATED_CAPTURE = {
  session: {
    id: '6ab3a1d0e45cf009e4507802',
    status: 'active',
    startedAt: '2026-09-23T09:05:00.000Z',
  },
  assessment: {
    id: CREATED.id,
    reference: 'RPT-2026-0001',
    client: 'Straits Logistics',
    site: { code: 'SITE-0001', name: 'Jurong Distribution Hub' },
  },
}
const LOADING_DOCK = { id: 'l1', name: 'Loading dock', floor: null }
const CREATED_NOTE = {
  id: '6ab3a1e0e45cf009e4507803',
  engineer: 'A. Rowe',
  copeDimension: 'Protection',
  standard: null,
  severity: 'high',
  location: { id: 'l1', name: 'Loading dock', floor: null },
  recordedAt: '2026-09-23T09:10:00.000Z',
  note: 'Sprinkler control valve chained open',
  recordings: [],
}

function createFromForm() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  fireEvent.change(screen.getByLabelText(/Site name/), {
    target: { value: 'Jurong Distribution Hub' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: /^Client/ }), {
    target: { value: 'Straits Logistics' },
  })
  fireEvent.change(screen.getByLabelText(/Jurisdiction/), { target: { value: 'MY' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
}
function openRow() {
  fireEvent.click(screen.getByRole('button', { name: /Jurong Distribution Hub/ }))
}

describe('Create assessment (CP-01)', () => {
  it('creates the assessment on the server and lists it', async () => {
    const fetchMock = mockGateway(() => respond(201, CREATED))
    await openApp()

    createFromForm()

    expect(
      await screen.findByText(
        'RPT-2026-0001 created for Jurong Distribution Hub. Open it from the list to capture observations on site.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Jurong Distribution Hub/ })).toHaveTextContent(
      'RPT-2026-0001',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/assessments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      site: {
        name: 'Jurong Distribution Hub',
        address: '',
        jurisdiction: 'MY',
        facilityType: 'Distribution warehouse',
      },
      client: 'Straits Logistics',
      policyReference: '',
      surveyType: 'Property risk survey',
      siteVisitDate: '2026-04-21',
      reportDueDate: '2026-05-02',
      standards: ['FM Global 2-0', 'NFPA 13'],
      engineerId: '6ab39017e45cf009e4507731',
    })
  })

  it('opens a created assessment in its workspace, then captures against it', async () => {
    const fetchMock = mockGateway(
      () => respond(201, CREATED),
      () => respond(201, CREATED_CAPTURE),
      () => respond(201, LOADING_DOCK),
      () => respond(201, CREATED_NOTE),
    )
    await openApp()
    createFromForm()
    await screen.findByText(/RPT-2026-0001 created/)

    openRow()

    expect(screen.getByRole('heading', { name: 'Jurong Distribution Hub' })).toBeInTheDocument()
    expect(screen.getByText(/^RPT-2026-0001 · Property risk survey/)).toHaveTextContent(
      /Report due 02 May 2026/,
    )
    // The overview shows this assessment's own record, not the demo's samples.
    expect(screen.getByText('Observations on file')).toBeInTheDocument()
    expect(screen.getAllByText('FM Global 2-0').length).toBeGreaterThan(0)
    expect(screen.queryByText('Tilbury survey 2023')).not.toBeInTheDocument()
    expect(screen.queryByText('Sections drafted')).not.toBeInTheDocument()

    openCapture()

    expect(await screen.findByText('Capture session started')).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/assessments/RPT-2026-0001/capture-session')
    expect(
      screen.getByText('Jurong Distribution Hub · RPT-2026-0001 · 0 observations captured'),
    ).toBeInTheDocument()
    expect(screen.getByText('No observations captured for RPT-2026-0001 yet.')).toBeInTheDocument()

    // A new assessment has no locations yet, so capture starts by adding one.
    fireEvent.change(await screen.findByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Loading dock' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    expect(
      await screen.findByRole('button', { name: /Location: Loading dock/ }),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls[2][0]).toBe('/api/assessments/RPT-2026-0001/locations')

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Sprinkler control valve chained open' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    // With the session live, the observation is saved to the gateway (CP-02).
    expect(await screen.findByText('Observation saved to RPT-2026-0001.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[3][0]).toBe('/api/assessments/RPT-2026-0001/observations')
    expect(screen.getByText('Sprinkler control valve chained open')).toBeInTheDocument()
    expect(
      screen.getByText('Jurong Distribution Hub · RPT-2026-0001 · 1 observation captured'),
    ).toBeInTheDocument()
  })

  it('shows the reasons when the server rejects the details', async () => {
    mockGateway(() =>
      respond(400, {
        error: 'The assessment details are invalid.',
        fields: { reportDueDate: 'The report due date must be on or after the site visit date.' },
      }),
    )
    await openApp()

    createFromForm()

    expect(
      await screen.findByText(
        'The report due date must be on or after the site visit date. Correct the details above, then create the assessment again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create assessment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create assessment' })).toBeEnabled()
  })

  it('sends one request when Create is clicked twice', async () => {
    let reply: (response: Response) => void = () => {}
    const fetchMock = mockGateway(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve
        }),
    )
    await openApp()

    createFromForm()
    const busy = screen.getByRole('button', { name: 'Creating assessment…' })
    fireEvent.click(busy)

    expect(busy).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    reply(
      new Response(JSON.stringify(CREATED), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await screen.findByText(/RPT-2026-0001 created/)).toBeInTheDocument()
  })

  it('keeps a demo-only assessment when the gateway is unreachable, and opens its workspace', async () => {
    mockGateway(() => Promise.reject(new TypeError('Failed to fetch')))
    await openApp()

    createFromForm()

    expect(
      await screen.findByText(
        'The gateway could not be reached, so RPT-2026-0416 exists only in this demo and is not saved.',
      ),
    ).toBeInTheDocument()
    openRow()
    expect(screen.getByRole('heading', { name: 'Jurong Distribution Hub' })).toBeInTheDocument()
  })
})

describe('Work list (RV-10)', () => {
  const LIST = [
    { ...CREATED, status: 'capturing' },
    {
      ...CREATED,
      id: '6ab3a1c0e45cf009e4507899',
      reference: 'RPT-2026-0002',
      client: 'Harbourside Foods',
      siteVisitDate: null,
      engineer: { id: '6ab39017e45cf009e4507732', name: 'Jide Okafor' },
      status: 'under_review',
      site: { ...CREATED.site, code: 'SITE-0002', name: 'Harbourside Cold Store' },
    },
  ]
  const results = () => screen.getByText(/of \d+ assessments/)
  const search = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value },
    })

  it('lists the assessments assigned to you with their site, date and status', async () => {
    listReply = () => respond(200, LIST)
    mockGateway()
    await openApp()

    const row = await screen.findByRole('button', { name: /Jurong Distribution Hub/ })
    expect(row).toHaveTextContent('RPT-2026-0001')
    expect(row).toHaveTextContent('21 Apr 2026')
    expect(row).toHaveTextContent('Capturing')
    expect(screen.getByRole('button', { name: /Harbourside Cold Store/ })).toHaveTextContent(
      'Unscheduled',
    )
    expect(results()).toHaveTextContent('2 of 2 assessments')
    expect(screen.queryByText('Someone Else Depot')).not.toBeInTheDocument()
    // The tiles come before the table, which also shows status names.
    const tile = (label: string) => screen.getAllByText(label)[0].parentElement
    expect(tile('Outstanding review items')).toHaveTextContent('0')
    expect(tile('Under review')).toHaveTextContent('1')
    expect(tile('Observations not yet filed')).toHaveTextContent('0')
  })

  it('filters by status and searches by site and client', async () => {
    listReply = () => respond(200, LIST)
    mockGateway()
    await openApp()
    await screen.findByRole('button', { name: /Jurong Distribution Hub/ })

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'Under review' },
    })
    expect(results()).toHaveTextContent('1 of 2 assessments')
    expect(screen.queryByRole('button', { name: /Jurong/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'All statuses' },
    })
    search('jurong')
    expect(results()).toHaveTextContent('1 of 2 assessments')
    search('harbourside foods')
    expect(screen.getByRole('button', { name: /Harbourside Cold Store/ })).toBeInTheDocument()
    expect(results()).toHaveTextContent('1 of 2 assessments')
  })

  it('shows the sample assessments when the gateway cannot be reached', async () => {
    mockGateway()
    await openApp()

    expect(await screen.findByText('Showing sample assessments')).toBeInTheDocument()
    expect(results()).toHaveTextContent('6 of 6 assessments')
  })
})

it('assigns one engineer by ID and keeps work assigned to someone else out of my list', async () => {
  const me = '6ab39017e45cf009e4507731'
  const other = '6ab39017e45cf009e4507732'
  let submitted: { engineerId: string } | undefined
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/assessments/engineers')
      return respond(200, [
        { id: me, name: 'Alex Rowe', staffId: 'MRE-0001', jobTitle: null },
        { id: other, name: 'Jide Okafor', staffId: 'MRE-0002', jobTitle: null },
      ])
    if (init?.method === 'GET') return respond(200, [])
    submitted = JSON.parse(String(init?.body))
    return respond(201, { ...CREATED, engineer: { id: other, name: 'Jide Okafor' } })
  })
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  expect(await screen.findByRole('radio', { name: /Alex Rowe/ })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: /Jide Okafor/ }))
  expect(screen.getByRole('radio', { name: /Alex Rowe/ })).not.toBeChecked()
  fireEvent.change(screen.getByLabelText(/Site name/), { target: { value: CREATED.site.name } })
  fireEvent.change(screen.getByRole('textbox', { name: /^Client/ }), {
    target: { value: CREATED.client },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
  await screen.findByText(/It will appear in the assigned engineer’s work list/)
  expect(submitted?.engineerId).toBe(other)
  expect(screen.queryByRole('button', { name: /Jurong Distribution Hub/ })).not.toBeInTheDocument()
})

it('reloads the engineer directory after failure and preserves the selected engineer', async () => {
  let reply: (response: Response) => void = () => {}
  const directory = vi
    .fn()
    .mockImplementationOnce(() => respond(503, { error: 'Unavailable' }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve
        }),
    )
  vi.stubGlobal('fetch', (url: string) =>
    url === '/api/assessments/engineers' ? directory() : respond(200, []),
  )
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  await screen.findByText('Engineer list unavailable')
  fireEvent.change(screen.getByLabelText(/Site name/), { target: { value: 'Retained site' } })

  fireEvent.click(screen.getAllByRole('button', { name: /^Dashboard/ })[0])
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  expect(screen.getByText('Loading engineers…')).toBeInTheDocument()
  expect(screen.queryByText('Engineer list unavailable')).not.toBeInTheDocument()
  reply(
    await respond(200, [
      { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe', staffId: 'MRE-0001', jobTitle: null },
    ]),
  )

  expect(await screen.findByRole('radio', { name: /Alex Rowe/ })).toBeChecked()
  expect(screen.getByLabelText(/Site name/)).toHaveValue('Retained site')
  expect(screen.queryByText('Loading engineers…')).not.toBeInTheDocument()
  expect(directory).toHaveBeenCalledTimes(2)
})

it('shows report deadlines, excludes today and finalised work from overdue, and sorts with filters', async () => {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const deadlines = [null, '2099-12-31', today, '2000-01-01', '2001-01-01']
  const names = ['Undated', 'Future', 'Today', 'Overdue', 'Finalised']
  listReply = () =>
    respond(
      200,
      deadlines.map((due, i) => ({
        ...CREATED,
        id: `deadline-${i}`,
        reference: `RPT-DEADLINE-${i}`,
        site: { ...CREATED.site, name: `Deadline ${names[i]}` },
        reportDueDate: due,
        status: i === 4 ? 'finalised' : 'capturing',
      })),
    )
  mockGateway()
  await openApp()
  await screen.findByRole('button', { name: /Deadline Undated/ })
  const overdue = screen.getByRole('button', { name: /Deadline Overdue/ })
  expect(within(overdue).getByText('Overdue')).toBeInTheDocument()
  for (const name of ['Undated', 'Future', 'Today', 'Finalised']) {
    expect(
      within(screen.getByRole('button', { name: new RegExp(`Deadline ${name}`) })).queryByText(
        'Overdue',
      ),
    ).not.toBeInTheDocument()
  }
  const order = () =>
    screen.getAllByRole('button', { name: /^Deadline/ }).map((row) => row.getAttribute('data-id'))
  expect(order()).toEqual([0, 1, 2, 3, 4].map((i) => `RPT-DEADLINE-${i}`))
  const sort = screen.getByLabelText('Sort assessments')
  fireEvent.change(sort, { target: { value: 'Report due: earliest first' } })
  expect(order()).toEqual([3, 4, 2, 1, 0].map((i) => `RPT-DEADLINE-${i}`))
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Capturing' } })
  fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
    target: { value: 'Deadline' },
  })
  expect(order()).toEqual([3, 2, 1, 0].map((i) => `RPT-DEADLINE-${i}`))
  fireEvent.change(sort, { target: { value: 'Latest site visit' } })
  expect(order()).toEqual([0, 1, 2, 3].map((i) => `RPT-DEADLINE-${i}`))
})

it('archives my assessment from its workspace, then shows it only under Archived and restores it (RV-10 AC8, AC9)', async () => {
  let status = 'capturing'
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  )
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url === '/api/assessments'
      ? respond(200, [{ ...CREATED, status }])
      : (init?.method ?? 'GET') === 'GET'
        ? respond(200, [])
        : fetchMock(url, init),
  )
  await openApp()
  fireEvent.click(await screen.findByRole('button', { name: /Jurong Distribution Hub/ }))
  expect(screen.getAllByRole('button', { name: /^Site observation/ })).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
  const dialog = screen.getByRole('dialog', { name: 'Archive this assessment?' })
  status = 'archived'
  fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))

  await screen.findByText(/RPT-2026-0001 archived/)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/assessments/RPT-2026-0001/archive',
    expect.anything(),
  )
  // Hidden under All statuses, listed under Archived.
  await screen.findByText(/0 of 1 assessments/)
  expect(screen.queryByRole('button', { name: /Jurong Distribution Hub/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Archived' } })
  fireEvent.click(screen.getByRole('button', { name: /Jurong Distribution Hub/ }))

  // An archived workspace offers neither capture nor another archive.
  // Neither the header button nor the side navigation offers capture.
  expect(screen.queryAllByRole('button', { name: /^Site observation/ })).toHaveLength(0)
  expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()

  // Restore (AC9) returns it to the work list with the status it had.
  status = 'capturing'
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await screen.findByText(/RPT-2026-0001 restored to your work list/)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/assessments/RPT-2026-0001/restore',
    expect.anything(),
  )
  fireEvent.change(screen.getByLabelText('Filter by status'), {
    target: { value: 'All statuses' },
  })
  await screen.findByText(/1 of 1 assessments/)
  const row = screen
    .getAllByRole('button', { name: /Jurong Distribution Hub/ })
    .find((b) => b.getAttribute('data-id') === 'RPT-2026-0001')
  expect(row).toHaveTextContent('Capturing')
})

it('offers Archive on the demo assessment too, from its saved record', async () => {
  listReply = () =>
    respond(200, [
      {
        ...CREATED,
        reference: 'RPT-2026-0411',
        site: { ...CREATED.site, name: 'Tilbury Distribution Centre' },
      },
    ])
  mockGateway()
  await openApp()
  const tilbury = (
    await screen.findAllByRole('button', { name: /Tilbury Distribution Centre/ })
  ).find((b) => b.getAttribute('data-id') === 'RPT-2026-0411')!
  fireEvent.click(tilbury)
  expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
})

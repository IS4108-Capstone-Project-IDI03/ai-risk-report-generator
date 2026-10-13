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
// Opens or closes the assessment header's ⋯ menu.
const moreActions = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
function openCapture() {
  // Open the assessment from the work list; Add observation is its header's action.
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
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

    // The live light sits beside the assessment in the navigation's Recent list.
    expect(await screen.findByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(CAPTURE_URL, expect.objectContaining({ method: 'POST' }))
    // A session that started needs no notice.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('identifies the assessment from the session', async () => {
    mockGateway(() => respond(201))
    await openApp()

    openCapture()

    await screen.findByRole('img', { name: 'live' })
    // The workspace header names the assessment the session is for.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Harbourside Cold Store')
    expect(screen.getByRole('heading', { name: 'New observation' })).toBeInTheDocument()
  })

  it('waits for the session before saving, so nothing stays in the browser by mistake', async () => {
    let start: (response: Response) => void = () => {}
    mockGateway(() => new Promise<Response>((resolve) => (start = resolve)))
    await openApp()

    openCapture()

    const save = screen.getByRole('button', { name: 'Save observation' })
    expect(save).toBeDisabled()
    start(await respond(201))
    await vi.waitFor(() => expect(save).toBeEnabled())
    expect(screen.getByRole('img', { name: 'live' })).toBeInTheDocument()
  })

  it('resumes the session in progress when capture reopens', async () => {
    const fetchMock = mockGateway(
      () => respond(201),
      () => respond(200),
    )
    await openApp()
    openCapture()
    await screen.findByRole('img', { name: 'live' })

    fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }))
    expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
    openCapture()

    // The same session carries on, with no notice either way.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Tilbury Distribution Centre',
    )
    // The Observations tab, still on show, counts what is saved.
    expect(screen.getByRole('tab', { name: 'Observations 3' })).toBeInTheDocument()
    // Without the gateway, the sample assessment offers its sample locations,
    // by building, then elsewhere on site (CP-16).
    fireEvent.click(screen.getByRole('button', { name: /^Elsewhere on site/, expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: /^Elsewhere on site · Pump house/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Offline sprinkler observation' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Moderate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    expect(
      screen.getByText('Observation added to RPT-2026-0411. It is kept in this demo only.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Observations 4' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    // Once the session starts, the warning goes.
    expect(await screen.findByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(screen.queryByText('Showing sample data')).not.toBeInTheDocument()
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
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
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
const LOADING_DOCK = { id: 'l1', building: 'Warehouse', name: 'Loading dock', floor: 'Ground' }
const CREATED_NOTE = {
  id: '6ab3a1e0e45cf009e4507803',
  engineer: 'A. Rowe',
  copeDimensions: ['Protection'],
  standard: null,
  severity: 'high',
  location: LOADING_DOCK,
  recordedAt: '2026-09-23T09:10:00.000Z',
  note: 'Sprinkler control valve chained open',
  recordings: [],
  photos: [],
  removedRecordings: [],
  removedPhotos: [],
}

// A local calendar day as YYYY-MM-DD, a number of days from today.
function localDay(days = 0) {
  const day = new Date()
  day.setDate(day.getDate() + days)
  return day.toLocaleDateString('en-CA')
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
      await screen.findByText('RPT-2026-0001 created for Jurong Distribution Hub.'),
    ).toBeInTheDocument()
    // It opens on its Overview, ready to capture, rather than back on the list.
    expect(screen.getByRole('heading', { name: 'Jurong Distribution Hub' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Add observation' })).toBeInTheDocument()
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
      surveyType: 'Property risk survey',
      // A new form is dated today, its report due in two weeks.
      siteVisitDate: localDay(),
      reportDueDate: localDay(14),
      engineerId: '6ab39017e45cf009e4507731',
    })

    // The next assessment starts from a blank form, not this one's details.
    // New assessment is the Dashboard's action.
    fireEvent.click(screen.getByRole('button', { name: /^Dashboard/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
    expect(screen.getByLabelText(/Site name/)).toHaveValue('')
    expect(screen.getByRole('textbox', { name: /^Client/ })).toHaveValue('')
    expect(screen.getByLabelText(/Jurisdiction/)).toHaveValue('SG')
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
    // Only the name heads the page: no status beside it and no details below;
    // they are in the Overview.
    expect(screen.queryByText(/Property risk survey ·/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Jurong Distribution Hub' }).parentElement,
    ).not.toHaveTextContent('RPT-2026-0001')
    // The overview shows this assessment's own record, not the demo's samples.
    expect(screen.getByRole('group', { name: 'Capture' })).toBeInTheDocument()
    expect(screen.queryByText('Tilbury survey 2023')).not.toBeInTheDocument()
    expect(screen.queryByText('Sections drafted')).not.toBeInTheDocument()

    // With nothing captured yet, its Observations tab offers to add one too.
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    expect(screen.getByText('No observations yet')).toBeInTheDocument()
    const [, addFromList] = screen.getAllByRole('button', { name: 'Add observation' })
    fireEvent.click(addFromList)

    expect(await screen.findByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/assessments/RPT-2026-0001/capture-session')
    // Capture keeps the workspace's header, which names the assessment.
    expect(screen.getByRole('heading', { name: 'New observation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jurong Distribution Hub')
    expect(screen.getByRole('tab', { name: 'Observations 0' })).toBeInTheDocument()

    // A new assessment has no locations yet, so capture starts by adding one:
    // in a building, with its level (CP-16).
    expect(
      await screen.findByText(
        'Add the first location you’re inspecting. Observations are saved to it.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'In a building' })).toBeChecked()
    for (const [field, value] of [
      [/^Building/, 'Warehouse'],
      [/^Level/, 'Ground'],
      [/^Location/, 'Loading dock'],
    ] as const)
      fireEvent.change(screen.getByLabelText(field), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    expect(
      await screen.findByRole('button', { name: /Location: Warehouse · Ground · Loading dock/ }),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls[2][0]).toBe('/api/assessments/RPT-2026-0001/locations')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      building: 'Warehouse',
      floor: 'Ground',
      name: 'Loading dock',
    })

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Sprinkler control valve chained open' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    // With the session live, the observation is saved to the gateway (CP-02).
    expect(await screen.findByText('Observation saved to RPT-2026-0001.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[3][0]).toBe('/api/assessments/RPT-2026-0001/observations')
    expect(screen.getByRole('tab', { name: 'Observations 1' })).toBeInTheDocument()

    // Back on the Observations tab, it is listed.
    fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }))
    expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
    expect(screen.getByText('Sprinkler control valve chained open')).toBeInTheDocument()
    expect(screen.queryByText('No observations yet')).not.toBeInTheDocument()
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

    // A row's name starts with its site; Continue capture names it later on.
    const row = await screen.findByRole('button', { name: /^Jurong Distribution Hub/ })
    expect(row).toHaveTextContent('RPT-2026-0001')
    expect(row).toHaveTextContent('21 Apr 2026')
    expect(row).toHaveTextContent('Capturing')
    expect(screen.getByRole('button', { name: /Harbourside Cold Store/ })).toHaveTextContent(
      'Unscheduled',
    )
    expect(results()).toHaveTextContent('2 of 2 assessments')
    expect(screen.queryByText('Someone Else Depot')).not.toBeInTheDocument()
  })

  it('counts overdue reports, reports due soon and site visits soon, and filters by each box', async () => {
    const inDays = (days: number) => {
      const day = new Date()
      day.setDate(day.getDate() + days)
      return day.toLocaleDateString('en-CA')
    }
    // [site, report due, site visit, status]: finalised and archived work is
    // never counted, and within 7 days runs from today to a week from today.
    const cases: [string, number, number, string][] = [
      ['Late', -2, -20, 'draft'],
      ['Soon', 3, -5, 'capturing'],
      ['Today', 0, 0, 'capturing'],
      ['Visit', 30, 7, 'not_started'],
      ['Far', 8, 8, 'not_started'],
      ['Done', -2, 1, 'finalised'],
      ['Shelved', -2, 2, 'archived'],
    ]
    listReply = () =>
      respond(
        200,
        cases.map(([name, due, visit, status], i) => ({
          ...CREATED,
          id: `case-${i}`,
          reference: `RPT-CASE-${i}`,
          site: { ...CREATED.site, name: `Case ${name}` },
          reportDueDate: inDays(due),
          siteVisitDate: inDays(visit),
          status,
        })),
      )
    mockGateway()
    await openApp()
    await screen.findByRole('button', { name: /^Case Late/ })
    const overdue = screen.getByRole('button', {
      name: 'Overdue, 1, report past due. Show only these',
    })
    const dueSoon = screen.getByRole('button', {
      name: 'Due soon, 2, reports due within 7 days. Show only these',
    })
    const visits = screen.getByRole('button', {
      name: 'Site visits, 2, visits within 7 days. Show only these',
    })
    const shown = () =>
      screen.getAllByRole('button', { name: /^Case/ }).map((row) => row.getAttribute('data-id'))
    expect(results()).toHaveTextContent('6 of 7 assessments')
    for (const box of [overdue, dueSoon, visits])
      expect(box).toHaveAttribute('aria-pressed', 'false')

    // Each row counts down to its report due date, or is marked overdue.
    const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^Case ${name}`) })
    expect(within(row('Late')).getByText('Overdue')).toBeInTheDocument()
    expect(row('Soon')).toHaveTextContent('Due in 3 days')
    expect(row('Today')).toHaveTextContent('Due today')
    expect(row('Far')).toHaveTextContent('Due in 8 days')
    expect(row('Done')).not.toHaveTextContent(/Due|Overdue/)

    fireEvent.click(overdue)
    expect(overdue).toHaveAttribute('aria-pressed', 'true')
    expect(shown()).toEqual(['RPT-CASE-0'])
    expect(results()).toHaveTextContent('1 of 7 assessments')

    // Selecting another box moves the filter to it.
    fireEvent.click(dueSoon)
    expect(overdue).toHaveAttribute('aria-pressed', 'false')
    expect(dueSoon).toHaveAttribute('aria-pressed', 'true')
    expect(shown()).toEqual(['RPT-CASE-2', 'RPT-CASE-1'])

    fireEvent.click(visits)
    expect(shown()).toEqual(['RPT-CASE-3', 'RPT-CASE-2'])

    // Selecting the ticked box again shows every assessment.
    fireEvent.click(visits)
    expect(visits).toHaveAttribute('aria-pressed', 'false')
    expect(results()).toHaveTextContent('6 of 7 assessments')
  })

  it('filters by status and searches by site and client', async () => {
    listReply = () => respond(200, LIST)
    mockGateway()
    await openApp()
    await screen.findByRole('button', { name: /^Jurong Distribution Hub/ })

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'Under review' },
    })
    expect(results()).toHaveTextContent('1 of 2 assessments')
    expect(screen.queryByRole('button', { name: /^Jurong/ })).not.toBeInTheDocument()

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
  // Assigned to me until I choose someone else, whom I find by searching.
  expect(await screen.findByText('Alex Rowe (you)')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search engineers' }), {
    target: { value: 'jide' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Jide Okafor/ }))
  expect(screen.getByText('Jide Okafor')).toBeInTheDocument()
  expect(screen.queryByText('Alex Rowe (you)')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/Site name/), { target: { value: CREATED.site.name } })
  fireEvent.change(screen.getByRole('textbox', { name: /^Client/ }), {
    target: { value: CREATED.client },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
  await screen.findByText(/It will appear in the assigned engineer’s work list/)
  expect(submitted?.engineerId).toBe(other)
  expect(screen.queryByRole('button', { name: /Jurong Distribution Hub/ })).not.toBeInTheDocument()
})

it('lists engineers only as search matches, by name, staff ID or job title', async () => {
  vi.stubGlobal('fetch', (url: string) =>
    url === '/api/assessments/engineers'
      ? respond(200, [
          {
            id: '6ab39017e45cf009e4507731',
            name: 'Alex Rowe',
            staffId: 'MRE-0001',
            jobTitle: null,
          },
          {
            id: '6ab39017e45cf009e4507732',
            name: 'Jide Okafor',
            staffId: 'MRE-0002',
            jobTitle: 'Senior risk engineer',
          },
          {
            id: '6ab39017e45cf009e4507733',
            name: 'Mei Tan',
            staffId: 'MRE-0003',
            jobTitle: 'Risk engineer',
          },
          ...Array.from({ length: 9 }, (_, n) => ({
            id: `6ab39017e45cf009e450775${n}`,
            name: `Field Engineer ${n + 1}`,
            staffId: `MRE-01${n + 1}0`,
            jobTitle: 'Graduate engineer',
          })),
        ])
      : respond(200, []),
  )
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  // Only the assigned engineer shows until a search.
  expect(await screen.findByText('Alex Rowe (you)')).toBeInTheDocument()
  const matches = () => screen.queryByRole('list', { name: 'Matching engineers' })
  const match = (name: RegExp) => within(matches()!).queryByRole('button', { name })
  expect(matches()).not.toBeInTheDocument()
  const searchBox = screen.getByRole('searchbox', { name: 'Search engineers' })
  const search = (value: string) => fireEvent.change(searchBox, { target: { value } })

  search('jide')
  expect(match(/Jide Okafor/)).toBeInTheDocument()
  expect(match(/Mei Tan/)).not.toBeInTheDocument()
  expect(screen.getByText('1 match')).toBeInTheDocument()

  search('mre-0003')
  expect(match(/Mei Tan/)).toBeInTheDocument()
  expect(match(/Jide Okafor/)).not.toBeInTheDocument()

  search('SENIOR')
  expect(match(/Jide Okafor/)).toBeInTheDocument()
  expect(match(/Mei Tan/)).not.toBeInTheDocument()

  // A broad search lists at most eight and asks for more letters.
  search('engineer')
  expect(within(matches()!).getAllByRole('button')).toHaveLength(8)
  expect(
    screen.getByText('Showing 8 of 11 matches. Keep typing to narrow it down.'),
  ).toBeInTheDocument()

  // The assigned engineer shows as chosen among the matches.
  search('alex')
  expect(match(/Alex Rowe \(you\)/)).toHaveAttribute('aria-pressed', 'true')

  // Choosing closes the matches and keeps focus in the search.
  search('jide')
  fireEvent.click(match(/Jide Okafor/)!)
  expect(matches()).not.toBeInTheDocument()
  expect(searchBox).toHaveValue('')
  expect(searchBox).toHaveFocus()
  expect(screen.getByText('Jide Okafor')).toBeInTheDocument()
  expect(screen.queryByText('Alex Rowe (you)')).not.toBeInTheDocument()

  search('zzz')
  expect(screen.getByText('No engineer matches "zzz".')).toBeInTheDocument()
  expect(screen.getByText('Jide Okafor')).toBeInTheDocument()

  search('')
  expect(matches()).not.toBeInTheDocument()
  expect(screen.queryByText(/No engineer matches/)).not.toBeInTheDocument()
})

it('dates a new form today with its report due in two weeks, and keeps a blank one current', async () => {
  // Late in the month, so the due date falls in the next one.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 25, 9, 0) })
  try {
    mockGateway()
    await openApp()
    const openForm = () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Dashboard/ })[0])
      fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
    }
    const visit = () => screen.getByLabelText(/Site visit date/)
    const due = () => screen.getByLabelText(/Report due/)
    openForm()
    expect(visit()).toHaveValue('2026-10-25')
    expect(due()).toHaveValue('2026-11-08')

    // Left blank in a tab overnight, it opens on the next day's dates.
    vi.setSystemTime(new Date(2026, 9, 26, 9, 0))
    openForm()
    expect(visit()).toHaveValue('2026-10-26')
    expect(due()).toHaveValue('2026-11-09')

    // One the engineer has started keeps its dates.
    fireEvent.change(screen.getByLabelText(/Site name/), { target: { value: 'Draft site' } })
    vi.setSystemTime(new Date(2026, 9, 27, 9, 0))
    openForm()
    expect(screen.getByLabelText(/Site name/)).toHaveValue('Draft site')
    expect(visit()).toHaveValue('2026-10-26')
    expect(due()).toHaveValue('2026-11-09')
  } finally {
    vi.useRealTimers()
  }
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

  expect(await screen.findByText('Alex Rowe (you)')).toBeInTheDocument()
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
  await screen.findByRole('button', { name: /^Deadline Undated/ })
  const overdue = screen.getByRole('button', { name: /^Deadline Overdue/ })
  expect(within(overdue).getByText('Overdue')).toBeInTheDocument()
  for (const name of ['Undated', 'Future', 'Today', 'Finalised']) {
    expect(
      within(screen.getByRole('button', { name: new RegExp(`^Deadline ${name}`) })).queryByText(
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
  fireEvent.click(await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }))
  // Add observation is the page header's action; the navigation lists the assessment
  // under Recent.
  expect(screen.getByRole('button', { name: 'Jurong Distribution Hub' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(screen.getByRole('button', { name: 'Add observation' })).toBeInTheDocument()

  // Archive is one of the occasional actions behind More actions.
  moreActions()
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
  expect(screen.queryByRole('button', { name: 'Add observation' })).not.toBeInTheDocument()
  moreActions()
  expect(screen.getByRole('button', { name: 'Version history' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  moreActions()

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
  const tilburyRecord = {
    ...CREATED,
    reference: 'RPT-2026-0411',
    site: { ...CREATED.site, name: 'Tilbury Distribution Centre' },
  }
  // The work list gets Tilbury's saved record; its observations and locations are empty.
  vi.stubGlobal('fetch', (url: string) =>
    respond(200, url === '/api/assessments' ? [tilburyRecord] : []),
  )
  await openApp()
  const tilbury = (
    await screen.findAllByRole('button', { name: /Tilbury Distribution Centre/ })
  ).find((b) => b.getAttribute('data-id') === 'RPT-2026-0411')!
  fireEvent.click(tilbury)
  moreActions()
  expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
})

it('edits my assessment details, keeping its engineer (RV-10 AC10, AC11)', async () => {
  let record = { ...CREATED }
  const saves: { body: Record<string, unknown>; reply: Response }[] = []
  const rejection = new Response(
    JSON.stringify({
      error: 'The assessment details are invalid.',
      fields: { reportDueDate: 'The report due date must be on or after the site visit date.' },
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      const reply = saves.length ? new Response(null, { status: 204 }) : rejection
      saves.push({ body, reply })
      if (reply.status === 204) record = { ...record, client: body.client }
      return Promise.resolve(reply)
    }
    return respond(200, url === '/api/assessments' ? [record] : [])
  })
  await openApp()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === 'RPT-2026-0001',
  )!
  fireEvent.click(row)
  // The record shows the site's address and jurisdiction.
  expect(screen.getByText('Site address')).toBeInTheDocument()
  expect(screen.getByText('Not recorded')).toBeInTheDocument()
  expect(screen.getByText('Malaysia')).toBeInTheDocument()

  // Cancel returns to the workspace's Overview.
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('heading', { name: 'Jurong Distribution Hub' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
  // The form starts from the saved details, without the engineer.
  expect(screen.getByRole('heading', { name: 'Edit assessment details' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /^Client/ })).toHaveValue('Straits Logistics')
  expect(screen.queryByRole('searchbox', { name: 'Search engineers' })).not.toBeInTheDocument()

  fireEvent.change(screen.getByRole('textbox', { name: /^Client/ }), {
    target: { value: 'Straits Freight' },
  })
  // A rejected save names the problem and keeps the changes (AC11).
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText(/Changes not saved/)).toBeInTheDocument()
  expect(screen.getByText(/on or after the site visit date/)).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /^Client/ })).toHaveValue('Straits Freight')

  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('Details saved for RPT-2026-0001.')
  expect(saves[1].body).toMatchObject({ client: 'Straits Freight' })
  expect(saves[1].body).not.toHaveProperty('engineerId')
  // Back in the workspace, the record shows the saved details (AC10).
  expect(screen.getByRole('heading', { name: 'Jurong Distribution Hub' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getAllByText('Straits Freight').length).toBeGreaterThan(0)

  // A new assessment then starts from a blank form, not the edited details.
  fireEvent.click(screen.getByRole('button', { name: /^Dashboard/ }))
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  expect(screen.getByRole('textbox', { name: /^Client/ })).toHaveValue('')
  expect(screen.getByRole('heading', { name: 'Create assessment' })).toBeInTheDocument()
})

it('shows a knowledge admin the same assessment record, read-only', async () => {
  vi.stubGlobal('fetch', (url: string) =>
    respond(200, url === '/api/assessments' ? [{ ...CREATED, status: 'capturing' }] : []),
  )
  // A knowledge admin starts on the knowledge base; open the work list instead.
  window.history.pushState({}, '', '/assessments')
  try {
    render(<App />)
    await signIn('knowledge_admin')
    const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
      (b) => b.getAttribute('data-id') === 'RPT-2026-0001',
    )!
    fireEvent.click(row)

    expect(screen.getByText('Site address')).toBeInTheDocument()
    expect(screen.getByText('Malaysia')).toBeInTheDocument()
    expect(screen.getByText('Alex Rowe')).toBeInTheDocument()
    // Only the assigned engineer edits, archives or captures.
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add observation' })).not.toBeInTheDocument()
    moreActions()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  } finally {
    window.history.pushState({}, '', '/')
  }
})

it('offers no capture when none of my assessments is capturing, not even the demo one', async () => {
  vi.stubGlobal('fetch', (url: string) => respond(200, url === '/api/assessments' ? [CREATED] : []))
  await openApp()
  await screen.findByRole('button', { name: /^Jurong Distribution Hub/ })

  expect(screen.queryByRole('button', { name: /^Continue capture/ })).not.toBeInTheDocument()
  // Tilbury, the demo default, is not on this engineer's list, so nothing
  // opens it.
  expect(
    screen.queryByRole('button', { name: 'Tilbury Distribution Centre' }),
  ).not.toBeInTheDocument()
})

describe('Overview', () => {
  // A local calendar day, days from today, as the gateway stores due dates.
  const inDays = (days: number) => {
    const day = new Date()
    day.setDate(day.getDate() + days)
    return day.toLocaleDateString('en-CA')
  }
  const draft = { id: 'd1', sectionId: '7', subsections: [] }
  const SECTIONS = [
    {
      id: '7',
      title: 'Construction',
      minObservations: 1,
      usableObservations: 2,
      latestDraft: draft,
      changesSinceDraft: 0,
    },
    {
      id: '8',
      title: 'Occupancy',
      minObservations: 1,
      usableObservations: 1,
      latestDraft: draft,
      changesSinceDraft: 2,
    },
    {
      id: '9',
      title: 'Fire Protection',
      minObservations: 3,
      usableObservations: 1,
      latestDraft: null,
      changesSinceDraft: 0,
    },
    {
      id: '10',
      title: 'Natural Hazards',
      minObservations: 1,
      usableObservations: 1,
      latestDraft: null,
      changesSinceDraft: 0,
    },
  ].map((s) => ({ copeDimensions: [], changeCounts: { added: 0, changed: 0, removed: 0 }, ...s }))
  const review = (id: string, state: string, unsupportedStatements = 0, changesSinceDraft = 0) => ({
    id,
    draft: state === 'not_drafted' ? null : draft,
    review: { state, unsupportedStatements, withdrawnSources: 0, changesSinceDraft },
  })
  const REVIEW = {
    sections: [
      review('7', 'ai_draft'),
      review('8', 'needs_review', 3, 2),
      review('9', 'not_drafted'),
      review('10', 'not_drafted'),
    ],
  }

  async function openOverview(fields: object = {}) {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      // Opening capture starts its session.
      init?.method === 'POST'
        ? respond(201)
        : respond(
            200,
            url === '/api/assessments'
              ? [{ ...CREATED, status: 'capturing', reportDueDate: inDays(5), ...fields }]
              : url.endsWith('/sections')
                ? SECTIONS
                : url.endsWith('/review')
                  ? REVIEW
                  : [],
          ),
    )
    await openApp()
    fireEvent.click(await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }))
  }
  const box = (label: string) => screen.getByRole('group', { name: label })

  it('follows the report from capture to its due date, with each section’s state', async () => {
    await openOverview()

    expect(box('Capture')).toHaveTextContent('0observations')
    expect(box('Capture')).toHaveTextContent('None captured yet')
    // Over Marsh's 12 sections: Section 1 (always ready) and the two drafted here.
    expect(await screen.findByText('3/12')).toBeInTheDocument()
    expect(box('Drafting')).toHaveTextContent('sections drafted')
    expect(box('Drafting')).toHaveTextContent('1 out of date')
    expect(await screen.findByText('1/2')).toBeInTheDocument()
    expect(box('Review')).toHaveTextContent('drafts flagged')
    expect(box('Review')).toHaveTextContent('3 statements to check · 1 out of date')
    expect(box('Report due')).toHaveTextContent('5days left')

    const sections = screen.getByText('Report sections').parentElement!
    expect(
      within(sections).getByRole('button', { name: /^Section 7, Construction: Drafted/ }),
    ).toBeInTheDocument()
    expect(
      within(sections).getByRole('button', { name: /^Section 8, Occupancy: Out of date/ }),
    ).toBeInTheDocument()
    expect(
      within(sections).getByRole('button', {
        name: /^Section 9, Fire Protection: 1 of 3 observations/,
      }),
    ).toBeInTheDocument()
    expect(
      within(sections).getByRole('button', {
        name: /^Section 10, Natural Hazards: Ready to draft/,
      }),
    ).toBeInTheDocument()

    // The capture box opens the observations it counts; capturing is the
    // header's button, and the empty list's.
    fireEvent.click(screen.getByRole('button', { name: /^Capture, 0, observations/ }))
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getAllByRole('button', { name: 'Add observation' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add observation' })[0])
    expect(await screen.findByRole('heading', { name: 'New observation' })).toBeInTheDocument()
  })

  it('opens Generation from the drafting box', async () => {
    await openOverview()
    fireEvent.click(
      await screen.findByRole('button', {
        name: /^Drafting, 3\/12, sections drafted, 1 out of date\. Open Generation$/,
      }),
    )
    expect(screen.getByRole('tab', { name: /Generation/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('says when the report is overdue, and offers capture before any is captured', async () => {
    await openOverview({ status: 'not_started', reportDueDate: inDays(-2) })
    expect(box('Report due')).toHaveTextContent('2days overdue')
    expect(screen.getByRole('button', { name: 'Add observation' })).toBeInTheDocument()
  })

  it('says when no due date is set', async () => {
    await openOverview({ reportDueDate: null })
    expect(box('Report due')).toHaveTextContent('no due date set')
  })

  it('counts the observations saved on the server, as the report sections do', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      respond(
        200,
        url === '/api/assessments'
          ? [{ ...CREATED, status: 'capturing' }]
          : url.startsWith('/api/assessments/RPT-2026-0001/observations')
            ? [CREATED_NOTE, { ...CREATED_NOTE, id: '6ab3a1e0e45cf009e4507804' }]
            : [],
      ),
    )
    await openApp()
    fireEvent.click(await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }))
    expect(await within(box('Capture')).findByText('2')).toBeInTheDocument()
    expect(box('Capture')).toHaveTextContent('observations')
  })

  it('leaves the demo’s browser-only samples out of the count once it is on the server', async () => {
    const TILBURY = {
      ...CREATED,
      reference: 'RPT-2026-0411',
      status: 'capturing',
      site: { ...CREATED.site, name: 'Tilbury Distribution Centre' },
    }
    vi.stubGlobal('fetch', (url: string) =>
      respond(200, url === '/api/assessments' ? [TILBURY] : []),
    )
    await openApp()
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
    )
    // The samples still list on the Observations tab, but the server has none.
    expect(box('Capture')).toHaveTextContent('0observations')
  })

  it('says when the drafting service cannot be reached, keeping the rest', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      url === '/api/assessments'
        ? respond(200, [{ ...CREATED, status: 'capturing' }])
        : url.endsWith('/sections') || url.endsWith('/review')
          ? respond(503, { error: 'S4 unreachable' })
          : respond(200, []),
    )
    await openApp()
    fireEvent.click(await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }))

    expect(
      await screen.findByText('The report sections can’t be loaded right now.'),
    ).toBeInTheDocument()
    expect(box('Drafting')).toHaveTextContent('unavailable')
    expect(screen.getByRole('button', { name: 'Add observation' })).toBeInTheDocument()
  })
})

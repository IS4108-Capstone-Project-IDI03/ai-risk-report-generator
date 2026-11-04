import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    init?.method === 'GET' ? listReply() : fetchMock(url, init),
  )
  return fetchMock
}
async function openApp() {
  render(<App />)
  await signIn()
}
// Picks a choice from one of the work list's pills or menus (CP-23 screen 6A).
function choose(pill: string | RegExp, choice: string) {
  fireEvent.click(screen.getByRole('button', { name: pill }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: choice }))
}
function openCapture() {
  // Open the assessment from the work list; capture starts from its Observations tab.
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Add manually' }))
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
  }, 10000)

  it('identifies the assessment from the session', async () => {
    mockGateway(() => respond(201))
    await openApp()

    openCapture()

    await screen.findByRole('img', { name: 'live' })
    // The workspace header names the assessment the session is for.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Harbourside Cold Store')
    expect(screen.getByRole('heading', { name: 'New Observation' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Back to Observations' }))
    expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
    openCapture()

    // The same session carries on, with no notice either way.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  }, 10000)

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
    fireEvent.click(screen.getByRole('button', { name: /^Elsewhere on site › Pump house/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Offline sprinkler observation' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Moderate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    expect(screen.getByText('Observation saved in this demo only.')).toBeInTheDocument()
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
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
  },
}
// What creating answers since CP-23: the client and every assessment created.
const CREATED_REPLY = { clientId: 'c1', assessments: [CREATED] }
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

// Starts a new assessment from the form: New assessment opens a menu (CP-23 board 03).
function startFromForm() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
  fireEvent.click(screen.getByRole('button', { name: /^Fill in the form/ }))
}

// Fills in a new client's new site (its address now required, CP-23) and creates it.
function createFromForm() {
  startFromForm()
  fireEvent.change(screen.getByLabelText(/^Client name/), {
    target: { value: 'Straits Logistics' },
  })
  fireEvent.change(screen.getByLabelText(/^Site name/), {
    target: { value: 'Jurong Distribution Hub' },
  })
  fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: '2 Jurong Port Rd' } })
  fireEvent.change(screen.getByLabelText(/^Jurisdiction/), { target: { value: 'MY' } })
  // The facility type starts empty on the new form, so it is chosen here.
  fireEvent.change(screen.getByLabelText(/^Facility type/), {
    target: { value: 'Distribution warehouse' },
  })
  fireEvent.click(screen.getByRole('button', { name: CREATE_ONE }))
}
const CREATE_ONE = 'Create'
function openRow() {
  fireEvent.click(screen.getByRole('button', { name: /Jurong Distribution Hub/ }))
}

describe('Create assessment (CP-01)', () => {
  it('creates the assessment on the server and lists it', async () => {
    const fetchMock = mockGateway(() => respond(201, CREATED_REPLY))
    await openApp()

    createFromForm()

    expect(await screen.findByText('RPT-2026-0001 created')).toBeInTheDocument()
    // Back on the list (CP-23: one Create can make several), with the new one on it.
    expect(screen.getByRole('heading', { name: 'Assessments' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Jurong Distribution Hub/ })).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/assessments')
    expect(init.method).toBe('POST')
    // No engineer is sent: the gateway assigns the signed-in engineer (CP-23 AC10).
    expect(JSON.parse(init.body)).toEqual({
      client: { name: 'Straits Logistics' },
      sites: [
        {
          ref: expect.any(String),
          name: 'Jurong Distribution Hub',
          address: '2 Jurong Port Rd',
          jurisdiction: 'MY',
          facilityType: 'Distribution warehouse',
          assessments: [
            {
              ref: expect.any(String),
              // A new site's first visit is a First survey (CP-23 AC17).
              visitType: 'First survey',
              // A new form is dated today, its report due in two weeks.
              siteVisitDate: localDay(),
              reportDueDate: localDay(14),
              siteContacts: [],
            },
          ],
        },
      ],
    })

    // The next assessment starts from a blank form, not this one's details.
    // New assessment is the Dashboard's action.
    startFromForm()
    expect(screen.getByLabelText(/^Site name/)).toHaveValue('')
    expect(screen.getByLabelText(/^Client name/)).toHaveValue('')
    expect(screen.getByLabelText(/^Jurisdiction/)).toHaveValue('SG')
  })

  it('opens a created assessment in its workspace, then captures against it', async () => {
    const fetchMock = mockGateway(
      () => respond(201, CREATED_REPLY),
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
    fireEvent.click(screen.getByRole('button', { name: 'Add manually' }))

    expect(await screen.findByRole('img', { name: 'live' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/assessments/RPT-2026-0001/capture-session')
    // Capture keeps the workspace's header, which names the assessment.
    expect(screen.getByRole('heading', { name: 'New Observation' })).toBeInTheDocument()
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
      await screen.findByRole('button', { name: /Location: Warehouse › Ground › Loading dock/ }),
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
    expect(await screen.findByText('Observation saved.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[3][0]).toBe('/api/assessments/RPT-2026-0001/observations')
    expect(screen.getByRole('tab', { name: 'Observations 1' })).toBeInTheDocument()

    // Back on the Observations tab, it is listed.
    fireEvent.click(screen.getByRole('button', { name: 'Back to Observations' }))
    expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
    expect(screen.getByText('Sprinkler control valve chained open')).toBeInTheDocument()
    expect(screen.queryByText('No observations yet')).not.toBeInTheDocument()
  }, 10000)

  it('shows the reasons when the server rejects the details', async () => {
    mockGateway(() =>
      respond(400, {
        error: 'The assessment details are invalid.',
        fields: {
          'sites.0.assessments.0.reportDueDate':
            'The report due date must be on or after the site visit date.',
        },
      }),
    )
    await openApp()

    createFromForm()

    expect(
      await screen.findByText('The report due date must be on or after the site visit date.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^Report due/)).toHaveAttribute('aria-invalid', 'true')
    expect(await screen.findByText('Nothing created')).toBeInTheDocument()
    expect(screen.getByText('Correct the marked fields, then create again.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New Assessment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CREATE_ONE })).toBeEnabled()
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
    // The one Create button is busy (a spinner in place of its word) while the request is out.
    const busy = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(busy)

    expect(busy).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(busy)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    reply(
      new Response(JSON.stringify(CREATED_REPLY), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await screen.findByText(/RPT-2026-0001 created/)).toBeInTheDocument()
  })

  it('says nothing was created when the gateway is unreachable', async () => {
    mockGateway(() => Promise.reject(new TypeError('Failed to fetch')))
    await openApp()

    createFromForm()

    expect(await screen.findByText('Nothing created')).toBeInTheDocument()
    expect(
      await screen.findByText(/The gateway could not be reached\. Try again\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New Assessment' })).toBeInTheDocument()
  })
})

describe('A client’s sites (CP-17)', () => {
  const CLIENTS = [
    { id: 'c1', name: 'NUS', sites: 2 },
    { id: 'c2', name: 'Changi Airport Group', sites: 1 },
  ]
  const SITES = [
    {
      id: 's1',
      code: 'SITE-0007',
      name: 'Bukit Timah campus',
      address: null,
      jurisdiction: 'SG',
      facilityType: 'University campus',
      latest: null,
    },
    {
      id: 's2',
      code: 'SITE-0003',
      name: 'Kent Ridge campus',
      address: '21 Lower Kent Ridge Road',
      jurisdiction: 'SG',
      facilityType: 'University campus',
      latest: {
        reference: 'RPT-2026-0411',
        siteVisitDate: '2026-04-11',
        locations: 41,
        buildings: 4,
      },
    },
  ]
  // The gateway lists the clients and NUS's sites; creating answers CREATED.
  function gateway() {
    const posts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return respond(201, CREATED_REPLY)
      }
      if (url === '/api/clients') return respond(200, CLIENTS)
      if (url === '/api/clients/c1/sites') return respond(200, SITES)
      return unreachable()
    })
    return posts
  }
  const clientField = () => screen.getByRole('combobox', { name: /^Client/ })
  const siteBox = (name: RegExp) => screen.findByRole('checkbox', { name })
  const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
  const create = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  // Opens the form on Existing client, once the clients have loaded (the Client field offers them).
  async function openExisting() {
    startFromForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Existing client' }))
    await act(async () => {})
  }

  it('offers every client, then its sites, copying the chosen one’s latest visit (AC3, AC4, AC5)', async () => {
    const posts = gateway()
    await openApp()
    await openExisting()

    type(clientField(), 'nus')
    // The sites are ticked from a list; none is chosen yet.
    const kent = await siteBox(/Kent Ridge campus/)
    expect(screen.queryByLabelText(/^Site name/)).not.toBeInTheDocument()
    create('Create')
    expect(screen.getByText('Choose a site, or add a new one')).toBeInTheDocument()
    expect(posts).toHaveLength(0)

    fireEvent.click(kent)
    // A listed site brings its details, which change only through Edit site (CP-18).
    expect(kent).toBeChecked()
    expect(screen.getByText('21 Lower Kent Ridge Road')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Site name/)).not.toBeInTheDocument()
    // The copy switch shows for a Resurvey, on by default (the first survey needs no copy).
    fireEvent.click(screen.getByRole('radio', { name: 'Resurvey' }))
    const copy = screen.getByRole('switch', {
      name: 'Copy 41 locations from RPT-2026-0411 · 11/04/2026',
    })
    expect(copy).toBeChecked()

    fireEvent.click(copy)
    create('Create')
    await screen.findByText(/RPT-2026-0001 created/)
    expect(posts[0]).toMatchObject({
      client: { id: 'c1' },
      sites: [{ id: 's2', copyLocations: false, assessments: [{ visitType: 'Resurvey' }] }],
    })
    expect(posts[0]).not.toHaveProperty('sites.0.name')
  })

  it('adds a new site for a listed client, refusing one it already has (AC10, AC11)', async () => {
    const posts = gateway()
    await openApp()
    await openExisting()
    type(clientField(), 'NUS')
    await siteBox(/Kent Ridge campus/)
    fireEvent.click(screen.getByRole('button', { name: 'New site' }))
    type(screen.getByLabelText(/^Address/), '1 Outram Road')

    type(screen.getByLabelText(/^Site name/), 'kent ridge campus')
    create('Create')
    expect(screen.getByText('NUS already has Kent Ridge campus')).toBeInTheDocument()

    // A likely typo of a listed site is asked about as it is typed.
    type(screen.getByLabelText(/^Site name/), 'Kent Rdge campus')
    expect(screen.getByText(/Did you mean/)).toHaveTextContent('Did you mean Kent Ridge campus?')
    fireEvent.click(screen.getByRole('button', { name: 'Kent Ridge campus?' }))
    expect(screen.getByRole('checkbox', { name: /Kent Ridge campus/ })).toBeChecked()
    expect(posts).toHaveLength(0)

    // Untick the listed site, then add the new one.
    fireEvent.click(screen.getByRole('checkbox', { name: /Kent Ridge campus/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New site' }))
    type(screen.getByLabelText(/^Site name/), 'Outram campus')
    type(screen.getByLabelText(/^Facility type/), 'Distribution warehouse')
    type(screen.getByLabelText(/^Address/), '1 Outram Road')
    create('Create')
    await screen.findByText(/RPT-2026-0001 created/)
    expect(posts[0]).toMatchObject({ client: { id: 'c1' }, sites: [{ name: 'Outram campus' }] })
  }, 10000)

  it('asks about a new client named like a listed one, and keeps it as typed (AC11)', async () => {
    const posts = gateway()
    await openApp()
    startFromForm()
    await act(async () => {})
    type(screen.getByLabelText(/^Client name/), 'Changi Airprot Group')
    expect(screen.getByText(/Did you mean/)).toHaveTextContent('Did you mean Changi Airport Group?')
    type(screen.getByLabelText(/^Site name/), 'Terminal 5')
    type(screen.getByLabelText(/^Facility type/), 'Distribution warehouse')
    type(screen.getByLabelText(/^Address/), 'Airport Boulevard')

    // Creating without taking the suggestion keeps the name as typed.
    create('Create')

    await screen.findByText(/RPT-2026-0001 created/)
    expect(posts[0]).toMatchObject({
      client: { name: 'Changi Airprot Group' },
      sites: [{ name: 'Terminal 5' }],
    })
  })

  it('reads the sites again each time the form opens, as a client page may have removed one (CP-18)', async () => {
    let sites = SITES
    vi.stubGlobal('fetch', (url: string) => {
      if (url === '/api/clients') return respond(200, CLIENTS)
      if (url === '/api/clients/c1/sites') return respond(200, sites)
      return unreachable()
    })
    await openApp()
    const offered = async () => {
      await openExisting()
      type(clientField(), 'NUS')
      await siteBox(/Kent Ridge campus/)
      return screen.getAllByRole('checkbox').map((o) => o.closest('label')?.textContent ?? '')
    }
    expect((await offered()).join()).toContain('Bukit Timah campus')

    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    sites = SITES.slice(1)
    expect((await offered()).join()).not.toContain('Bukit Timah campus')
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
  // The footer's count of the rows shown (CP-23); it replaced "N of M assessments".
  const results = () => screen.getByText(/^\d+ assessments?$/)
  // A row is a div; its reference button is the one control in it that opens it.
  const rowOf = (button: HTMLElement) => button.closest<HTMLElement>('div[data-id]')!
  const search = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value },
    })

  it('lists the assessments assigned to you with their site, date and status', async () => {
    listReply = () => respond(200, LIST)
    mockGateway()
    await openApp()

    // A row's name starts with its site; Continue capture names it later on.
    const row = rowOf(await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }))
    expect(row).toHaveTextContent('RPT-2026-0001')
    expect(row).toHaveTextContent('21 Apr 2026')
    expect(row).toHaveTextContent('Capturing')
    expect(rowOf(screen.getByRole('button', { name: /Harbourside Cold Store/ }))).toHaveTextContent(
      'Unscheduled',
    )
    expect(results()).toHaveTextContent('2 assessments')
    expect(screen.queryByText('Someone Else Depot')).not.toBeInTheDocument()
  })

  // The Overdue / Due soon / Site visits boxes became the Due pill (CP-23 screen 6A).
  it('filters by overdue reports, reports due soon and site visits soon from the Due pill', async () => {
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
    // Grouped by client, then site in name order.
    const shown = () =>
      screen.getAllByRole('button', { name: /^Case/ }).map((b) => b.getAttribute('data-id'))
    // Archived work is hidden until Status is Archived: 6 of the 7.
    expect(results()).toHaveTextContent('6 assessments')

    // Each row counts down to its report due date, or is marked overdue.
    const row = (name: string) =>
      rowOf(screen.getByRole('button', { name: new RegExp(`^Case ${name}`) }))
    expect(within(row('Late')).getByText('2 days late')).toBeInTheDocument()
    expect(row('Soon')).toHaveTextContent('in 3 days')
    expect(row('Today')).toHaveTextContent('today')
    expect(row('Far')).toHaveTextContent('in 8 days')
    // Finished work shows its date alone, never late.
    expect(row('Done')).not.toHaveTextContent(/late|today|in \d+ days/)

    // The footer's late link applies the Late choice of the Report due pill.
    expect(screen.getByRole('button', { name: '1 report late' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 report late' }))
    expect(screen.getByRole('button', { name: 'Report due: Late' })).toBeInTheDocument()
    expect(shown()).toEqual(['RPT-CASE-0'])
    expect(results()).toHaveTextContent('1 assessment')

    // Choosing another moves the filter to it.
    // Groups follow the sort, latest site visit first (round 12).
    choose('Report due: Late', 'Due within 7 days')
    expect(shown()).toEqual(['RPT-CASE-2', 'RPT-CASE-1'])

    choose('Report due: Due within 7 days', 'Site visit within 7 days')
    expect(shown()).toEqual(['RPT-CASE-3', 'RPT-CASE-2'])

    // Any report due clears the pill and shows every assessment.
    choose('Report due: Site visit within 7 days', 'Any report due')
    expect(results()).toHaveTextContent('6 assessments')
  })

  it('filters by status and searches by site and client', async () => {
    listReply = () => respond(200, LIST)
    mockGateway()
    await openApp()
    await screen.findByRole('button', { name: /^Jurong Distribution Hub/ })

    choose('Status', 'Under review')
    expect(results()).toHaveTextContent('1 assessment')
    expect(screen.queryByRole('button', { name: /^Jurong/ })).not.toBeInTheDocument()

    choose('Status: Under review', 'Any status')
    search('jurong')
    expect(results()).toHaveTextContent('1 assessment')
    search('harbourside foods')
    expect(screen.getByRole('button', { name: /Harbourside Cold Store/ })).toBeInTheDocument()
    expect(results()).toHaveTextContent('1 assessment')
  })

  it('shows the sample assessments when the gateway cannot be reached', async () => {
    mockGateway()
    await openApp()

    expect(await screen.findByText('Showing sample assessments')).toBeInTheDocument()
    expect(results()).toHaveTextContent('6 assessments')
  })

  // CP-23: one date format on every screen ("5 Sep 2026", never "05 Sept"),
  // and counts that read right for one.
  it('dates and counts one assessment as every screen does', async () => {
    listReply = () => respond(200, [{ ...LIST[0], siteVisitDate: '2026-09-05' }])
    mockGateway()
    await openApp()

    const row = rowOf(await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }))
    expect(row).toHaveTextContent('5 Sep 2026')
    // The page header carries no count or engineer name any more; the footer has the count.
    expect(screen.getByText('1 assessment')).toBeInTheDocument()
  })

  it('says there are no assessments yet, with New assessment, when there are none at all', async () => {
    listReply = () => respond(200, [])
    mockGateway()
    await openApp()

    expect(await screen.findByText('No assessments yet')).toBeInTheDocument()
    expect(screen.queryByText('No assessments match those filters')).not.toBeInTheDocument()
    // The header's split button, and the empty list's own.
    expect(screen.getAllByRole('button', { name: 'New assessment' })).toHaveLength(2)
  })
})

describe('Assessments page (CP-23 screen 6A)', () => {
  const visit = (
    reference: string,
    client: string,
    site: string,
    surveyType: string,
    reportDueDate: string,
  ) => ({
    ...CREATED,
    id: 'id-' + reference,
    reference,
    client,
    surveyType,
    reportDueDate,
    status: 'capturing',
    site: { ...CREATED.site, name: site },
  })
  // The rows shown, by their reference button's data-id.
  const refs = () =>
    [...document.querySelectorAll('button[data-id]')].map((b) => b.getAttribute('data-id'))
  // One group per client and site (CP-23 board 03), named "Client, Site".
  const groups = () =>
    screen
      .getAllByRole('region')
      .map((r) => r.getAttribute('aria-label'))
      // Sonner's toast area is a region too.
      .filter((label) => !label?.startsWith('Notifications'))

  it('groups rows under their client and site, and filters by Report due and Type', async () => {
    listReply = () =>
      respond(200, [
        visit('RPT-1', 'Northgate Logistics', 'Tilbury', 'First survey', '2000-01-01'),
        visit('RPT-2', 'Northgate Logistics', 'Dublin', 'Resurvey', '2099-12-31'),
        visit('RPT-3', 'Fennick Foods', 'Leeds', 'Resurvey', '2099-12-31'),
      ])
    mockGateway()
    await openApp()

    // Each client › site heads its assessments, in the sort's order (here by name); the client name opens its page.
    const northgate = await screen.findByRole('region', { name: 'Northgate Logistics, Dublin' })
    choose(/^Sort assessments/, 'Client name, A to Z')
    expect(groups()).toEqual([
      'Fennick Foods, Leeds',
      'Northgate Logistics, Dublin',
      'Northgate Logistics, Tilbury',
    ])
    expect(within(northgate).getByText('Northgate Logistics')).toBeInTheDocument()
    // A row: reference, type, survey date, status, and report due with its days late.
    const late = screen
      .getByRole('button', { name: /^Tilbury, RPT-1/ })
      .closest<HTMLElement>('div[data-id]')!
    for (const text of ['RPT-1', 'First survey', '21 Apr 2026', 'Capturing', 'days late'])
      expect(late).toHaveTextContent(text)
    // No summary boxes above the list any more.
    expect(screen.queryByRole('button', { name: /Show only these/ })).not.toBeInTheDocument()

    choose('Report due', 'Late')
    expect(refs()).toEqual(['RPT-1'])
    expect(groups()).toEqual(['Northgate Logistics, Tilbury'])
    choose('Report due: Late', 'Any report due')

    // Type offers the types the list has, after "Any type".
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    expect(screen.getAllByRole('menuitemradio').map((m) => m.textContent)).toEqual([
      'Any type',
      'First survey',
      'Resurvey',
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Resurvey' }))
    expect(refs()).toEqual(['RPT-3', 'RPT-2'])
    expect(screen.getByText('2 assessments')).toBeInTheDocument()
  })
})

describe('Work list by client (CP-17)', () => {
  const site = (id: string, name: string, address: string | null = null) => ({
    id,
    code: 'SITE-' + id,
    name,
    address,
    jurisdiction: 'UK',
    facilityType: 'Distribution warehouse',
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
  })
  const TILBURY = site('t1', 'Tilbury Distribution Centre', 'Ferry Lane, Tilbury')
  const visit = (
    reference: string,
    client: [string | null, string],
    at: ReturnType<typeof site>,
    status: string,
    siteVisitDate: string,
    reportDueDate: string | null = null,
  ) => ({
    ...CREATED,
    id: 'id-' + reference,
    reference,
    clientId: client[0],
    client: client[1],
    site: at,
    status,
    siteVisitDate,
    reportDueDate,
  })
  const NORTHGATE: [string, string] = ['n1', 'Northgate Logistics']
  const LIST = [
    visit('RPT-2026-0411', NORTHGATE, TILBURY, 'capturing', '2026-04-11', '2026-05-30'),
    visit('RPT-2025-0414', NORTHGATE, TILBURY, 'finalised', '2025-04-14', '2025-04-28'),
    visit(
      'RPT-2026-0327',
      NORTHGATE,
      site('d1', 'Dublin Warehouse 4'),
      'under_review',
      '2026-03-20',
    ),
    visit('RPT-2026-0300', NORTHGATE, site('d1', 'Dublin Warehouse 4'), 'archived', '2026-03-01'),
    visit(
      'RPT-2026-0408',
      ['f1', 'Fennick Foods'],
      site('l1', 'Leeds Cold Store'),
      'capturing',
      '2026-04-08',
    ),
    // A site saved before clients, not yet migrated: listed, never visited again from here.
    visit(
      'RPT-2026-0101',
      [null, 'Old Client'],
      site('o1', 'Old Site'),
      'not_started',
      '2026-01-01',
    ),
  ]
  const SITES = [
    {
      ...TILBURY,
      latest: {
        reference: 'RPT-2026-0411',
        siteVisitDate: '2026-04-11',
        locations: 6,
        buildings: 2,
      },
    },
  ]
  function gateway() {
    const posts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return respond(201, url === '/api/assessments' ? CREATED_REPLY : CREATED)
      }
      if (url === '/api/assessments') return respond(200, LIST)
      if (url === '/api/clients')
        return respond(200, [{ id: 'n1', name: 'Northgate Logistics', sites: 2 }])
      if (url === '/api/clients/n1/sites') return respond(200, SITES)
      // The client's page, which the new form reads for its sites' latest status.
      if (url === '/api/clients/n1')
        return respond(200, { id: 'n1', name: 'Northgate Logistics', sites: [] })
      return respond(200, [])
    })
    return posts
  }
  // The assessments listed in a client's group or a site's, in order.
  const refsIn = (element: HTMLElement) =>
    [...element.querySelectorAll('button[data-id]')].map((b) => b.getAttribute('data-id'))
  // A client › site group (CP-23 board 03).
  const group = (name: string | RegExp) => screen.getByRole('region', { name })
  const groups = () =>
    screen
      .getAllByRole('region')
      .map((r) => r.getAttribute('aria-label'))
      // Sonner's toast area is a region too.
      .filter((label) => !label?.startsWith('Notifications'))
  // The list opens grouped by client (CP-23 screen 6A).
  async function grouped() {
    const posts = gateway()
    await openApp()
    await screen.findByRole('region', { name: 'Northgate Logistics, Tilbury Distribution Centre' })
    return posts
  }

  it('groups my assessments by client, then site, in name order (AC9)', async () => {
    await grouped()

    // By client is on from the start (CP-23).
    expect(screen.getByRole('radio', { name: 'By client' })).toBeChecked()
    choose(/^Sort assessments/, 'Client name, A to Z')
    expect(groups()).toEqual([
      'Fennick Foods, Leeds Cold Store',
      'Northgate Logistics, Dublin Warehouse 4',
      'Northgate Logistics, Tilbury Distribution Centre',
      'Old Client, Old Site',
    ])
    const tilbury = group('Northgate Logistics, Tilbury Distribution Centre')
    expect(tilbury).toHaveTextContent('Ferry Lane, Tilbury')
    // Latest visit first within the site.
    expect(refsIn(tilbury)).toEqual(['RPT-2026-0411', 'RPT-2025-0414'])
    // The group names the client, so the rows carry no "Client › Site" line.
    expect(within(tilbury).queryByText(/Northgate Logistics ›/)).not.toBeInTheDocument()

    // All: one flat list, each row naming its client and site, latest site visit first.
    fireEvent.click(screen.getByRole('radio', { name: 'All' }))
    expect(groups()).toEqual([])
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked()
    expect(screen.getAllByText('Northgate Logistics › Tilbury Distribution Centre')).toHaveLength(2)
  })

  it('keeps the search, status and sort, hiding a client or site left empty', async () => {
    await grouped()

    choose(/^Sort assessments/, 'Report due, earliest first')
    // The groups follow the same sort: each by its earliest report due.
    expect(groups()).toEqual([
      'Northgate Logistics, Tilbury Distribution Centre',
      'Northgate Logistics, Dublin Warehouse 4',
      'Fennick Foods, Leeds Cold Store',
      'Old Client, Old Site',
    ])
    // The finalised visit sorts after the open one (finished work is last in this sort).
    expect(refsIn(group(/^Northgate Logistics, Tilbury/))).toEqual([
      'RPT-2026-0411',
      'RPT-2025-0414',
    ])

    choose('Status', 'Finalised')
    expect(groups()).toEqual(['Northgate Logistics, Tilbury Distribution Centre'])

    choose('Status: Finalised', 'Any status')
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value: 'leeds' },
    })
    expect(refsIn(group('Fennick Foods, Leeds Cold Store'))).toEqual(['RPT-2026-0408'])
    expect(groups()).toHaveLength(1)
  })

  it('lists archived assessments under the Status filter, hidden otherwise', async () => {
    await grouped()

    // Search, the three pills, By client | All, Sort and New assessment (CP-23 boards 03, 04).
    const toolbar = screen.getByRole('radiogroup', { name: 'Group assessments' }).parentElement!
      .parentElement!
    const controls = [...toolbar.querySelectorAll('button, input')].map(
      (c) => c.getAttribute('aria-label') || c.textContent,
    )
    expect(controls).toEqual([
      'Search assessments',
      'Status',
      'Report due',
      'Type',
      'Sort assessments: Survey date, latest first',
      'By client',
      'All',
      'New assessment',
    ])
    expect(screen.queryByRole('button', { name: /RPT-2026-0300/ })).not.toBeInTheDocument()

    // Archived is a Status choice; it shows the archived rows and nothing else.
    choose('Status', 'Archived')
    expect(refsIn(document.body)).toEqual(['RPT-2026-0300'])
    // Still grouped, so a client whose assessments are all archived can be opened.
    expect(groups()).toEqual(['Northgate Logistics, Dublin Warehouse 4'])
    expect(screen.getByRole('button', { name: 'Northgate Logistics' })).toBeInTheDocument()
    // An archived row is opened, not archived again.
    expect(screen.queryByRole('button', { name: 'Archive RPT-2026-0300' })).not.toBeInTheDocument()

    choose('Status: Archived', 'Any status')
    expect(screen.queryByRole('button', { name: /RPT-2026-0300/ })).not.toBeInTheDocument()
  })

  it('starts a new assessment at a site on its client, copying its last one (AC6)', async () => {
    const posts = await grouped()
    // A site not linked to a client can't take a new assessment from here.
    expect(
      screen.queryByRole('button', { name: 'New assessment for Old Site' }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'New assessment for Tilbury Distribution Centre' }),
    )

    expect(screen.getByRole('heading', { name: 'New Assessment' })).toBeInTheDocument()
    // The form opens on Existing client, with that site already ticked.
    expect(screen.getByRole('radio', { name: 'Existing client' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Client' })).toHaveTextContent('Northgate Logistics')
    expect(
      await screen.findByRole('checkbox', { name: /Tilbury Distribution Centre/ }),
    ).toBeChecked()
    expect(screen.getByText('Ferry Lane, Tilbury')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Resurvey' }))
    expect(
      screen.getByRole('switch', { name: 'Copy 6 locations from RPT-2026-0411 · 11/04/2026' }),
    ).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByText(/RPT-2026-0001 created/)
    expect(posts[0]).toMatchObject({
      client: { id: 'n1' },
      sites: [{ id: 't1', copyLocations: true }],
    })
  })
})

it('assigns new assessments to me, with no engineer to choose (CP-23 AC10)', async () => {
  let submitted: object | undefined
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    if (init?.method === 'GET') return respond(200, [])
    submitted = JSON.parse(String(init?.body))
    return respond(201, CREATED_REPLY)
  })
  await openApp()
  startFromForm()
  expect(screen.queryByRole('searchbox', { name: 'Search engineers' })).not.toBeInTheDocument()
  expect(screen.queryByText('Assigned engineer')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/^Site name/), { target: { value: CREATED.site.name } })
  fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: '2 Jurong Port Rd' } })
  fireEvent.change(screen.getByLabelText(/^Facility type/), {
    target: { value: 'Distribution warehouse' },
  })
  fireEvent.change(screen.getByLabelText(/^Client name/), { target: { value: CREATED.client } })
  fireEvent.click(screen.getByRole('button', { name: CREATE_ONE }))
  await screen.findByText(/RPT-2026-0001 created/)
  expect(submitted).not.toHaveProperty('engineerId')
  expect(screen.getByRole('button', { name: /Jurong Distribution Hub/ })).toBeInTheDocument()
})

it('keeps work assigned to someone else out of my list', async () => {
  // The gateway answers with an assessment whose engineer is not the signed-in one.
  const other = { ...CREATED, engineer: { id: '6ab39017e45cf009e4507732', name: 'Jide Okafor' } }
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
    init?.method === 'GET'
      ? respond(200, [])
      : respond(201, { clientId: 'c1', assessments: [other] }),
  )
  await openApp()
  startFromForm()
  fireEvent.change(screen.getByLabelText(/^Site name/), { target: { value: CREATED.site.name } })
  fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: '2 Jurong Port Rd' } })
  fireEvent.change(screen.getByLabelText(/^Facility type/), {
    target: { value: 'Distribution warehouse' },
  })
  fireEvent.change(screen.getByLabelText(/^Client name/), { target: { value: CREATED.client } })
  fireEvent.click(screen.getByRole('button', { name: CREATE_ONE }))
  await screen.findByText(/RPT-2026-0001 created/)
  expect(screen.queryByRole('button', { name: /Jurong Distribution Hub/ })).not.toBeInTheDocument()
})

it('offers starting from client documents from New assessment’s menu (CP-23 screen 2A)', async () => {
  mockGateway()
  await openApp()
  fireEvent.click(screen.getByRole('button', { name: 'New assessment' }))
  const menu = screen.getByRole('dialog', { name: 'New assessment' })
  expect(within(menu).getByRole('button', { name: /Fill in the form/ })).toBeInTheDocument()
  fireEvent.click(within(menu).getByRole('button', { name: /Start from client documents/ }))

  expect(screen.getByRole('heading', { name: 'New Assessment' })).toBeInTheDocument()
  expect(screen.getByText('Add the client’s documents')).toBeInTheDocument()
})

it('dates a new form today with its report due in two weeks, and opens it blank each time', async () => {
  // Late in the month, so the due date falls in the next one.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 25, 9, 0) })
  try {
    mockGateway()
    await openApp()
    const openForm = () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Assessments/ })[0])
      startFromForm()
    }
    const visit = () => screen.getByLabelText(/^Survey start/)
    const due = () => screen.getByLabelText(/Report due/)
    openForm()
    expect(visit()).toHaveValue('25/10/2026')
    expect(due()).toHaveValue('08/11/2026')

    // Left blank in a tab overnight, it opens on the next day's dates.
    vi.setSystemTime(new Date(2026, 9, 26, 9, 0))
    openForm()
    expect(visit()).toHaveValue('26/10/2026')
    expect(due()).toHaveValue('09/11/2026')

    // One the engineer started and left is forgotten, not kept as a draft.
    fireEvent.change(screen.getByLabelText(/^Client name/), { target: { value: 'Draft client' } })
    fireEvent.change(screen.getByLabelText(/^Site name/), { target: { value: 'Draft site' } })
    vi.setSystemTime(new Date(2026, 9, 27, 9, 0))
    openForm()
    expect(screen.getByLabelText(/^Client name/)).toHaveValue('')
    expect(screen.getByLabelText(/^Site name/)).toHaveValue('')
    expect(visit()).toHaveValue('27/10/2026')
    expect(due()).toHaveValue('10/11/2026')
  } finally {
    vi.useRealTimers()
  }
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
  // One list, latest first, rather than grouped by client (CP-23).
  fireEvent.click(screen.getByRole('radio', { name: 'All' }))
  const rowOf = (name: string) =>
    screen
      .getByRole('button', { name: new RegExp(`^Deadline ${name}`) })
      .closest<HTMLElement>('div[data-id]')!
  expect(within(rowOf('Overdue')).getByText(/days late/)).toBeInTheDocument()
  for (const name of ['Undated', 'Future', 'Today', 'Finalised']) {
    expect(within(rowOf(name)).queryByText(/days late/)).not.toBeInTheDocument()
  }
  const order = () =>
    screen.getAllByRole('button', { name: /^Deadline/ }).map((row) => row.getAttribute('data-id'))
  expect(order()).toEqual([0, 1, 2, 3, 4].map((i) => `RPT-DEADLINE-${i}`))
  choose(/^Sort assessments/, 'Report due, earliest first')
  // The finalised one (4) goes last: nothing is left to chase.
  expect(order()).toEqual([3, 2, 1, 0, 4].map((i) => `RPT-DEADLINE-${i}`))
  choose('Status', 'Capturing')
  fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
    target: { value: 'Deadline' },
  })
  expect(order()).toEqual([3, 2, 1, 0].map((i) => `RPT-DEADLINE-${i}`))
  choose(/^Sort assessments/, 'Survey date, latest first')
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
  // The navigation lists the assessment under Recent.
  expect(screen.getByRole('button', { name: 'Jurong Distribution Hub' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument()

  // Archive sits in the header's Assessment group.
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
  const dialog = screen.getByRole('dialog', { name: 'Archive this assessment?' })
  status = 'archived'
  fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))

  await screen.findByText('RPT-2026-0001 archived')
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/assessments/RPT-2026-0001/archive',
    expect.anything(),
  )
  // Hidden from the work list, listed under the Status filter's Archived (CP-23).
  await screen.findByText('0 assessments')
  expect(screen.queryByRole('button', { name: /Jurong Distribution Hub/ })).not.toBeInTheDocument()
  choose('Status', 'Archived')
  expect(screen.getByRole('button', { name: 'Status: Archived' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Jurong Distribution Hub/ }))

  // An archived workspace offers neither capture nor another archive.
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  expect(screen.queryByRole('button', { name: 'Add manually' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()

  // Restore (AC9) returns it to the work list with the status it had.
  status = 'capturing'
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await screen.findByText(/RPT-2026-0001 restored to your work list/)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/assessments/RPT-2026-0001/restore',
    expect.anything(),
  )
  await screen.findByText('1 assessment')
  const row = screen
    .getAllByRole('button', { name: /Jurong Distribution Hub/ })
    .find((b) => b.getAttribute('data-id') === 'RPT-2026-0001')
  expect(row?.closest('div[data-id]')).toHaveTextContent('Capturing')
})

it('archives from a list row with the same confirm, and Undo restores it (CP-23 board 01)', async () => {
  let status = 'capturing'
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      calls.push(url)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return respond(200, url === '/api/assessments' ? [{ ...CREATED, status }] : [])
  })
  await openApp()
  await screen.findByRole('button', { name: /^Jurong Distribution Hub/ })

  fireEvent.click(screen.getByRole('button', { name: 'Archive RPT-2026-0001' }))
  const dialog = screen.getByRole('dialog', { name: 'Archive this assessment?' })
  status = 'archived'
  fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))

  // The toast offers Undo, and the row leaves the list.
  await screen.findByText('RPT-2026-0001 archived')
  expect(calls).toEqual(['/api/assessments/RPT-2026-0001/archive'])
  await vi.waitFor(() =>
    expect(screen.queryByRole('button', { name: /^Jurong Distribution Hub/ })).toBeNull(),
  )
  status = 'capturing'
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(
    await screen.findByRole('button', { name: /^Jurong Distribution Hub/ }),
  ).toBeInTheDocument()
  expect(calls).toEqual([
    '/api/assessments/RPT-2026-0001/archive',
    '/api/assessments/RPT-2026-0001/restore',
  ])
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
  // Grouped by client, the sample rows give way to the saved record's group.
  const tilbury = within(
    await screen.findByRole('region', { name: /^Straits Logistics/ }),
  ).getByRole('button', { name: /^Tilbury Distribution Centre/ })
  fireEvent.click(tilbury)
  expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
})

it('edits my assessment details over its Overview, keeping its engineer (RV-10 AC10, AC11)', async () => {
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
      if (reply.status === 204) record = { ...record, ...body }
      return Promise.resolve(reply)
    }
    return respond(200, url === '/api/assessments' ? [record] : [])
  })
  await openApp()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === 'RPT-2026-0001',
  )!
  fireEvent.click(row)
  // The Site card shows the site's address and jurisdiction; the record, this
  // visit's own details (CP-18).
  const siteCard = screen.getByRole('region', { name: 'Site' })
  expect(within(siteCard).getByText('Address')).toBeInTheDocument()
  expect(within(siteCard).getByText('Not recorded')).toBeInTheDocument()
  expect(within(siteCard).getByText('Malaysia')).toBeInTheDocument()
  const recordCard = () => screen.getByRole('region', { name: 'Assessment record' })
  expect(within(recordCard()).getByText('Property risk survey')).toBeInTheDocument()

  // Cancel closes it over the Overview, changing nothing.
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Edit details' })).getByRole('button', {
      name: 'Cancel',
    }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')

  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
  // Only this visit's own details, from the saved ones: the site and client
  // change for all their assessments elsewhere (CP-18), and the engineer stays.
  const dialog = screen.getByRole('dialog', { name: 'Edit details' })
  expect(within(dialog).getByLabelText(/Assessment type/)).toHaveValue('Property risk survey')
  expect(within(dialog).getByLabelText(/Site visit date/)).toHaveValue('2026-04-21')
  expect(within(dialog).getByLabelText(/Report due/)).toHaveValue('2026-05-02')
  expect(within(dialog).queryByLabelText(/Site name/)).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText(/^Client/)).not.toBeInTheDocument()

  fireEvent.change(within(dialog).getByLabelText(/Assessment type/), {
    target: { value: 'Follow-up visit' },
  })
  // A rejected save names the problem beside its field and keeps the changes (AC11).
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  expect(await within(dialog).findByText(/on or after the site visit date/)).toBeInTheDocument()
  expect(within(dialog).getByLabelText(/Assessment type/)).toHaveValue('Follow-up visit')

  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  await screen.findByText('Details saved for RPT-2026-0001.')
  expect(saves[1].body).toEqual({
    surveyType: 'Follow-up visit',
    siteVisitDate: '2026-04-21',
    reportDueDate: '2026-05-02',
  })
  // The Overview shows the saved details (AC10).
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await vi.waitFor(() =>
    expect(within(recordCard()).getByText('Follow-up visit')).toBeInTheDocument(),
  )
})

it('corrects the site from the Overview for every assessment at it, asking first about its scope (CP-18)', async () => {
  let record = {
    ...CREATED,
    clientId: 'c1',
    site: {
      ...CREATED.site,
      id: 's1',
      change: { allowed: true, reason: null, assessments: 2 },
    },
  }
  const corrections: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && url === '/api/sites/s1') {
      const body = JSON.parse(String(init.body))
      corrections.push(body)
      record = { ...record, site: { ...record.site, ...body } }
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return respond(200, url === '/api/assessments' ? [record] : [])
  })
  await openApp()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === 'RPT-2026-0001',
  )!
  fireEvent.click(row)
  // Edit site is on the Overview's Site card, not in Edit details.
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Site' })).getByRole('button', {
      name: 'Edit site',
    }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Edit Jurong Distribution Hub' })
  expect(
    within(dialog).getByText('Changes apply to the 2 assessments at this site.'),
  ).toBeInTheDocument()
  fireEvent.change(within(dialog).getByLabelText(/Facility type/), {
    target: { value: 'Cold store' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  // A new scope changes what drafting retrieves, so it asks first.
  expect(within(dialog).getByText(/changes the 2 assessments/)).toBeInTheDocument()
  expect(corrections).toHaveLength(0)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change scope' }))

  await screen.findByText(/Jurong Distribution Hub saved/)
  expect(corrections).toEqual([
    {
      name: 'Jurong Distribution Hub',
      address: '',
      jurisdiction: 'MY',
      facilityType: 'Cold store',
    },
  ])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  // The Site card shows the change.
  await vi.waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Site' })).getByText('Cold store'),
    ).toBeInTheDocument(),
  )
})

it('says why a colleague’s site can’t be changed, and opens the client’s page from its name (CP-18)', async () => {
  const OTHERS = "Another engineer's assessment uses this site, so it can't be changed."
  const record = {
    ...CREATED,
    clientId: 'c1',
    site: { ...CREATED.site, id: 's1', change: { allowed: false, reason: OTHERS, assessments: 2 } },
  }
  const refused = { allowed: false, reason: OTHERS }
  vi.stubGlobal('fetch', (url: string) =>
    respond(
      200,
      url === '/api/assessments'
        ? [record]
        : url === '/api/clients/c1'
          ? {
              id: 'c1',
              name: 'Straits Logistics',
              edited: null,
              removed: false,
              rename: refused,
              remove: refused,
              removedWithClient: 0,
              restore: { allowed: false, reason: null },
              sites: [],
            }
          : [],
    ),
  )
  await openApp()
  try {
    const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
      (b) => b.getAttribute('data-id') === 'RPT-2026-0001',
    )!
    fireEvent.click(row)
    const siteCard = screen.getByRole('region', { name: 'Site' })
    expect(within(siteCard).queryByRole('button', { name: 'Edit site' })).not.toBeInTheDocument()
    expect(within(siteCard).getByText(OTHERS)).toBeInTheDocument()
    // Edit details is still the engineer's.
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument()

    fireEvent.click(within(siteCard).getByRole('button', { name: 'Straits Logistics' }))
    expect(
      await screen.findByRole('heading', { name: 'Straits Logistics', level: 1 }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/clients/c1')
  } finally {
    window.history.pushState({}, '', '/')
  }
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

    expect(screen.getByText('Address')).toBeInTheDocument()
    expect(screen.getByText('Malaysia')).toBeInTheDocument()
    expect(screen.getByText('Alex Rowe')).toBeInTheDocument()
    // Only the assigned engineer edits, archives or captures.
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    expect(screen.queryByRole('button', { name: 'Add manually' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record site walk' })).not.toBeInTheDocument()
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
    // Observations tab's Add manually button.
    fireEvent.click(screen.getByRole('button', { name: /^Capture, 0, observations/ }))
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add manually' }))
    expect(await screen.findByRole('heading', { name: 'New Observation' })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument()
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
    // Grouped by client, the sample rows give way to the saved record's group.
    fireEvent.click(
      within(await screen.findByRole('region', { name: /^Straits Logistics/ })).getByRole(
        'button',
        {
          name: /^Tilbury Distribution Centre/,
        },
      ),
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
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument()
  })
})

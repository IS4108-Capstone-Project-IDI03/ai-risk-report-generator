import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'

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
function mockGateway(...replies: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn()
  for (const reply of replies) fetchMock.mockImplementationOnce(reply)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
function signIn() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
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
})

describe('Capture session (CP-01)', () => {
  it('starts a session only when capture opens', async () => {
    const fetchMock = mockGateway(() => respond(201))
    signIn()
    expect(fetchMock).not.toHaveBeenCalled()

    openCapture()

    expect(await screen.findByText('Capture session started')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(CAPTURE_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('identifies the assessment from the session', async () => {
    mockGateway(() => respond(201))
    signIn()

    openCapture()

    const notice = await screen.findByRole('status')
    await screen.findByText('Capture session started')
    expect(notice).toHaveTextContent('Harbourside Cold Store · Harbourside Foods · RPT-2026-0411')
    expect(notice).toHaveTextContent(/Started \d{2} [A-Z][a-z]{2} \d{2}:\d{2}\./)
    expect(notice).toHaveTextContent('Saved observations are not yet stored on the server.')
    expect(
      screen.getByText('Harbourside Cold Store · RPT-2026-0411 · 28 observations captured'),
    ).toBeInTheDocument()
  })

  it('resumes the session in progress when capture reopens', async () => {
    const fetchMock = mockGateway(
      () => respond(201),
      () => respond(200),
    )
    signIn()
    openCapture()
    await screen.findByText('Capture session started')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    openCapture()

    expect(await screen.findByText('Capture session resumed')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps sample data usable when the gateway cannot be reached, then retries', async () => {
    const fetchMock = mockGateway(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => respond(201),
    )
    signIn()
    openCapture()

    const notice = await screen.findByRole('status')
    await screen.findByText('Showing sample data')
    expect(notice).toHaveTextContent(
      'No capture session was started: the gateway could not be reached.',
    )
    expect(
      screen.getByText('Tilbury Distribution Centre · RPT-2026-0411 · 28 observations captured'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Observation/ }), {
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
    signIn()

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
  engineers: ['A. Rowe'],
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
    signIn()

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
      engineers: ['A. Rowe'],
    })
  })

  it('opens a created assessment on capture, with its own session and observations', async () => {
    const fetchMock = mockGateway(
      () => respond(201, CREATED),
      () => respond(201, CREATED_CAPTURE),
    )
    signIn()
    createFromForm()
    await screen.findByText(/RPT-2026-0001 created/)

    openRow()

    expect(await screen.findByText('Capture session started')).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/assessments/RPT-2026-0001/capture-session')
    expect(
      screen.getByText('Jurong Distribution Hub · RPT-2026-0001 · 0 observations captured'),
    ).toBeInTheDocument()
    expect(screen.getByText('No observations captured for RPT-2026-0001 yet.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open the assessment workspace' }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /Observation/ }), {
      target: { value: 'Sprinkler control valve chained open' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    expect(screen.getByText('Sprinkler control valve chained open')).toBeInTheDocument()
    expect(
      screen.getByText('Jurong Distribution Hub · RPT-2026-0001 · 1 observation captured'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Observation added to RPT-2026-0001. It is kept in this demo only.'),
    ).toBeInTheDocument()
  })

  it('returns capture to the demo assessment once the workspace is opened', async () => {
    const fetchMock = mockGateway(
      () => respond(201, CREATED),
      () => respond(201, CREATED_CAPTURE),
      () => Promise.reject(new TypeError('Failed to fetch')),
    )
    signIn()
    createFromForm()
    await screen.findByText(/RPT-2026-0001 created/)
    openRow()
    await screen.findByText('Capture session started')

    fireEvent.click(screen.getByRole('button', { name: 'Tilbury Distribution Centre' }))
    openCapture()

    await screen.findByText('Showing sample data')
    expect(fetchMock.mock.calls[2][0]).toBe(CAPTURE_URL)
    expect(
      screen.getByText('Tilbury Distribution Centre · RPT-2026-0411 · 28 observations captured'),
    ).toBeInTheDocument()
  })

  it('shows the reasons when the server rejects the details', async () => {
    mockGateway(() =>
      respond(400, {
        error: 'The assessment details are invalid.',
        fields: { reportDueDate: 'The report due date must be on or after the site visit date.' },
      }),
    )
    signIn()

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
    signIn()

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

  it('keeps a demo-only assessment when the gateway is unreachable, which cannot be opened', async () => {
    mockGateway(() => Promise.reject(new TypeError('Failed to fetch')))
    signIn()

    createFromForm()

    expect(
      await screen.findByText(
        'The gateway could not be reached, so RPT-2026-0416 exists only in this demo and is not saved.',
      ),
    ).toBeInTheDocument()
    openRow()
    expect(
      screen.getByText('RPT-2026-0416 exists only in this demo, so it cannot be opened.'),
    ).toBeInTheDocument()
  })
})

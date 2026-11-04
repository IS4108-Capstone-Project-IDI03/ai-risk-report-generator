// The New Assessment screen started from client documents (CP-23 AC1-AC5,
// AC7-AC9, AC13, AC22): the reading screen with each file's status, what was
// found so far, the done card, the filled-in form, tags, cancel and leave.
// Fake timers drive the simulated status words and the reveal.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewAssessment } from './screens/NewAssessment'
import { CLIENTS, created, gateway, json, sent, SITES } from './testKit'

const REFUSED =
  'photo.jpg is not a PDF, Word or email file. Add PDF, Word (.docx, .doc), Outlook (.msg) or .eml files.'
const file = (
  id: string | null,
  name: string,
  status = 'accepted',
  reason: string | null = null,
) => ({ id, name, size: 2048, status, reason })
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const sure = (value: string) => ({ value, source: null })
const none = { value: null, source: null }
const RESULT = {
  client: {
    name: sure('Harbourline Properties'),
    division: none,
    existingId: null,
    matchNotSure: false,
  },
  sites: [
    {
      ref: 'site-1',
      existingId: null,
      matchNotSure: false,
      name: sure('Tuas Distribution Centre'),
      address: sure('21 Tuas South Ave 3'),
      jurisdiction: sure('SG'),
      facilityType: none,
    },
  ],
  assessments: [
    {
      ref: 'a-1',
      siteRef: 'site-1',
      visitType: sure('First survey'),
      siteVisitDate: sure('2026-11-12'),
      siteVisitEndDate: none,
      reportDueDate: sure('2026-11-26'),
      siteContacts: [{ name: 'Priya Nair', role: 'Facilities manager', source: null }],
    },
  ],
  documents: [
    { fileId: 'f1', placement: { kind: 'site', ref: 'site-1' }, notSure: false },
    { fileId: 'f2', placement: { kind: 'client' }, notSure: true },
  ],
}
const READ = {
  id: 'i1',
  status: 'ready',
  files: [
    { ...file('f1', 'Request.eml'), status: 'read' },
    { ...file('f2', 'Lease.pdf'), status: 'read' },
  ],
  sources: [
    { documentId: 'f1', name: 'Request.eml', fileId: 'f1' },
    { documentId: 'f1-1', name: 'Attachment: Plan.pdf (from Request.eml)', fileId: 'f1' },
    { documentId: 'f2', name: 'Lease.pdf', fileId: 'f2' },
  ],
  result: RESULT,
}

// Lets the timers and the gateway's answers run, in 50 ms steps so React
// renders (and starts the next timer) between them.
async function wait(ms = 0) {
  for (let t = 0; t < ms || t === 0; t += 50)
    await act(async () => void (await vi.advanceTimersByTimeAsync(Math.min(50, ms))))
}
// The gateway, its read held until the test answers it.
function intakeGateway(read: () => Promise<Response> | Response = () => new Promise(() => {})) {
  let answer: (r: Response) => void = () => {}
  gateway({
    'GET /api/clients': () => json(200, []),
    'POST /api/client-intakes': () =>
      json(201, {
        id: 'i1',
        files: [
          file('f1', 'Request.eml'),
          file('f2', 'Lease.pdf'),
          file(null, 'photo.jpg', 'refused', REFUSED),
        ],
      }),
    'POST /api/client-intakes/i1/read': () =>
      new Promise<Response>((r) => {
        answer = r
        void Promise.resolve(read()).then((x) => x && r(x))
      }),
    'DELETE /api/client-intakes/i1': () => json(204),
    'POST /api/client-intakes/i1/create': () =>
      json(201, { clientId: 'c9', assessments: [created('RPT-2026-0201')] }),
  })
  return { answer: async (r: Response) => (answer(r), wait()) }
}
function open(onCreated = vi.fn()) {
  const view = render(
    <NewAssessment mode="documents" start={{}} onCreated={onCreated} onLeave={vi.fn()} />,
  )
  return { ...view, onCreated }
}
// Picks three files, as the file picker would.
async function addFiles(container: HTMLElement) {
  const picker = container.querySelector<HTMLInputElement>('input[type=file]')!
  const files = ['Request.eml', 'Lease.pdf', 'photo.jpg'].map((n) => new File(['x'], n))
  fireEvent.change(picker, { target: { files } })
  await wait()
}
const fileList = () => within(screen.getByRole('list', { name: 'Documents' }))
// Reads everything and waits out the reveal and the done card, to the form.
async function readAll(answer: unknown = READ) {
  intakeGateway(() => json(200, answer))
  const view = open()
  await addFiles(view.container)
  await wait(7000)
  return view
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
beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

describe('New Assessment from client documents (CP-23)', () => {
  it('shows each file’s status words while it is read (AC1)', async () => {
    intakeGateway()
    const { container } = open()
    expect(screen.getByText(/PDF, Word, Outlook \(\.msg\) or \.eml files/)).toBeInTheDocument()

    await addFiles(container)

    expect(screen.getByRole('heading', { name: 'Reading 2 documents' })).toBeInTheDocument()
    // The count is announced on its own; the countdown beside it is not.
    expect(screen.getByText('0 of 2 read')).toHaveAttribute('aria-live', 'polite')
    // The email starts at once; the PDF waits a second, then opens.
    expect(fileList().getByText('Reading the email')).toBeInTheDocument()
    expect(fileList().getByText('Waiting')).toBeInTheDocument()
    await wait(1000)
    expect(fileList().getByText('Opening file')).toBeInTheDocument()
    await wait(2000)
    expect(fileList().getByText('Opening attachments')).toBeInTheDocument()
    expect(sent('POST', '/api/client-intakes')[0].body).toBeInstanceOf(FormData)
    // No form, and no Create, until every document is read.
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
  })

  it('marks a refused file failed with the reason and what to do, while the others are read (AC4)', async () => {
    const gw = intakeGateway()
    const { container } = open()
    await addFiles(container)

    const failed = within(screen.getByRole('list', { name: 'Failed documents' }))
    expect(failed.getByText('photo.jpg')).toBeInTheDocument()
    expect(failed.getByText("Can't read .jpg files.")).toBeInTheDocument()
    expect(
      failed.getByText(/Add PDF, Word, Outlook \(\.msg\) or \.eml files\./),
    ).toBeInTheDocument()
    expect(fileList().queryByText('photo.jpg')).not.toBeInTheDocument()

    await gw.answer(json(200, READ))
    await wait(7000)
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('shows the client, sites and assessments found before the form opens (AC2, AC3)', async () => {
    const gw = intakeGateway()
    const { container } = open()
    await addFiles(container)
    const found = () => within(screen.getByRole('region', { name: 'Found so far' }))
    expect(found().queryByText('Harbourline Properties')).not.toBeInTheDocument()

    await gw.answer(json(200, READ))
    await wait(150)
    expect(found().getByText('Harbourline Properties')).toBeInTheDocument()
    await wait(300)
    expect(found().getByText('Tuas Distribution Centre')).toBeInTheDocument()
    expect(found().getByText('Tuas Distribution Centre · First survey')).toBeInTheDocument()
    // Each group is only as tall as what was found: no blank rows left over (round 13).
    expect(found().getAllByRole('listitem')).toHaveLength(3)
    // The email's attachment is read as a document too, listed under it.
    expect(fileList().getByText('Plan.pdf')).toBeInTheDocument()
    expect(fileList().getByText('in Request.eml')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()

    // Every document read: the done card, then the form.
    await wait(2000)
    // photo.jpg was refused at upload, so two of the three were read.
    expect(screen.getByText('All 2 documents read')).toBeInTheDocument()
    expect(screen.getByText('Preparing the form…')).toBeInTheDocument()
    await wait(4000)
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('fills the form in, leaving what isn’t sure empty and marked Not sure (AC5, AC8)', async () => {
    await readAll()

    expect(screen.getByLabelText(/^Client name/)).toHaveValue('Harbourline Properties')
    expect(screen.getByLabelText(/^Site name/)).toHaveValue('Tuas Distribution Centre')
    expect(screen.getByLabelText(/^Address/)).toHaveValue('21 Tuas South Ave 3')
    expect(screen.getByLabelText(/^Survey start/)).toHaveValue('12/11/2026')
    expect(screen.getByRole('button', { name: /Edit contact 1, Priya Nair/ })).toHaveTextContent(
      'Facilities manager',
    )
    const facility = screen.getByLabelText(/^Facility type/)
    expect(facility).toHaveValue('')
    expect(
      within(facility.closest('.na-field')!).getByRole('img', { name: 'Not sure' }),
    ).toBeTruthy()
    const division = screen.getByLabelText(/^Division/)
    expect(division).toHaveValue('')
    expect(
      within(division.closest('.na-field')!).getByRole('img', { name: 'Not sure' }),
    ).toBeTruthy()
    // A value it was sure of has no mark.
    const address = screen.getByLabelText(/^Address/)
    expect(
      within(address.closest('.na-field')!).queryByRole('img', { name: 'Not sure' }),
    ).toBeNull()

    // Filling a Not sure field in drops its mark.
    type(facility, 'Cold store')
    expect(
      within(facility.closest('.na-field')!).queryByRole('img', { name: 'Not sure' }),
    ).toBeNull()
  })

  it('tags each document, the whole client when not sure, and keeps them as tagged on create (AC9-AC11)', async () => {
    const { onCreated, unmount } = await readAll()
    fireEvent.click(screen.getByRole('button', { name: /Documents/ }))
    const docs = within(screen.getByRole('dialog', { name: 'Client documents' }))
    expect(
      docs.getByRole('button', { name: 'Tag of Request.eml: Tuas Distribution Centre' }),
    ).toBeInTheDocument()
    fireEvent.click(docs.getByRole('button', { name: 'Tag of Lease.pdf: Whole client' }))
    fireEvent.click(screen.getByRole('option', { name: 'Tuas Distribution Centre · First survey' }))
    type(screen.getByLabelText(/^Facility type/), 'Distribution warehouse')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await wait()

    expect(onCreated).toHaveBeenCalled()
    expect(sent('POST', '/api/client-intakes/i1/create')[0].body).toMatchObject({
      client: { name: 'Harbourline Properties' },
      sites: [
        {
          ref: 'site-1',
          name: 'Tuas Distribution Centre',
          facilityType: 'Distribution warehouse',
          assessments: [{ ref: 'a-1', visitType: 'First survey', siteVisitDate: '2026-11-12' }],
        },
      ],
      documents: [
        { fileId: 'f1', placement: { kind: 'site', ref: 'site-1' } },
        { fileId: 'f2', placement: { kind: 'assessment', ref: 'a-1' } },
      ],
    })
    // Created documents are the client's: leaving keeps them.
    unmount()
    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(0)
  })

  it('discards the documents on Cancel, and when the screen is left without creating (AC13)', async () => {
    intakeGateway(() => json(200, READ))
    const { container, unmount } = open()
    await addFiles(container)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await wait()
    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(1)
    expect(screen.getByText('Add the client’s documents')).toBeInTheDocument()

    await addFiles(container)
    await wait(7000)
    unmount()
    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(2)
  })

  it('discards documents that finish uploading after Cancel, and never reads them', async () => {
    let finish: (r: Response) => void = () => {}
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/client-intakes': () => new Promise<Response>((r) => (finish = r)),
      'DELETE /api/client-intakes/i1': () => json(204),
      'POST /api/client-intakes/i1/read': () => json(200, READ),
    })
    const { container } = open()
    await addFiles(container)
    expect(fileList().getAllByText('Uploading')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    finish(json(201, { id: 'i1', files: [file('f1', 'Request.eml')] }))
    await wait()

    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(1)
    expect(sent('POST', '/api/client-intakes/i1/read')).toHaveLength(0)
    expect(screen.getByText('Add the client’s documents')).toBeInTheDocument()
  })

  it('tells me why and sends nothing when masking is unavailable (AC22)', async () => {
    const gw = intakeGateway()
    const { container } = open()
    await addFiles(container)
    const why = 'Privacy protection is unavailable, so nothing was sent to the AI. Try again later.'

    await gw.answer(json(503, { error: why }))

    expect(screen.getByRole('alert')).toHaveTextContent(why)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    expect(sent('POST', '/api/client-intakes/i1/create')).toHaveLength(0)
  })

  it('lets me fill in the form by hand when the documents could not be read', async () => {
    const gw = intakeGateway()
    const { container } = open()
    await addFiles(container)

    await gw.answer(json(503, { error: 'Privacy protection is unavailable.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fill in the form' }))
    await wait()

    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Client name/)).toHaveValue('')
  })

  it('lists why each file was refused when none could be added (AC4)', async () => {
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/client-intakes': () =>
        json(400, {
          error: 'Add a PDF, Word or email file, or paste the email text.',
          files: [file(null, 'photo.jpg', 'refused', REFUSED)],
        }),
    })
    const { container } = open()
    await addFiles(container)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Add a PDF, Word or email file, or paste the email text.',
    )
    expect(screen.getByText("Can't read .jpg files.")).toBeInTheDocument()
    expect(screen.getByText('Add the client’s documents')).toBeInTheDocument()
  })

  it('reads pasted text as a document, in the count and as a row (AC1)', async () => {
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/client-intakes': () => json(201, { id: 'i1', files: [] }),
      'POST /api/client-intakes/i1/read': () => new Promise<Response>(() => {}),
    })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Paste email text' }))
    type(screen.getByLabelText('Email text'), 'Hi, please survey our Tuas warehouse.')
    fireEvent.click(screen.getByRole('button', { name: 'Read email text' }))
    await wait()

    expect(screen.getByRole('heading', { name: 'Reading 1 document' })).toBeInTheDocument()
    expect(fileList().getByText('Pasted text')).toBeInTheDocument()
    expect(fileList().getByText('Reading the email')).toBeInTheDocument()
  })

  it('chooses the recorded client and site the documents name (AC7)', async () => {
    gateway({
      'GET /api/clients': () => json(200, CLIENTS),
      'GET /api/clients/c1/sites': () => json(200, SITES),
      'POST /api/client-intakes': () => json(201, { id: 'i1', files: [file('f1', 'Request.eml')] }),
      'POST /api/client-intakes/i1/read': () =>
        json(200, {
          ...READ,
          result: {
            ...RESULT,
            client: {
              ...RESULT.client,
              name: sure('Harbourline Properties Pte Ltd'),
              existingId: 'c1',
            },
            sites: [{ ...RESULT.sites[0], existingId: 's1' }],
          },
        }),
    })
    const { container } = open()
    await addFiles(container)
    await wait(7000)

    const client = screen.getByRole('region', { name: 'Client' })
    expect(client).toHaveTextContent('Harbourline Properties')
    expect(client).not.toHaveTextContent('Pte Ltd')
    expect(screen.getByRole('checkbox', { name: /Jurong Cold Store/ })).toBeChecked()
    // Its site has an earlier assessment, so any type may be chosen.
    const first = within(screen.getByRole('region', { name: 'Assessment 1' }))
    expect(first.getByRole('radio', { name: 'Follow-up' })).toBeEnabled()
  })

  it('opens an empty form when the documents name nothing, saying so', async () => {
    await readAll({
      ...READ,
      result: {
        client: { name: none, division: none, existingId: null, matchNotSure: false },
        sites: [],
        assessments: [],
        documents: [],
      },
    })

    expect(screen.getByText(/Nothing could be read from these documents/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Client name/)).toHaveValue('')
  })
  it('fills the form in when Try again reads the documents after a failed read', async () => {
    let reads = 0
    intakeGateway(() =>
      ++reads === 1 ? json(503, { error: 'Privacy protection is unavailable.' }) : json(200, READ),
    )
    const { container } = open()
    await addFiles(container)
    await wait()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await wait(7000)

    expect(screen.getByLabelText(/^Client name/)).toHaveValue('Harbourline Properties')
    expect(screen.getByLabelText(/^Site name/)).toHaveValue('Tuas Distribution Centre')
  })

  it('moves documents tagged to a site that goes with a changed client back to Whole client', async () => {
    gateway({
      'GET /api/clients': () => json(200, CLIENTS),
      'GET /api/clients/c1/sites': () => json(200, SITES),
      'POST /api/client-intakes': () => json(201, { id: 'i1', files: [file('f1', 'Request.eml')] }),
      'POST /api/client-intakes/i1/read': () =>
        json(200, {
          ...READ,
          result: {
            ...RESULT,
            client: { ...RESULT.client, existingId: 'c1' },
            sites: [{ ...RESULT.sites[0], existingId: 's1' }],
          },
        }),
      'POST /api/client-intakes/i1/create': () =>
        json(201, { clientId: 'c1', assessments: [created('RPT-2026-0201')] }),
    })
    const { container } = open()
    await addFiles(container)
    await wait(7000)

    // Changing the client drops its ticked site; choosing it again ticks a fresh one.
    fireEvent.click(screen.getByRole('button', { name: 'Change client' }))
    type(screen.getByRole('combobox', { name: /^Client/ }), 'Harbourline Properties')
    await wait()
    fireEvent.click(screen.getByRole('checkbox', { name: /Jurong Cold Store/ }))
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Assessment 1' })).getByRole('radio', {
        name: 'Resurvey',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await wait()

    const [body] = sent('POST', '/api/client-intakes/i1/create').map((c) => c.body)
    expect(body).toMatchObject({
      documents: [
        { fileId: 'f1', placement: { kind: 'client' } },
        { fileId: 'f2', placement: { kind: 'client' } },
      ],
    })
  })

  it('keeps the first files when more are dropped while they are still uploading', async () => {
    let uploads = 0
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/client-intakes': () =>
        ++uploads === 1 ? new Promise<Response>(() => {}) : json(201, { id: 'i1', files: [] }),
      'POST /api/client-intakes/i1/read': () => new Promise<Response>(() => {}),
    })
    const { container } = open()
    await addFiles(container)

    const slim = container.querySelector<HTMLInputElement>('input[type=file]')!
    fireEvent.change(slim, { target: { files: [new File(['x'], 'Extra.pdf')] } })
    await wait()

    const second = sent('POST', '/api/client-intakes')[1].body as FormData
    expect(second.getAll('file').map((x) => (x as File).name)).toEqual([
      'Request.eml',
      'Lease.pdf',
      'photo.jpg',
      'Extra.pdf',
    ])
  })

  it('keeps the intake when the page is only put in the back-forward cache, and discards it otherwise', async () => {
    intakeGateway()
    const { container } = open()
    await addFiles(container)
    const pagehide = (persisted: boolean) =>
      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted }))

    pagehide(true)
    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(0)
    pagehide(false)
    expect(sent('DELETE', '/api/client-intakes/i1')).toHaveLength(1)
  })

  it('counts only the documents actually read on the done card', async () => {
    const gw = intakeGateway()
    const { container } = open()
    await addFiles(container)
    await gw.answer(
      json(200, {
        ...READ,
        files: [
          { ...file('f1', 'Request.eml'), status: 'read' },
          { ...file('f2', 'Lease.pdf'), status: 'failed', reason: 'Lease.pdf is damaged.' },
        ],
      }),
    )
    await wait(2200)

    // photo.jpg was refused at upload (not counted) and Lease.pdf failed: one of two read.
    expect(screen.getByText('1 of 2 documents read')).toBeInTheDocument()
  })

  it('focuses the first Not sure field and describes each one when the form opens', async () => {
    await readAll()

    const division = screen.getByLabelText(/^Division/)
    expect(division).toHaveFocus()
    expect(division).toHaveAccessibleDescription('Not sure, check it')
    expect(screen.getByLabelText(/^Facility type/)).toHaveAccessibleDescription(
      'Not sure, check it',
    )
    expect(screen.getByLabelText(/^Address/)).not.toHaveAccessibleDescription('Not sure, check it')
    // Card titles sit one level under the page's h1.
    expect(screen.getByRole('heading', { level: 2, name: 'Client' })).toBeInTheDocument()
  })
})

// The New Assessment form filled in by hand (CP-23 AC12, AC13, AC17-AC20).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../design-system'
import { NewAssessmentButton } from './components/NewAssessmentButton'
import { NewAssessment } from './screens/NewAssessment'
import { calls, CLIENTS, created, gateway, json, sent, SITES } from './testKit'

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const site = (n: number) => screen.getByRole('region', { name: 'Site ' + n })
const visit = (s: HTMLElement, n: number) =>
  within(within(s).getByRole('region', { name: 'Assessment ' + n }))

function open(onCreated = vi.fn()) {
  const view = render(
    <>
      <NewAssessment mode="form" start={{}} onCreated={onCreated} onLeave={vi.fn()} />
      <Toaster />
    </>,
  )
  return { ...view, onCreated }
}
// A new client's first site, filled in enough to create.
function fillNewClient() {
  type(screen.getByLabelText(/^Client name/), 'Pacific Crest REIT')
  type(within(site(1)).getByLabelText(/^Site name/), 'Tuas Hub')
  type(within(site(1)).getByLabelText(/^Facility type/), 'Distribution warehouse')
  type(within(site(1)).getByLabelText(/^Address/), '21 Tuas South Ave 3')
}
// Opens the client card's documents popover and adds files, as the picker would.
function addDocuments(names: string[]) {
  fireEvent.click(screen.getAllByRole('button', { name: /Add documents|Documents/ })[0])
  const dialog = screen.getByRole('dialog', { name: 'Client documents' })
  const files = names.map((n) => new File(['x'], n))
  fireEvent.change(within(dialog).getByLabelText('Add documents'), { target: { files } })
  return within(dialog)
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

describe('New Assessment by hand (CP-23)', () => {
  it('creates a new client’s two sites and three assessments together, assigned to me (AC17)', async () => {
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/assessments': () =>
        json(201, { clientId: 'c9', assessments: [created('R1'), created('R2'), created('R3')] }),
    })
    const { onCreated } = open()

    fillNewClient()
    type(screen.getByLabelText(/^Division/), 'Retail')
    fireEvent.click(within(site(1)).getByRole('button', { name: 'Add assessment' }))
    fireEvent.click(visit(site(1), 2).getByRole('radio', { name: 'Follow-up' }))
    type(visit(site(1), 2).getByLabelText(/^Survey start/), '03/12/2026')
    type(visit(site(1), 2).getByLabelText(/^Report due/), '17/12/2026')
    fireEvent.click(visit(site(1), 2).getByRole('button', { name: 'Add contact' }))
    type(visit(site(1), 2).getByRole('textbox', { name: 'Contact 1 name' }), 'Priya Nair')
    type(visit(site(1), 2).getByRole('textbox', { name: 'Contact 1 role' }), 'Facilities manager')

    fireEvent.click(screen.getByRole('button', { name: 'Add site' }))
    type(within(site(2)).getByLabelText(/^Site name/), 'Senai Hub')
    type(within(site(2)).getByLabelText(/^Address/), 'PLO 12, Senai')
    type(within(site(2)).getByLabelText(/^Jurisdiction/), 'MY')
    type(within(site(2)).getByLabelText(/^Facility type/), 'Cold store')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    const [post] = sent('POST', '/api/assessments')
    // No engineer is sent: the gateway assigns the signed-in engineer.
    expect(post.body).not.toHaveProperty('engineerId')
    expect(post.body).toMatchObject({
      client: { name: 'Pacific Crest REIT', division: 'Retail' },
      sites: [
        {
          name: 'Tuas Hub',
          address: '21 Tuas South Ave 3',
          jurisdiction: 'SG',
          facilityType: 'Distribution warehouse',
          assessments: [
            { visitType: 'First survey' },
            {
              // The gateway's stored name for Follow-up.
              visitType: 'Follow-up visit',
              siteVisitDate: '2026-12-03',
              reportDueDate: '2026-12-17',
              siteContacts: [{ name: 'Priya Nair', role: 'Facilities manager' }],
            },
          ],
        },
        { name: 'Senai Hub', jurisdiction: 'MY', assessments: [{ visitType: 'First survey' }] },
      ],
    })
    expect(onCreated.mock.calls[0][0]).toHaveLength(3)
    expect(await screen.findByText('3 assessments created')).toBeInTheDocument()
  }, 15000)

  it('marks each required field and explains each assessment type in one line (AC18)', () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()

    expect(screen.getByLabelText(/^Client name/)).toBeRequired()
    expect(screen.getByLabelText(/^Division/)).not.toBeRequired()
    for (const label of [/^Site name/, /^Jurisdiction/, /^Facility type/, /^Address/])
      expect(within(site(1)).getByLabelText(label)).toBeRequired()
    // The date picker marks a required field with a star beside its label.
    expect(visit(site(1), 1).getByText('*')).toBeInTheDocument()

    fireEvent.click(
      visit(site(1), 1).getByRole('button', { name: 'What the assessment types mean' }),
    )
    const help = screen.getByRole('dialog', { name: 'What the assessment types mean' })
    expect(help).toHaveTextContent('First survey')
    expect(help).toHaveTextContent('A periodic survey of a site we surveyed before.')
    expect(help).toHaveTextContent('A short check on an earlier survey’s recommendations.')
    expect(help).not.toHaveTextContent(/visit/i)
  })

  it('creates nothing with required fields empty, marking each and focusing the first (AC19)', () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    type(within(site(1)).getByLabelText(/^Site name/), 'Tuas Hub')
    // The survey start opens on today; emptied, it is missing too.
    type(visit(site(1), 1).getByLabelText(/^Survey start/), '')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(sent('POST', '/api/assessments')).toHaveLength(0)
    const name = screen.getByLabelText(/^Client name/)
    expect(name).toHaveFocus()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    for (const line of [
      'Add the client name',
      'Choose a facility type',
      'Add the address',
      'Add the survey start',
    ])
      expect(screen.getByText(line)).toBeInTheDocument()
    expect(screen.queryByText('Add the site name')).not.toBeInTheDocument()
    // No error box: only the lines under the fields.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Filling a field in clears its line.
    type(name, 'Pacific Crest REIT')
    expect(screen.queryByText('Add the client name')).not.toBeInTheDocument()
  })

  it('makes a new site’s first assessment a First survey, Follow-up and Resurvey not offered (AC20)', () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    const first = visit(site(1), 1)
    expect(first.getByRole('radio', { name: 'First survey' })).toBeChecked()
    expect(first.getByRole('radio', { name: 'Follow-up' })).toBeDisabled()
    expect(first.getByRole('radio', { name: 'Resurvey' })).toBeDisabled()
    fireEvent.click(first.getByRole('button', { name: 'What the assessment types mean' }))
    expect(
      screen.getByRole('dialog', { name: 'What the assessment types mean' }),
    ).toHaveTextContent('This site has no earlier assessment')

    // A later assessment of the same site may be any type.
    fireEvent.click(within(site(1)).getByRole('button', { name: 'Add assessment' }))
    expect(visit(site(1), 2).getByRole('radio', { name: 'Follow-up' })).toBeEnabled()
  })

  it('offers any type for a recorded client’s site with an earlier assessment, copying its locations', async () => {
    gateway({
      'GET /api/clients': () => json(200, CLIENTS),
      'GET /api/clients/c1/sites': () => json(200, SITES),
      'POST /api/assessments': () => json(201, { clientId: 'c1', assessments: [created('R1')] }),
    })
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Existing client' }))
    await act(async () => {})
    type(screen.getByRole('combobox', { name: /^Client/ }), 'harbourline properties')
    fireEvent.click(await screen.findByRole('checkbox', { name: /Jurong Cold Store/ }))

    const first = visit(site(1), 1)
    expect(first.getByRole('radio', { name: 'Follow-up' })).toBeEnabled()
    fireEvent.click(first.getByRole('radio', { name: 'Resurvey' }))
    expect(
      first.getByRole('switch', { name: 'Copy 6 locations from RPT-2026-0100 · 10/01/2026' }),
    ).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await vi.waitFor(() => expect(sent('POST', '/api/assessments')).toHaveLength(1))
    expect(sent('POST', '/api/assessments')[0].body).toMatchObject({
      client: { id: 'c1' },
      sites: [{ id: 's1', copyLocations: true, assessments: [{ visitType: 'Resurvey' }] }],
    })
  })

  it('keeps added documents under the client, Whole client unless I choose another tag (AC12)', async () => {
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/assessments': () =>
        json(201, { clientId: 'c9', assessments: [created('R1', 'Tuas Hub')] }),
      'POST /api/clients/c9/documents': () =>
        json(201, {
          files: [
            { name: 'Lease.pdf', status: 'kept', document: { id: 'd1' } },
            { name: 'Plan.pdf', status: 'kept', document: { id: 'd2' } },
          ],
        }),
      'PATCH /api/client-documents/d2': () => json(200, {}),
    })
    open()
    fillNewClient()

    const docs = addDocuments(['Lease.pdf', 'Plan.pdf'])
    expect(docs.getByRole('button', { name: 'Tag of Lease.pdf: Whole client' })).toBeInTheDocument()
    fireEvent.click(docs.getByRole('button', { name: 'Tag of Plan.pdf: Whole client' }))
    fireEvent.click(screen.getByRole('option', { name: 'Tuas Hub' }))
    expect(docs.getByRole('button', { name: 'Tag of Plan.pdf: Tuas Hub' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await vi.waitFor(() => expect(sent('PATCH', '/api/client-documents/d2')).toHaveLength(1))
    const [upload] = sent('POST', '/api/clients/c9/documents')
    expect((upload.body as FormData).getAll('file').map((x) => (x as File).name)).toEqual([
      'Lease.pdf',
      'Plan.pdf',
    ])
    // Lease.pdf stays Whole client; Plan.pdf goes under the site created.
    expect(sent('PATCH', '/api/client-documents/d2')[0].body).toEqual({
      placement: { kind: 'site', siteId: 'site-R1' },
    })
    expect(sent('PATCH', '/api/client-documents/d1')).toHaveLength(0)
  })

  it('refuses a file of another type with the reason, adding the rest', async () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    const docs = addDocuments(['Lease.pdf', 'archive.zip'])

    expect(docs.getByText('Lease.pdf')).toBeInTheDocument()
    expect(docs.queryByText('archive.zip')).not.toBeInTheDocument()
    expect(await screen.findByText("Can't read .zip files.")).toBeInTheDocument()
    expect(screen.getByText('Add PDF, Word, Outlook (.msg) or .eml files.')).toBeInTheDocument()
  })

  it('asks before removing a filled-in site, then says it was removed', async () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }))
    type(within(site(2)).getByLabelText(/^Site name/), 'Senai Hub')
    fireEvent.click(screen.getByRole('button', { name: 'Remove site 2' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Senai Hub?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Senai Hub removed')).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Site 2' })).not.toBeInTheDocument(),
    )
  })

  it('keeps nothing when I leave without creating (AC13)', () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    const { unmount } = open()
    addDocuments(['Lease.pdf'])

    unmount()

    // Listing clients is a read; nothing was uploaded or created.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('shows the gateway’s problems under their fields', async () => {
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/assessments': () =>
        json(400, {
          error: 'The details are invalid.',
          fields: { 'sites.0.assessments.0.reportDueDate': 'Due before the survey' },
        }),
    })
    open()
    fillNewClient()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Due before the survey')).toBeInTheDocument()
    expect(visit(site(1), 1).getByLabelText(/^Report due/)).toHaveFocus()
  })

  it('says documents whose tag could not be saved were kept under Whole client', async () => {
    gateway({
      'GET /api/clients': () => json(200, []),
      'POST /api/assessments': () =>
        json(201, { clientId: 'c9', assessments: [created('R1', 'Tuas Hub')] }),
      'POST /api/clients/c9/documents': () =>
        json(201, { files: [{ name: 'Plan.pdf', status: 'kept', document: { id: 'd2' } }] }),
      'PATCH /api/client-documents/d2': () => json(500, { error: 'Something went wrong.' }),
    })
    open()
    fillNewClient()
    const docs = addDocuments(['Plan.pdf'])
    fireEvent.click(docs.getByRole('button', { name: 'Tag of Plan.pdf: Whole client' }))
    fireEvent.click(screen.getByRole('option', { name: 'Tuas Hub' }))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Tags not saved')).toBeInTheDocument()
    expect(
      screen.getByText('Kept under Whole client. Retag them on the client page.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Documents not kept')).not.toBeInTheDocument()
  })

  it('shows dates as dd/mm/yyyy, and a placeholder when empty', () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    const start = visit(site(1), 1).getByLabelText(/^Survey start/)
    const end = visit(site(1), 1).getByLabelText(/^Survey end/)

    type(start, '12/11/2026')

    expect(start).toHaveValue('12/11/2026')
    expect(end).toHaveValue('')
    expect(end).toHaveAttribute('placeholder', 'dd/mm/yyyy')
  })

  it('blocks an end or due date before the start, but not an equal one', async () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    fillNewClient()
    const one = visit(site(1), 1)
    type(one.getByLabelText(/^Survey start/), '15/02/2027')
    type(one.getByLabelText(/^Survey end/), '15/02/2027')
    type(one.getByLabelText(/^Report due/), '14/02/2027')

    expect(one.getAllByText('Pick a date on or after 15/02/2027, the survey start.')).toHaveLength(
      1,
    )
    type(one.getByLabelText(/^Survey end/), '14/02/2027')
    expect(one.getAllByText('Pick a date on or after 15/02/2027, the survey start.')).toHaveLength(
      2,
    )
  })

  it('shows a date out of order first on Create, and creates nothing', async () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    fillNewClient()
    const one = visit(site(1), 1)
    type(one.getByLabelText(/^Survey start/), '15/02/2027')
    type(one.getByLabelText(/^Survey end/), '14/02/2027')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await one.findByLabelText(/^Survey end/)).toHaveFocus()
    expect(sent('POST', '/api/assessments')).toHaveLength(0)
  })

  it('names the documents button with its count, and says so when there are none', () => {
    gateway({ 'GET /api/clients': () => json(200, []) })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(
      within(screen.getByRole('dialog', { name: 'Client documents' })).getByText(
        'No documents added yet',
      ),
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    addDocuments(['Lease.pdf', 'Plan.pdf'])

    expect(screen.getByRole('button', { name: 'Documents · 2' })).toBeInTheDocument()
  })

  it('moves focus into the start menu when it opens', () => {
    render(<NewAssessmentButton onStart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New assessment' }))
    expect(screen.getByRole('button', { name: /^Fill in the form/ })).toHaveFocus()
  })
})

describe('A new site on the map (CP-26)', () => {
  const body = () =>
    sent('POST', '/api/assessments')[0].body as { sites: Record<string, unknown>[] }
  const assessments = () => json(201, { clientId: 'c9', assessments: [created('RPT-2026-0900')] })

  it('sends pasted coordinates with the new site (AC2)', async () => {
    gateway({ 'GET /api/clients': () => json(200, []), 'POST /api/assessments': assessments })
    const { onCreated } = open()
    fillNewClient()
    type(within(site(1)).getByLabelText(/^Coordinates/), '1.2966, 103.8520')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(body().sites[0].coordinates).toEqual({ lat: 1.2966, lng: 103.852 })
  })

  it('creates a site without coordinates as before (AC4)', async () => {
    gateway({ 'GET /api/clients': () => json(200, []), 'POST /api/assessments': assessments })
    const { onCreated } = open()
    fillNewClient()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(body().sites[0]).not.toHaveProperty('coordinates')
  })

  it('names coordinates it cannot read, and creates nothing (AC3)', async () => {
    gateway({ 'GET /api/clients': () => json(200, []), 'POST /api/assessments': assessments })
    open()
    fillNewClient()
    type(within(site(1)).getByLabelText(/^Coordinates/), '91, 103')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create' })))
    expect(within(site(1)).getByText(/Enter coordinates such as/)).toBeInTheDocument()
    expect(sent('POST', '/api/assessments')).toHaveLength(0)
  })
})

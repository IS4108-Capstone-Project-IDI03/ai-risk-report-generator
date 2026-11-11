// Customising the checklist on its tab (CP-32): adding, editing, removing and
// restoring items, choosing a reference from the standards, and the PDF.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Checklist as ChecklistData, ChecklistItem, ChecklistView } from './api'
import { Checklist } from './screens/Checklist'

const REF = 'RPT-2026-0517'
const URL_ = `/api/assessments/${REF}/checklist`
const NFPA13 = {
  id: 'nfpa13',
  title: 'NFPA 13 Sprinkler Systems',
  issuingBody: 'NFPA',
  standardNumber: '13',
  edition: '2025',
  sourceType: 'nfpa_standard',
  uploadedAt: '2026-10-01T00:00:00.000Z',
}
const item = (fields: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'i',
  area: '7',
  subsection: null,
  origin: 'standard',
  hazard: null,
  text: '',
  fields: [],
  COPE_dimension: ['Construction'],
  citations: [],
  flags: [],
  status: 'active',
  edited: null,
  removed: null,
  check: null,
  ...fields,
})
const TEMPLATE = item({
  id: 'i1',
  origin: 'template',
  subsection: 'Construction Narrative',
  text: 'Walls, roof, frame and floors',
})
const ROOF = item({
  id: 'i2',
  subsection: 'Construction Narrative',
  text: 'Check the roof deck is non-combustible.',
  citations: [{ ref: 'C:nfpa13:40', quote: 'Roof decks', quoteFound: true }],
})
const RACKS = item({
  id: 'i3',
  area: 'hazards',
  origin: 'hazard',
  hazard: 'rack_storage',
  COPE_dimension: ['Occupancy'],
  text: 'Check in-rack sprinklers are fitted for racks over 7.6 m.',
})
const checklist = (items: ChecklistItem[]): ChecklistData => ({
  id: 'c1',
  facilityType: 'Distribution warehouse',
  jurisdiction: 'SG',
  standards: [{ ...NFPA13 }],
  areas: [{ id: '7', title: 'Construction' }],
  items,
  hazards: [
    { id: 'rack_storage', name: 'Rack storage', standards: ['NFPA 13'], inScope: ['NFPA 13'] },
  ],
  sources: {
    'C:nfpa13:40': { text: 'Roof decks shall be…', doc_id: 'nfpa13', page_start: 40 },
  },
  provenance: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'medium',
    prompt_version: 'cp30-v1',
    checklist_version: 'checklist-v1-2026-10',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-26T06:02:00.000Z',
  },
  createdAt: '2026-10-26T06:02:00.000Z',
})
const view = (items: ChecklistItem[]): ChecklistView => ({
  scope: { facilityType: 'Distribution warehouse', jurisdiction: 'SG' },
  standards: [NFPA13],
  checklist: checklist(items),
})
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
    clear: () => kept.clear(),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The gateway: the checklist as first shown, and each change's answer.
function serve(
  first: ChecklistView,
  answer: (url: string, init?: RequestInit) => unknown = () => first,
) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/sections')) return json([])
    if (url === URL_ && (init?.method ?? 'GET') === 'GET') return json(first)
    return json(answer(url, init))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const sent = (fetch: ReturnType<typeof serve>, method: string) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => [url, init?.body ? JSON.parse(String(init.body)) : undefined])

function open(canGenerate = true) {
  render(
    <Checklist
      reference={REF}
      canGenerate={canGenerate}
      answering={null}
      onViewObservation={() => undefined}
    />,
  )
}

describe('customising the checklist (CP-32)', () => {
  it('edits an item and keeps the template’s and a risk’s last item from removal', async () => {
    const edited = {
      ...ROOF,
      text: 'Check the roof deck and insulation.',
      edited: { at: '', by: 'Alex Rowe' },
    }
    const fetch = serve(view([TEMPLATE, ROOF, RACKS]), () => view([TEMPLATE, edited, RACKS]))
    open()
    fireEvent.click(await screen.findByRole('tab', { name: /Report sections/ }))

    fireEvent.click(screen.getByRole('button', { name: `Edit item ${ROOF.text}` }))
    const dialog = screen.getByRole('dialog', { name: 'Edit item' })
    fireEvent.change(within(dialog).getByLabelText('What to check'), {
      target: { value: 'Check the roof deck and insulation.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(sent(fetch, 'PATCH')).toEqual([
        [`${URL_}/items/i2`, { text: 'Check the roof deck and insulation.' }],
      ]),
    )
    const row = await screen.findByRole('listitem', { name: 'Check the roof deck and insulation.' })
    expect(within(row).getByText('Edited')).toBeInTheDocument()

    // The template's subsection and the risk's only item stay, with the reason.
    fireEvent.click(screen.getByRole('switch'))
    const template = screen.getByRole('button', { name: 'Remove item Construction Narrative' })
    expect(template).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(template)
    expect((await screen.findAllByText(/The report has this subsection/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: /Priority risks/ }))
    expect(screen.getByRole('button', { name: `Remove item ${RACKS.text}` })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(sent(fetch, 'POST')).toEqual([])
  })

  it('removes an item to the Removed list, and restores it', async () => {
    const removed = {
      ...ROOF,
      status: 'removed' as const,
      removed: { at: '2026-11-11T02:00:00.000Z', by: 'Alex Rowe' },
    }
    const fetch = serve(view([TEMPLATE, ROOF, RACKS]), (url) =>
      url.endsWith('/remove') ? view([TEMPLATE, removed, RACKS]) : view([TEMPLATE, ROOF, RACKS]),
    )
    open()
    fireEvent.click(await screen.findByRole('tab', { name: /Report sections/ }))

    fireEvent.click(screen.getByRole('button', { name: `Remove item ${ROOF.text}` }))

    const list = await screen.findByRole('group', { name: 'Removed items' })
    expect(within(list).getByText('Removed items (1)')).toBeInTheDocument()
    expect(within(list).getByText(/Removed by Alex Rowe/)).toBeInTheDocument()
    // Gone from the section it was in.
    expect(screen.queryByRole('button', { name: `Edit item ${ROOF.text}` })).toBeNull()

    fireEvent.click(within(list).getByRole('button', { name: `Restore item ${ROOF.text}` }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Removed items' })).toBeNull())
    expect(sent(fetch, 'POST').map(([url]) => url)).toEqual([
      `${URL_}/items/i2/remove`,
      `${URL_}/items/i2/restore`,
    ])
  })

  it('adds an item to a risk, with a reference chosen from the standards (AC1-2)', async () => {
    const passage = {
      ref: 'C:nfpa13:200',
      documentId: 'nfpa13',
      text: 'Flue spaces shall be kept clear. Transverse flues 75 mm.',
      headings: ['Rack Storage'],
      pageStart: 200,
      pageEnd: 200,
    }
    const own = item({
      id: 'i9',
      area: 'hazards',
      hazard: 'rack_storage',
      origin: 'manual',
      text: 'Check flue spaces are kept clear.',
      COPE_dimension: ['Occupancy'],
    })
    const fetch = serve(view([TEMPLATE, ROOF, RACKS]), (url, init) => {
      if (url.includes('/passages?')) return { results: [passage] }
      if (init?.method === 'POST') return { ...view([TEMPLATE, ROOF, RACKS, own]), itemId: 'i9' }
      return view([
        TEMPLATE,
        ROOF,
        RACKS,
        {
          ...own,
          citations: [
            { ref: passage.ref, quote: 'Flue spaces shall be kept clear.', quoteFound: true },
          ],
        },
      ])
    })
    open()

    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = screen.getByRole('dialog', { name: 'Add item' })
    expect(within(dialog).getByLabelText('Where')).toHaveValue('hazards:rack_storage')
    fireEvent.change(within(dialog).getByLabelText('What to check'), {
      target: { value: 'Check flue spaces are kept clear.' },
    })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Occupancy/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reference' }))

    // The search starts from the item's own words.
    const found = await screen.findByRole('list', { name: 'Passages found' })
    expect(
      fetch.mock.calls.some(
        ([url]) => url === `${URL_}/passages?q=Check%20flue%20spaces%20are%20kept%20clear.`,
      ),
    ).toBe(true)
    fireEvent.click(within(found).getByRole('button', { name: /NFPA 13 · p. 200/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this passage' }))
    const refs = screen.getByRole('region', { name: 'References' })
    expect(within(refs).getByText('“Flue spaces shall be kept clear.”')).toBeInTheDocument()
    const adding = screen.getByRole('dialog', { name: 'Add item' })
    fireEvent.click(within(adding).getByRole('button', { name: 'Add item' }))

    await waitFor(() => expect(sent(fetch, 'PATCH')).toHaveLength(1))
    expect(sent(fetch, 'POST')).toEqual([
      [
        `${URL_}/items`,
        {
          area: 'hazards',
          subsection: null,
          hazard: 'rack_storage',
          text: 'Check flue spaces are kept clear.',
          COPE_dimension: ['Occupancy'],
        },
      ],
    ])
    expect(sent(fetch, 'PATCH')).toEqual([
      [`${URL_}/items/i9`, { citations: [{ ref: 'C:nfpa13:200', quote: '' }] }],
    ])
    const row = await screen.findByRole('listitem', { name: 'Check flue spaces are kept clear.' })
    expect(within(row).getByText('Added')).toBeInTheDocument()
  })

  it('asks for the wording and a category before adding', async () => {
    const fetch = serve(view([TEMPLATE, ROOF, RACKS]))
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = screen.getByRole('dialog', { name: 'Add item' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add item' }))
    expect(within(dialog).getByText('Write what to check.')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose at least one category.')).toBeInTheDocument()
    expect(sent(fetch, 'POST')).toEqual([])
  })

  it('shows no changes to anyone but the assigned engineer, who can still download the PDF (AC4, AC6)', async () => {
    const fetch = serve(view([TEMPLATE, ROOF, RACKS]))
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    )
    fetch.mockImplementation((url: string) => {
      if (url.endsWith('/pdf'))
        return Promise.resolve(
          new Response('%PDF-1.4', {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${REF} checklist 2026-11-11.pdf"`,
            },
          }),
        )
      if (url.endsWith('/sections')) return json([])
      return json(view([TEMPLATE, ROOF, RACKS]))
    })
    open(false)
    await screen.findByRole('tab', { name: /Priority risks/ })
    expect(screen.queryByRole('button', { name: /^Edit item/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Download checklist PDF' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`${URL_}/pdf`))
  })

  it('says which of the engineer’s changes were kept after regenerating (AC3)', async () => {
    const own = item({ id: 'i9', origin: 'manual', text: 'Check the cladding.' })
    const first = view([TEMPLATE, ROOF, RACKS, own])
    serve(first, () => ({
      ...first,
      carryOver: {
        kept: 0,
        dropped: [],
        mayReplace: [],
        changes: { edited: 0, added: 1, removed: 0 },
      },
    }))
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))
    const ask = screen.getByRole('dialog', { name: 'Regenerate the checklist?' })
    expect(ask).toHaveTextContent('Your edited, added and removed items are kept too.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Regenerate' }))
    expect(
      await screen.findByText('Your 1 added item is kept. All your answers are kept.'),
    ).toBeInTheDocument()
  })
})

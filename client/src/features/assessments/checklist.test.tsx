import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import type { Checklist as ChecklistData, ChecklistView } from './api'
import { Checklist } from './screens/Checklist'

const REF = 'RPT-2026-0517'
const NFPA13 = {
  id: 'nfpa13',
  title: 'NFPA 13 Sprinkler Systems',
  issuingBody: 'NFPA',
  standardNumber: '13',
  edition: '2025',
  sourceType: 'nfpa_standard',
  uploadedAt: '2026-10-01T00:00:00.000Z',
}
const FM157 = {
  ...NFPA13,
  id: 'fm157',
  title: 'FM 1-57 Plastics in Construction',
  issuingBody: 'FM',
  standardNumber: '1-57',
  sourceType: 'fm_standard',
}
const CHECKLIST: ChecklistData = {
  id: 'c1',
  facilityType: 'Distribution warehouse',
  jurisdiction: 'SG',
  standards: [{ ...NFPA13 }],
  areas: [{ id: '7', title: 'Construction' }],
  items: [
    {
      id: 'i1',
      area: '7',
      subsection: 'Construction Narrative',
      origin: 'template',
      hazard: null,
      text: 'Walls, roof, frame and floors',
      fields: [],
      COPE_dimension: ['Construction'],
      citations: [],
      flags: [],
    },
    {
      id: 'i2',
      area: 'hazards',
      subsection: null,
      origin: 'hazard',
      hazard: 'rack_storage',
      text: 'Check in-rack sprinklers are fitted for racks over 7.6 m.',
      fields: [],
      COPE_dimension: ['Occupancy'],
      citations: [{ ref: 'C:nfpa13:118', quote: 'rack storage over 7.6 m', quoteFound: true }],
      flags: [],
    },
    {
      id: 'i3',
      area: 'hazards',
      subsection: null,
      origin: 'hazard_list',
      hazard: 'roofing',
      text: 'Check the roof deck, covering and insulation',
      fields: [],
      COPE_dimension: ['Construction'],
      citations: [],
      flags: ['uncited'],
    },
  ],
  hazards: [
    {
      id: 'rack_storage',
      name: 'Rack and high-piled storage',
      standards: ['NFPA 13'],
      inScope: ['NFPA 13'],
    },
    { id: 'roofing', name: 'Roofing materials', standards: ['FM 1-57'], inScope: [] },
  ],
  sources: {
    'C:nfpa13:118': {
      text: 'In-rack sprinklers shall be provided for rack storage over 7.6 m in height.',
      doc_id: 'nfpa13',
      headings: ['Rack Storage'],
      page_start: 118,
    },
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
}
const view = (checklist: ChecklistData | null, standards = [NFPA13, FM157]): ChecklistView => ({
  scope: { facilityType: 'Distribution warehouse', jurisdiction: 'SG' },
  standards,
  checklist,
})
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function serve(first: ChecklistView, generated?: ChecklistView | (() => Promise<Response>)) {
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return typeof generated === 'function' ? generated() : json(generated ?? first)
    return json(first)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('lists the standards that apply, all ticked, and generates from those kept (AC1-2)', async () => {
  const fetch = serve(view(null), view(CHECKLIST))
  render(<Checklist reference={REF} canGenerate />)

  expect(await screen.findByText('Pre-survey checklist')).toBeInTheDocument()
  expect(screen.getByText('Standards to use (2 of 2 selected)')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(/FM 1-57 Plastics in Construction/))
  expect(screen.getByText('Standards to use (1 of 2 selected)')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate checklist' }))

  await screen.findByRole('region', { name: 'Rack and high-piled storage' })
  const [, init] = fetch.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(JSON.parse(String(init!.body))).toEqual({ standardIds: ['nfpa13'] })
  expect(screen.getByRole('button', { name: 'Regenerate checklist' })).toBeInTheDocument()
})

it('shows each area and hazard, the AI items marked and citations opening to the passage (AC3-8)', async () => {
  serve(view(CHECKLIST))
  render(<Checklist reference={REF} canGenerate={false} />)

  // A section the standards add nothing to is named in one line, not shown; All sections
  // shows it, saying so, with the template's rows.
  const left = await screen.findByRole('region', { name: 'No specific requirements' })
  expect(within(left).getByText('7. Construction')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '7. Construction' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: 'All sections' }))
  const construction = screen.getByRole('region', { name: '7. Construction' })
  expect(
    within(construction).getByText('Nothing specific in the selected standards.'),
  ).toBeVisible()
  expect(within(construction).getByText('Construction Narrative')).toBeInTheDocument()
  expect(within(construction).queryByText('AI-generated')).not.toBeInTheDocument()

  const racks = screen.getByRole('region', { name: 'Rack and high-piled storage' })
  expect(within(racks).getByText('AI-generated')).toBeInTheDocument()
  // The citation names the standard and page; opened, it shows the quoted words and passage.
  const citation = within(racks).getByRole('button', { name: 'NFPA 13 p. 118' })
  fireEvent.click(citation)
  expect(citation).toHaveAttribute('aria-expanded', 'true')
  expect(within(racks).getByText(/“rack storage over 7.6 m”/)).toBeInTheDocument()
  expect(within(racks).getByLabelText('Passage text')).toHaveTextContent('In-rack sprinklers')
  expect(
    within(racks).getByRole('link', { name: 'Open the original PDF at page 118' }),
  ).toHaveAttribute('href', '/api/knowledge-documents/nfpa13/file#page=118')

  // AC7: a risk names its standards when they were ticked; when none was, its general
  // check says which would give a specific one: FM 1-57 applies but was left unticked.
  expect(within(racks).getByText('Checked against NFPA 13.')).toBeInTheDocument()
  const roofing = screen.getByRole('region', { name: 'Roofing materials' })
  expect(within(roofing).queryByText(/Checked against/)).not.toBeInTheDocument()
  expect(
    within(roofing).getByText(
      'None of the selected standards covers this risk. Selecting FM 1-57 above would give specific checks.',
    ),
  ).toBeInTheDocument()
  // The hazard list's own item is the team's, not the model's (AC8).
  expect(within(roofing).queryByText('AI-generated')).not.toBeInTheDocument()
  // AC9: when and how it was generated.
  expect(
    screen.getByText(/claude-opus-5-5 · 1 standard · checklist-v1-2026-10/),
  ).toBeInTheDocument()
})

it('lets anyone else read the checklist but not generate it (AC11)', async () => {
  serve(view(null))
  render(<Checklist reference={REF} canGenerate={false} />)

  expect(await screen.findByText('No checklist yet')).toBeInTheDocument()
  expect(screen.getByText(/assigned engineer generates its checklist/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Generate checklist/ })).not.toBeInTheDocument()
  expect(screen.getByLabelText(/NFPA 13 Sprinkler Systems/)).toBeDisabled()
})

it('says when no standards apply, and still generates (AC10)', async () => {
  serve(view(null, []))
  render(<Checklist reference={REF} canGenerate />)

  expect(await screen.findByText(/No standards in the knowledge base apply/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate checklist' })).toBeEnabled()
})

it('shows why generating failed and keeps the last checklist', async () => {
  serve(view(CHECKLIST), () => json({ error: 'The language model could not be reached.' }, 503))
  render(<Checklist reference={REF} canGenerate />)

  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))

  await waitFor(() =>
    expect(screen.getByText(/The language model could not be reached\./)).toBeInTheDocument(),
  )
  expect(screen.getByText(/The checklist below is the last one generated/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Rack and high-piled storage' })).toBeInTheDocument()
})

it('ticks the standards the last checklist used, and any added since', async () => {
  // NFPA 13 was used; FM 1-57 was left out; NFPA 25 was added after the checklist.
  const NFPA25 = {
    ...NFPA13,
    id: 'nfpa25',
    title: 'NFPA 25 Inspection and Testing',
    uploadedAt: '2026-10-27T00:00:00.000Z',
  }
  const fetch = serve(view(CHECKLIST, [NFPA13, FM157, NFPA25]))
  render(<Checklist reference={REF} canGenerate />)

  expect(await screen.findByText('Standards to use (2 of 3 selected)')).toBeInTheDocument()
  expect(screen.getByLabelText(/FM 1-57 Plastics in Construction/)).not.toBeChecked()
  expect(screen.getByLabelText(/NFPA 25 Inspection and Testing/)).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate checklist' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
  const [, init] = fetch.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(JSON.parse(String(init!.body))).toEqual({ standardIds: ['nfpa13', 'nfpa25'] })
})

it('says when no facility risks are configured for the facility type', async () => {
  serve(
    view({
      ...CHECKLIST,
      facilityType: 'Warehouse',
      hazards: [],
      items: CHECKLIST.items.slice(0, 1),
    }),
  )
  render(<Checklist reference={REF} canGenerate={false} />)

  expect(
    await screen.findByText(/No facility risks are configured for ‘Warehouse’/),
  ).toBeInTheDocument()
})

it('puts the priority risks first, then each report section once, by subsection', async () => {
  const sprinklers = {
    ...CHECKLIST.items[1],
    id: 'i4',
    area: '7',
    subsection: 'Construction Narrative',
    origin: 'standard' as const,
    hazard: null,
    text: 'Check composite wood joist channels are firestopped.',
  }
  serve(view({ ...CHECKLIST, items: [...CHECKLIST.items, sprinklers] }))
  const { container } = render(<Checklist reference={REF} canGenerate={false} />)

  const headings = () => [...container.querySelectorAll('h3, h4')].map((h) => h.textContent)
  await screen.findByText('Priority risks')
  expect(headings().indexOf('Priority risks')).toBeLessThan(headings().indexOf('Report sections'))
  // Construction is shown once, its requirement under the subsection's name.
  expect(headings().filter((h) => h === '7. Construction')).toHaveLength(1)
  const construction = screen.getByRole('region', { name: '7. Construction' })
  expect(within(construction).getByText('AI-generated')).toBeInTheDocument()
  expect(within(construction).getByText('Construction Narrative')).toBeInTheDocument()
  expect(within(construction).queryByText('Walls, roof, frame and floors')).not.toBeInTheDocument()

  // Switched to the full report template: the template's row, then the requirement beneath it.
  const full = screen.getByRole('switch', { name: 'All sections' })
  expect(full).not.toBeChecked()
  fireEvent.click(full)
  expect(full).toBeChecked()
  const text = construction.textContent ?? ''
  expect(text.indexOf('Walls, roof, frame and floors')).toBeGreaterThan(-1)
  expect(text.indexOf('Walls, roof, frame and floors')).toBeLessThan(
    text.indexOf('Check composite wood joist channels are firestopped.'),
  )
})

it('says which standard to add when none that applies covers a risk', async () => {
  serve(view(CHECKLIST, [NFPA13]))
  render(<Checklist reference={REF} canGenerate={false} />)

  const roofing = await screen.findByRole('region', { name: 'Roofing materials' })
  expect(
    within(roofing).getByText(
      'None of the selected standards covers this risk. Adding FM 1-57 to the knowledge base would give specific checks.',
    ),
  ).toBeInTheDocument()
})

it('warns when the site has changed since the checklist was generated', async () => {
  serve({
    ...view(CHECKLIST),
    scope: { facilityType: 'Cold store', jurisdiction: 'SG' },
  })
  render(<Checklist reference={REF} canGenerate />)

  expect(await screen.findByText('This checklist is out of date')).toBeInTheDocument()
  expect(
    screen.getByText(
      /generated for Distribution warehouse in Singapore; the site is now Cold store/,
    ),
  ).toBeInTheDocument()
})

it('gives no warning while the site is as it was', async () => {
  serve(view(CHECKLIST))
  render(<Checklist reference={REF} canGenerate />)

  await screen.findByText('Priority risks')
  expect(screen.queryByText('This checklist is out of date')).not.toBeInTheDocument()
})

it('shows two citations of one page as one, opening to both quotes', async () => {
  const twice = {
    ...CHECKLIST.items[1],
    citations: [
      { ref: 'C:nfpa13:118', quote: 'rack storage over 7.6 m', quoteFound: true },
      { ref: 'C:nfpa13:118', quote: 'In-rack sprinklers shall be provided', quoteFound: true },
    ],
  }
  serve(view({ ...CHECKLIST, items: [CHECKLIST.items[0], twice, CHECKLIST.items[2]] }))
  render(<Checklist reference={REF} canGenerate={false} />)

  const racks = await screen.findByRole('region', { name: 'Rack and high-piled storage' })
  const [chip] = within(racks).getAllByRole('button', { name: 'NFPA 13 p. 118' })
  expect(within(racks).getAllByRole('button', { name: 'NFPA 13 p. 118' })).toHaveLength(1)
  fireEvent.click(chip)
  expect(within(racks).getByText(/“rack storage over 7.6 m”/)).toBeInTheDocument()
  expect(within(racks).getByText(/“In-rack sprinklers shall be provided”/)).toBeInTheDocument()
  expect(within(racks).getAllByLabelText('Passage text')).toHaveLength(1)
})

it('switches back to the relevant sections from its name beside the switch', async () => {
  serve(view(CHECKLIST))
  render(<Checklist reference={REF} canGenerate={false} />)

  const full = await screen.findByRole('switch', { name: 'All sections' })
  fireEvent.click(full)
  expect(screen.getByText('Construction Narrative')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Relevant sections' }))
  expect(full).not.toBeChecked()
  expect(screen.queryByText('Construction Narrative')).not.toBeInTheDocument()
})

it('marks a quote not found in its passage as unverified, and says to verify it', async () => {
  const misquoted = {
    ...CHECKLIST.items[1],
    citations: [{ ref: 'C:nfpa13:118', quote: 'racks over 25 ft', quoteFound: false }],
  }
  serve(view({ ...CHECKLIST, items: [CHECKLIST.items[0], misquoted, CHECKLIST.items[2]] }))
  render(<Checklist reference={REF} canGenerate={false} />)

  const racks = await screen.findByRole('region', { name: 'Rack and high-piled storage' })
  expect(within(racks).getByText('Unverified quote')).toBeInTheDocument()
  fireEvent.click(within(racks).getByRole('button', { name: 'NFPA 13 p. 118' }))
  expect(
    within(racks).getByText(
      "The AI's quoted words are not word for word in this passage. Verify before use.",
    ),
  ).toBeInTheDocument()
})

it('leaves out a heading too long to be one when a passage is opened', async () => {
  const story = 'Loss Examples. The hot work permit system was not followed. '.repeat(5)
  const source = CHECKLIST.sources['C:nfpa13:118']
  serve(
    view({
      ...CHECKLIST,
      sources: { 'C:nfpa13:118': { ...source, headings: ['Rack Storage', story] } },
    }),
  )
  render(<Checklist reference={REF} canGenerate={false} />)

  const racks = await screen.findByRole('region', { name: 'Rack and high-piled storage' })
  fireEvent.click(within(racks).getByRole('button', { name: 'NFPA 13 p. 118' }))
  expect(within(racks).getByText(/p\. 118 › Rack Storage$/)).toBeInTheDocument()
  expect(within(racks).queryByText(/hot work permit/)).not.toBeInTheDocument()
})

it('shows all sections from the link beside the sections left out', async () => {
  serve(view(CHECKLIST))
  render(<Checklist reference={REF} canGenerate={false} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Show all sections' }))
  expect(screen.getByRole('switch', { name: 'All sections' })).toBeChecked()
  expect(screen.getByRole('region', { name: '7. Construction' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'No specific requirements' })).not.toBeInTheDocument()
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Checklist as ChecklistData, ChecklistView } from './api'
import type { ChecklistAnswering } from './components/ChecklistItems'
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
      check: null,
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
      check: null,
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
      check: null,
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

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
// Node in CI has no localStorage (a laptop's may), so each test brings its own,
// empty, for the remembered Relevant or All sections.
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

function serve(first: ChecklistView, generated?: ChecklistView | (() => Promise<Response>)) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/sections')) return json([])
    if (init?.method === 'POST')
      return typeof generated === 'function' ? generated() : json(generated ?? first)
    return json(first)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const viewed = vi.fn()
const show = (canGenerate: boolean, answering: ChecklistAnswering | null = null) =>
  render(
    <Checklist
      reference={REF}
      canGenerate={canGenerate}
      answering={answering}
      onViewObservation={viewed}
    />,
  )
// The checklist's two tabs.
const openTab = async (name: 'Priority risks' | 'Report sections') =>
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp('^' + name) }))

it('lists the standards that apply, all ticked, and generates from those kept (AC1-2)', async () => {
  const fetch = serve(view(null), view(CHECKLIST))
  show(true)

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
  show(false)

  // The priority risks are their own tab, shown first.
  const racks = await screen.findByRole('region', { name: 'Rack and high-piled storage' })
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

  // A section the standards add nothing to is named in one line, not shown; All sections
  // shows it, saying so, with the template's rows.
  await openTab('Report sections')
  const left = screen.getByRole('region', { name: 'No specific requirements' })
  expect(within(left).getByText('7. Construction')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '7. Construction' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: 'All sections' }))
  const construction = screen.getByRole('region', { name: '7. Construction' })
  expect(
    within(construction).getByText('Nothing specific in the selected standards.'),
  ).toBeVisible()
  expect(within(construction).getByText('Construction Narrative')).toBeInTheDocument()
  expect(within(construction).queryByText('AI-generated')).not.toBeInTheDocument()
})

it('lets anyone else read the checklist but not generate it (AC11)', async () => {
  serve(view(null))
  show(false)

  expect(await screen.findByText('No checklist yet')).toBeInTheDocument()
  expect(screen.getByText(/assigned engineer generates its checklist/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Generate checklist/ })).not.toBeInTheDocument()
  expect(screen.getByLabelText(/NFPA 13 Sprinkler Systems/)).toBeDisabled()
})

it('says when no standards apply, and still generates (AC10)', async () => {
  serve(view(null, []))
  show(true)

  expect(await screen.findByText(/No standards in the knowledge base apply/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate checklist' })).toBeEnabled()
})

it('shows why generating failed and keeps the last checklist', async () => {
  serve(view(CHECKLIST), () => json({ error: 'The language model could not be reached.' }, 503))
  show(true)

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
  show(true)

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
  show(false)

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
  const { container } = show(false)

  // Two tabs, the priority risks first and open, each with how many are answered.
  const tabs = await screen.findAllByRole('tab')
  expect(tabs.map((t) => t.textContent)).toEqual(['Priority risks 0/2', 'Report sections 0/1'])
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  await openTab('Report sections')
  const headings = () => [...container.querySelectorAll('h4')].map((h) => h.textContent)
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
  show(false)

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
  show(true)

  expect(await screen.findByText('This checklist is out of date')).toBeInTheDocument()
  expect(
    screen.getByText(
      /generated for Distribution warehouse in Singapore; the site is now Cold store/,
    ),
  ).toBeInTheDocument()
})

it('gives no warning while the site is as it was', async () => {
  serve(view(CHECKLIST))
  show(true)

  await screen.findByRole('tab', { name: /^Priority risks/ })
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
  show(false)

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
  show(false)
  await openTab('Report sections')

  const full = screen.getByRole('switch', { name: 'All sections' })
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
  show(false)

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
  show(false)

  const racks = await screen.findByRole('region', { name: 'Rack and high-piled storage' })
  fireEvent.click(within(racks).getByRole('button', { name: 'NFPA 13 p. 118' }))
  expect(within(racks).getByText(/p\. 118 › Rack Storage$/)).toBeInTheDocument()
  expect(within(racks).queryByText(/hot work permit/)).not.toBeInTheDocument()
})

it('shows all sections from the link beside the sections left out', async () => {
  serve(view(CHECKLIST))
  show(false)
  await openTab('Report sections')

  fireEvent.click(screen.getByRole('button', { name: 'Show all sections' }))
  expect(screen.getByRole('switch', { name: 'All sections' })).toBeChecked()
  expect(screen.getByRole('region', { name: '7. Construction' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'No specific requirements' })).not.toBeInTheDocument()
})

it('opens the report sections the way they were last shown, on the tab or on site', async () => {
  serve(view(CHECKLIST))
  show(false)
  await openTab('Report sections')
  fireEvent.click(screen.getByRole('switch', { name: 'All sections' }))
  cleanup()

  show(false)
  await openTab('Report sections')
  expect(screen.getByRole('switch', { name: 'All sections' })).toBeChecked()
})

it('shows every section when no standard was selected', async () => {
  serve(view({ ...CHECKLIST, standards: [] }))
  show(false)
  await openTab('Report sections')

  expect(
    screen.getByText('No standards were selected, so every report section is shown.'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'All sections' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: '7. Construction' })).toBeInTheDocument()
})

describe('answers (CP-31)', () => {
  const differs = {
    result: 'differs' as const,
    at: '2026-10-28T02:00:00.000Z',
    by: 'Alex Rowe',
    observation: { id: 'o1', location: 'Bay 3, Level 1, Block A' },
  }
  const answered: ChecklistData = {
    ...CHECKLIST,
    items: [CHECKLIST.items[0], { ...CHECKLIST.items[1], check: differs }, CHECKLIST.items[2]],
  }
  const BAY = { id: 'l1', building: 'Block A', floor: 'Level 1', name: 'Bay 3' }
  const answering = (fields: Partial<ChecklistAnswering> = {}): ChecklistAnswering => ({
    place: { kind: 'tab', locations: [BAY], last: null },
    onSaved: vi.fn(),
    onFullCapture: vi.fn(),
    ...fields,
  })

  it('shows how each item was answered, folded under Answered, and how many of a card are', async () => {
    serve(view(answered))
    show(false)

    const racks = await screen.findByRole('region', { name: 'Rack and high-piled storage' })
    expect(within(racks).getByText('1 of 1 answered')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Priority risks/ })).toHaveTextContent('1/2')
    fireEvent.click(within(racks).getByRole('button', { name: 'Answered (1)' }))
    expect(within(racks).getByText('Differs')).toBeInTheDocument()
    expect(within(racks).getByText(/Alex Rowe · Bay 3, Level 1, Block A/)).toBeInTheDocument()
    fireEvent.click(within(racks).getByRole('button', { name: 'View observation' }))
    expect(viewed).toHaveBeenCalledWith('o1')
  })

  it('gives anyone but the assigned engineer no way to answer', async () => {
    serve(view(CHECKLIST))
    show(false)

    await screen.findByRole('region', { name: 'Roofing materials' })
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('answers from the tab as on site, asking where it was seen', async () => {
    const posts: { url: string; body: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/sections')) return json([])
        if (init?.method === 'POST') {
          const body =
            init.body instanceof FormData ? JSON.parse(String(init.body.get('details'))) : init.body
          posts.push({ url, body })
          return url.endsWith('/capture-session')
            ? json({ session: {}, assessment: {} }, 201)
            : json({ id: 'o2' }, 201)
        }
        return json(view(CHECKLIST))
      }),
    )
    const onSaved = vi.fn()
    show(true, answering({ onSaved }))

    const roofing = await screen.findByRole('region', { name: 'Roofing materials' })
    fireEvent.click(within(roofing).getByRole('button', { name: 'Confirm' }))
    const box = screen.getByRole('dialog', { name: 'Confirm' })
    fireEvent.click(within(box).getByRole('radio', { name: 'Low' }))
    fireEvent.click(within(box).getByRole('button', { name: 'Save observation' }))
    expect(within(box).getByRole('alert')).toHaveTextContent('Choose where you saw it.')
    fireEvent.change(within(box).getByLabelText('Where'), { target: { value: 'l1' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Save observation' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // A capture session is opened first, as every observation belongs to one.
    expect(posts.map((p) => p.url)).toEqual([
      '/api/assessments/' + REF + '/capture-session',
      '/api/assessments/' + REF + '/observations',
    ])
    expect(posts[1].body).toEqual({
      note: 'Confirmed on site: Check the roof deck, covering and insulation',
      copeDimensions: ['Construction'],
      severity: 'low',
      locationId: 'l1',
      checklistItem: { itemId: 'i3', result: 'confirmed' },
    })
  })

  it('offers full capture for a difference', async () => {
    serve(view(CHECKLIST))
    const onFullCapture = vi.fn()
    show(true, answering({ onFullCapture }))

    const roofing = await screen.findByRole('region', { name: 'Roofing materials' })
    fireEvent.click(within(roofing).getByRole('button', { name: 'Differs' }))
    const box = screen.getByRole('dialog', { name: 'Record a difference' })
    expect(within(box).getByRole('textbox', { name: 'What you saw' })).toHaveValue('')
    fireEvent.click(within(box).getByRole('button', { name: /Use full capture instead/ }))

    expect(onFullCapture).toHaveBeenCalledWith(expect.objectContaining({ id: 'i3' }))
    expect(screen.queryByRole('dialog', { name: 'Record a difference' })).not.toBeInTheDocument()
  })

  it('asks before regenerating an answered checklist, then points out what may replace a lost answer', async () => {
    const reworded = {
      ...CHECKLIST.items[1],
      text: 'Check sprinkler density for racks over 7.6 m.',
    }
    const fetch = serve(view(answered), {
      // A regenerate is a new checklist, with its own id.
      ...view({
        ...CHECKLIST,
        id: 'c2',
        items: [CHECKLIST.items[0], reworded, CHECKLIST.items[2]],
      }),
      carryOver: {
        kept: 0,
        dropped: ['Check in-rack sprinklers are fitted for racks over 7.6 m.'],
        mayReplace: ['i2'],
      },
    })
    show(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))
    const ask = screen.getByRole('dialog', { name: 'Regenerate the checklist?' })
    expect(ask).toHaveTextContent('Your answers stay with the items that come back.')
    expect(fetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false)
    fireEvent.click(within(ask).getByRole('button', { name: 'Regenerate' }))

    // How many answers were not kept, with only the items that may replace
    // them highlighted below, until dismissed.
    expect(
      await screen.findByText('Checklist regenerated: 1 answer was not kept'),
    ).toBeInTheDocument()
    const message = screen.getByText(/This item was reworded, so its answer did not carry over/)
    expect(message).toHaveTextContent('An item that may replace it is highlighted below.')
    expect(message).toHaveTextContent('What you recorded is still in Observations.')
    expect(screen.getByRole('tab', { name: /^Priority risks/ })).toHaveTextContent(
      'Priority risks 0/2 · 1 to check',
    )
    const row = screen.getByRole('listitem', {
      name: 'Check sprinkler density for racks over 7.6 m.',
    })
    expect(within(row).getByText('Answer again?')).toBeInTheDocument()
    // Nothing else is highlighted.
    expect(screen.getAllByText('Answer again?')).toHaveLength(1)
    // The earlier wording is folded away, for an item removed rather than reworded.
    const earlier = screen.getByText('Show the earlier wording (1)')
    expect(earlier.closest('details')).not.toHaveAttribute('open')
    expect(earlier.closest('details')).toHaveTextContent(
      'Check in-rack sprinklers are fitted for racks over 7.6 m.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Checklist regenerated/)).not.toBeInTheDocument()
    expect(within(row).queryByText('Answer again?')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Priority risks/ })).toHaveTextContent(
      'Priority risks 0/2',
    )
  })

  it('says a lost answer has nothing to replace it highlighted when none is new there', async () => {
    serve(view(answered), {
      ...view({ ...CHECKLIST, id: 'c2' }),
      carryOver: {
        kept: 0,
        dropped: ['Check in-rack sprinklers are fitted for racks over 7.6 m.'],
        mayReplace: [],
      },
    })
    show(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }))

    const message = await screen.findByText(/This item was reworded/)
    expect(message).not.toHaveTextContent('highlighted')
    expect(screen.queryByText('Answer again?')).not.toBeInTheDocument()
  })

  it('says every answer was kept, highlighting nothing, until dismissed', async () => {
    serve(view(answered), {
      ...view(answered),
      carryOver: { kept: 1, dropped: [], mayReplace: [] },
    })
    show(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByText('Checklist regenerated')).toBeInTheDocument()
    expect(screen.getByText('All your answers are kept.')).toBeInTheDocument()
    expect(screen.queryByText('Answer again?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Checklist regenerated')).not.toBeInTheDocument()
  })

  it('says nothing after generating a checklist that had no answers', async () => {
    serve(view(CHECKLIST), {
      ...view(CHECKLIST),
      carryOver: { kept: 0, dropped: [], mayReplace: [] },
    })
    show(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Regenerate checklist' })).toBeEnabled(),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/Checklist regenerated/)).not.toBeInTheDocument()
  })
})

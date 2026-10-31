import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type {
  Checklist,
  ChecklistItem,
  ChecklistView,
  ItemCheck,
  ReportSection,
  SavedObservation,
} from './api'

const REF = 'RPT-2026-0411'
const CAPTURE_URL = `/api/assessments/${REF}/capture-session`
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const CHECKLIST_URL = `/api/assessments/${REF}/checklist`
const SECTIONS_URL = `/api/assessments/${REF}/sections`
const BAY_3 = { id: 'l1', building: 'Warehouse', name: 'Bay 3 — north aisle', floor: 'Ground' }
const CAPTURE = {
  session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
  assessment: {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
  },
}

const item = (fields: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'i',
  area: '7',
  subsection: null,
  origin: 'template',
  hazard: null,
  text: '',
  fields: [],
  COPE_dimension: ['Construction'],
  citations: [],
  flags: [],
  check: null,
  ...fields,
})
const CONFIRMED: ItemCheck = {
  result: 'confirmed',
  at: '2026-09-29T08:05:00.000Z',
  by: 'Alex Rowe',
  observation: { id: 'o0', location: 'Bay 3 — north aisle, Ground, Warehouse' },
}
const CHECKLIST: Checklist = {
  id: 'c1',
  facilityType: 'Distribution warehouse',
  jurisdiction: 'SG',
  standards: [],
  areas: [{ id: '7', title: 'Construction' }],
  items: [
    item({ id: 't1', subsection: 'Construction Narrative', text: 'Walls, roof, frame and floors' }),
    item({ id: 't2', subsection: 'Roof', text: 'Roof', check: CONFIRMED }),
    item({
      id: 'h1',
      area: 'hazards',
      origin: 'hazard_list',
      hazard: 'rack_storage',
      text: 'Check in-rack sprinklers are fitted for racks over 7.6 m.',
      COPE_dimension: ['Occupancy', 'Protection'],
    }),
  ],
  hazards: [{ id: 'rack_storage', name: 'Rack storage', standards: [], inScope: [] }],
  sources: {},
  provenance: {
    provider: 'anthropic',
    model: null,
    effort: 'medium',
    prompt_version: 'cp30-v1',
    checklist_version: 'checklist-v1-2026-10',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-09-28T06:00:00.000Z',
  },
  createdAt: '2026-09-28T06:00:00.000Z',
}
// Section 7 has one usable observation of the two it needs (AC7).
const SECTION = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  minObservations: 2,
  usableObservations: 1,
  latestDraft: null,
  changesSinceDraft: 0,
  changeCounts: { added: 0, changed: 0, removed: 0 },
  inputsMissing: null,
} satisfies ReportSection

function observation(fields: Partial<SavedObservation> = {}): SavedObservation {
  return {
    id: 'o1',
    engineer: 'Alex Rowe',
    copeDimensions: ['Construction'],
    standard: null,
    severity: 'low',
    location: BAY_3,
    note: null,
    recordings: [],
    photos: [],
    removedRecordings: [],
    removedPhotos: [],
    interpretation: null,
    recordedAt: '2026-09-29T08:10:00.000Z',
    edited: null,
    deleted: null,
    ...fields,
  }
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

// A small stand-in for the gateway, answering by route. A save echoes what was
// sent, and checks the item it answers, as the gateway does.
let view: ChecklistView
const saves: Record<string, unknown>[] = []
// The names of the photos sent with each save.
const photos: string[][] = []
const marks: { url: string; body: unknown }[] = []
const setCheck = (id: string, check: ItemCheck | null) => {
  view = {
    ...view,
    checklist: {
      ...view.checklist!,
      items: view.checklist!.items.map((i) => (i.id === id ? { ...i, check } : i)),
    },
  }
}
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === CAPTURE_URL) return json(201, CAPTURE)
    if (url === OBS_URL && init.method === 'POST') {
      const details = JSON.parse(String((init.body as FormData).get('details')))
      saves.push(details)
      photos.push(((init.body as FormData).getAll('photo') as File[]).map((f) => f.name))
      if (details.checklistItem) {
        setCheck(details.checklistItem.itemId, {
          ...CONFIRMED,
          result: details.checklistItem.result,
          observation: { id: 'o1', location: null },
        })
      }
      return json(
        201,
        observation({ note: details.note ?? null, copeDimensions: details.copeDimensions }),
      )
    }
    if (url === OBS_URL || url === OBS_URL + '?include=deleted') return json(200, [])
    if (url === LOCATIONS_URL) return json(200, [BAY_3])
    if (url === CHECKLIST_URL) return json(200, view)
    if (url === SECTIONS_URL) return json(200, [SECTION])
    if (url.startsWith(CHECKLIST_URL + '/items/') && init.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      marks.push({ url, body })
      const id = url.split('/items/')[1].split('/')[0]
      setCheck(
        id,
        body.mark && { result: body.mark, at: CONFIRMED.at, by: 'Alex Rowe', observation: null },
      )
      return json(200, view)
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  view = {
    scope: { facilityType: 'Distribution warehouse', jurisdiction: 'SG' },
    standards: [],
    checklist: CHECKLIST,
  }
  saves.length = 0
  photos.length = 0
  marks.length = 0
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

// Opens capture at Bay 3, then the checklist over it.
async function openChecklist() {
  render(<App />)
  await signIn()
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
  await screen.findByRole('img', { name: 'live' })
  fireEvent.click(
    await screen.findByRole('button', { name: /^Warehouse · Ground · Bay 3 — north aisle/ }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open checklist' }))
  return screen.findByRole('dialog', { name: 'Checklist' })
}
const row = (name: string) => screen.getByRole('listitem', { name })
const openTab = (name: 'Priority risks' | 'Report sections') =>
  fireEvent.click(screen.getByRole('tab', { name: new RegExp('^' + name) }))
const RACK = 'Check in-rack sprinklers are fitted for racks over 7.6 m.'

it('opens from capture as on the Checklist tab, with progress by area (AC1, AC6, AC7)', async () => {
  const sheet = await openChecklist()

  // The priority risks and the report sections are two tabs, the risks first.
  const tabs = await within(sheet).findAllByRole('tab')
  expect(tabs.map((t) => t.textContent)).toEqual(['Priority risks 0/1', 'Report sections 1/2'])
  expect(within(sheet).getByRole('region', { name: 'Rack storage' })).toHaveTextContent(
    '0 of 1 answered',
  )
  openTab('Report sections')
  // No standard was selected, so every section is shown, as on the tab.
  expect(
    within(sheet).getByText('No standards were selected, so every report section is shown.'),
  ).toBeInTheDocument()
  const construction = within(sheet).getByRole('region', { name: '7. Construction' })
  await waitFor(() =>
    expect(construction).toHaveTextContent('1 of 2 answered · Needs 1 more observation to draft'),
  )
  // The item answered before is folded away until asked for.
  expect(within(construction).queryByRole('listitem', { name: 'Roof' })).not.toBeInTheDocument()
  fireEvent.click(within(construction).getByRole('button', { name: 'Answered (1)' }))
  expect(within(row('Roof')).getByText('Confirmed')).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Answers are saved at Warehouse · Ground · Bay 3 — north aisle.')
})

it('saves a Confirm as an observation where capture is, linked to the item (AC2)', async () => {
  await openChecklist()
  openTab('Report sections')

  fireEvent.click(within(row('Construction Narrative')).getByRole('button', { name: 'Confirm' }))
  const confirm = screen.getByRole('dialog', { name: 'Confirm' })
  expect(within(confirm).getByRole('textbox', { name: 'What you saw' })).toHaveValue(
    'Confirmed on site: Construction Narrative',
  )
  expect(confirm).toHaveTextContent('At Warehouse · Ground · Bay 3 — north aisle')
  // Severity is always chosen, never assumed.
  fireEvent.click(within(confirm).getByRole('button', { name: 'Save observation' }))
  expect(within(confirm).getByRole('alert')).toHaveTextContent('Choose a severity first.')
  fireEvent.change(within(confirm).getByRole('textbox', { name: 'What you saw' }), {
    target: { value: 'Walls are precast concrete; roof steel deck.' },
  })
  fireEvent.click(within(confirm).getByRole('radio', { name: 'Low' }))
  fireEvent.click(within(confirm).getByRole('button', { name: 'Save observation' }))

  await waitFor(() =>
    expect(within(row('Construction Narrative')).getByText('Confirmed')).toBeInTheDocument(),
  )
  expect(saves).toEqual([
    {
      note: 'Walls are precast concrete; roof steel deck.',
      copeDimensions: ['Construction'],
      severity: 'low',
      locationId: 'l1',
      checklistItem: { itemId: 't1', result: 'confirmed' },
    },
  ])
  expect(screen.queryByRole('dialog', { name: 'Confirm' })).not.toBeInTheDocument()
})

it('records a Differs in the checklist, with a photo, without leaving it (AC3)', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: RACK })

  fireEvent.click(within(row(RACK)).getByRole('button', { name: 'Differs' }))
  const box = screen.getByRole('dialog', { name: 'Record a difference' })
  expect(box).toHaveTextContent('Checklist expects' + RACK)
  fireEvent.change(within(box).getByRole('textbox', { name: 'What you saw' }), {
    target: { value: 'No in-rack sprinklers on racks at 9 m.' },
  })
  fireEvent.change(within(box).getByLabelText('Add photo'), {
    target: { files: [new File(['jpeg'], 'racks.jpg', { type: 'image/jpeg' })] },
  })
  fireEvent.click(within(box).getByRole('radio', { name: 'High' }))
  fireEvent.click(within(box).getByRole('button', { name: 'Save observation' }))

  await waitFor(() => expect(within(row(RACK)).getByText('Differs')).toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Checklist' })).toBeInTheDocument()
  expect(saves[0]).toEqual({
    note: 'No in-rack sprinklers on racks at 9 m.',
    copeDimensions: ['Occupancy', 'Protection'],
    severity: 'high',
    locationId: 'l1',
    checklistItem: { itemId: 'h1', result: 'differs' },
  })
  expect(photos[0]).toEqual(['racks.jpg'])
})

it('records a Differs in full capture, for a recording or handwritten notes (AC3)', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: RACK })
  fireEvent.click(within(row(RACK)).getByRole('button', { name: 'Differs' }))

  fireEvent.click(screen.getByRole('button', { name: /Use full capture instead/ }))

  expect(screen.queryByRole('dialog', { name: 'Checklist' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Recording a difference' })).toHaveTextContent(RACK)
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
    target: { value: 'No in-rack sprinklers on racks at 9 m.' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'High' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

  expect(
    await screen.findByText(
      'Observation saved to RPT-2026-0411, and the checklist item answered as Differs.',
    ),
  ).toBeInTheDocument()
  expect(saves[0]).toMatchObject({
    copeDimensions: ['Occupancy', 'Protection'],
    checklistItem: { itemId: 'h1', result: 'differs' },
  })
  // The link goes with that one observation; capture is back to normal.
  expect(screen.queryByRole('region', { name: 'Recording a difference' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open checklist' })).toBeInTheDocument()
})

it('goes back to the checklist from full capture, leaving the item unanswered', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: RACK })
  fireEvent.click(within(row(RACK)).getByRole('button', { name: 'Differs' }))
  fireEvent.click(screen.getByRole('button', { name: /Use full capture instead/ }))

  fireEvent.click(screen.getByRole('button', { name: 'Back to checklist' }))

  const sheet = await screen.findByRole('dialog', { name: 'Checklist' })
  expect(await within(sheet).findByRole('listitem', { name: RACK })).toBeInTheDocument()
  fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Racks.' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Low' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

  await screen.findByText('Observation saved to RPT-2026-0411.')
  expect(saves[0]).not.toHaveProperty('checklistItem')
})

it('marks an item Not seen from ⋯ without an observation, and clears it (AC4)', async () => {
  await openChecklist()
  openTab('Report sections')

  fireEvent.click(
    within(row('Construction Narrative')).getByRole('button', { name: 'More actions' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Not seen' }))

  await waitFor(() =>
    expect(within(row('Construction Narrative')).getByText('Not seen')).toBeInTheDocument(),
  )
  expect(marks[0]).toEqual({
    url: CHECKLIST_URL + '/items/t1/mark',
    body: { mark: 'not_seen' },
  })
  expect(saves).toEqual([])
  fireEvent.click(within(row('Construction Narrative')).getByRole('button', { name: 'Clear' }))
  await waitFor(() =>
    expect(
      within(row('Construction Narrative')).getByRole('button', { name: 'Confirm' }),
    ).toBeInTheDocument(),
  )
  expect(marks[1].body).toEqual({ mark: null })
})

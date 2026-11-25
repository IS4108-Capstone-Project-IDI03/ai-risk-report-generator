import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { created } from '../new-assessment/testKit'
import type {
  Checklist,
  ChecklistItem,
  ChecklistView,
  ItemCheck,
  ReportSection,
  SavedObservation,
} from './api'

const REF = 'RPT-2026-0411'
// The engineer's work list: the one assessment these tests open.
const WORK_LIST = [
  {
    ...created(REF, 'Tilbury Distribution Centre'),
    client: 'Northgate Logistics',
    status: 'capturing',
  },
]
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
  status: 'active',
  edited: null,
  removed: null,
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
    item({
      id: 't1',
      subsection: 'Walls, roof, frame and floors',
      text: 'Walls, roof, frame and floors',
    }),
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
    if (url === '/api/assessments') return json(200, WORK_LIST)
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
  // Node in CI has no localStorage (a laptop's may), so each test brings its
  // own, empty, for the remembered Relevant or All sections.
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

// Opens capture at Bay 3, then the checklist over it.
// With wide set, the window is 1100 px or more, so the checklist is a pane (CP-37 AC2).
async function openChecklist(wide = false) {
  if (wide)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 1100px'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
  render(<App />)
  await signIn()
  fireEvent.click(
    (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
  )
  // Capture starts from the Observations tab's Add manually button (CP-22).
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
  fireEvent.click(screen.getByRole('button', { name: /^Add observation manually/ }))
  await screen.findByRole('img', { name: 'live' })
  fireEvent.click(
    await screen.findByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
  )
  if (wide) return screen.findByRole('complementary', { name: 'Checklist' })
  fireEvent.click(screen.getByRole('button', { name: 'Open checklist' }))
  return screen.findByRole('dialog', { name: 'Checklist' })
}
const row = (name: string) => screen.getByRole('listitem', { name })
const RACK = 'Check in-rack sprinklers are fitted for racks over 7.6 m.'
// Presses a row's state box, which cycles none, tick, cross, not seen, none.
const press = (name: string) =>
  fireEvent.click(within(row(name)).getByRole('button', { name: /press to change/ }))
const choose = (name: string, entry: string) => {
  fireEvent.click(within(row(name)).getByRole('button', { name: /^More actions for/ }))
  fireEvent.click(screen.getByRole('button', { name: entry }))
}

it('opens from capture as one plain list with a header and count per section (AC1)', async () => {
  const sheet = await openChecklist()

  expect(await within(sheet).findByRole('heading', { name: 'Priority risks' })).toBeInTheDocument()
  expect(within(sheet).queryByRole('tab')).not.toBeInTheDocument()
  expect(within(sheet).getByRole('region', { name: 'Construction' })).toHaveTextContent('1 of 2')
  // An item answered through an observation is read-only, with a way to its observation.
  expect(within(row('Roof')).getByRole('img', { name: 'Confirmed' })).toBeInTheDocument()
  expect(within(row('Roof')).getByRole('button', { name: 'View observation' })).toBeInTheDocument()
  expect(within(row('Roof')).queryByRole('button', { name: /press to change/ })).toBeNull()
  expect(sheet).toHaveTextContent('Answers are saved at Warehouse › Ground › Bay 3 — north aisle.')
})

it('cycles the state box through tick, cross, not seen and back, with no observation (AC4)', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: 'Walls, roof, frame and floors' })

  for (const mark of ['confirmed', 'differs', 'not_seen', null]) {
    press('Walls, roof, frame and floors')
    await waitFor(() => expect(marks.at(-1)?.body).toEqual({ mark }))
  }
  expect(marks.map((m) => m.url)).toEqual(Array(4).fill(CHECKLIST_URL + '/items/t1/mark'))
  expect(saves).toEqual([])
  expect(
    await within(row('Walls, roof, frame and floors')).findByRole('button', {
      name: /Not checked, press to change/,
    }),
  ).toBeInTheDocument()
})

it('puts the mark back and says so when it could not be saved', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: 'Walls, roof, frame and floors' })
  const ok = globalThis.fetch
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json(500, { error: 'Nope' }) : ok(url, init),
  )

  press('Walls, roof, frame and floors')

  expect(await screen.findByText("Couldn't save the mark")).toBeInTheDocument()
  expect(
    within(row('Walls, roof, frame and floors')).getByRole('button', {
      name: /Not checked, press to change/,
    }),
  ).toBeInTheDocument()
})

it('records a difference from the ⋯ menu, with a photo, without leaving the checklist (AC3)', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: RACK })

  choose(RACK, 'Record what you saw...')
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

  await waitFor(() =>
    expect(within(row(RACK)).getByRole('img', { name: 'Differs' })).toBeInTheDocument(),
  )
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

it('records a difference in full capture, then goes back to the checklist', async () => {
  await openChecklist()
  await screen.findByRole('listitem', { name: RACK })
  choose(RACK, 'Record what you saw...')

  fireEvent.click(screen.getByRole('button', { name: /Use full capture instead/ }))

  expect(screen.queryByRole('dialog', { name: 'Checklist' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Recording a difference' })).toHaveTextContent(RACK)
  fireEvent.click(screen.getByRole('button', { name: 'Back to checklist' }))
  const sheet = await screen.findByRole('dialog', { name: 'Checklist' })
  expect(await within(sheet).findByRole('listitem', { name: RACK })).toBeInTheDocument()
  expect(saves).toEqual([])
})

it('shows the same list beside the recording on a wide screen, no sheet (CP-37 AC2)', async () => {
  const pane = await openChecklist(true)

  expect(screen.queryByRole('button', { name: 'Open checklist' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Checklist' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
  expect(await within(pane).findByRole('heading', { name: 'Priority risks' })).toBeInTheDocument()

  press('Walls, roof, frame and floors')
  await waitFor(() => expect(marks[0].body).toEqual({ mark: 'confirmed' }))
})

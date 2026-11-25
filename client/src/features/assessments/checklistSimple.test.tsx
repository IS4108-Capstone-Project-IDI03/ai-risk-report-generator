// CP-37: the plain checklist on the assessment's tab: the Build view, the flat list with
// Show more, the ⋯ menu (edit, delete, undo) and Add item. Fetch is mocked; no gateway or paid call.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Checklist as ChecklistData, ChecklistItem, ChecklistView } from './api'
import { Checklist } from './screens/Checklist'

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
const many = Array.from({ length: 10 }, (_, n) => item({ id: `m${n}`, text: `Question ${n}` }))
const checklist = (items: ChecklistItem[], notes?: string[]): ChecklistData => ({
  id: 'c1',
  facilityType: 'Distribution warehouse',
  jurisdiction: 'SG',
  standards: [],
  areas: [
    { id: '7', title: 'Construction' },
    { id: '8', title: 'Protection' },
  ],
  items,
  notes,
  hazards: [],
  sources: {},
  provenance: {
    provider: 'anthropic',
    model: null,
    effort: 'medium',
    prompt_version: 'cp37-v1',
    checklist_version: 'v1',
    template_version: 't1',
    generated_at: '2026-11-24T06:00:00.000Z',
  },
  createdAt: '2026-11-24T06:00:00.000Z',
})
const NFPA = {
  id: 'nfpa13',
  title: 'NFPA 13',
  issuingBody: 'NFPA',
  standardNumber: '13',
  edition: '2025',
  sourceType: 'nfpa_standard',
  uploadedAt: '2026-10-01T00:00:00.000Z',
}
const FM = { ...NFPA, id: 'fm157', title: 'FM 1-57', issuingBody: 'FM', standardNumber: '1-57' }
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

let view: ChecklistView
const calls: { method: string; url: string; body: unknown }[] = []
// A stand-in gateway: each write is recorded and answered with the current view (or the next one).
let next: ChecklistView | null = null
// What the observations list answers with, for the link picker.
let observations: unknown[] = []
function mock(v: ChecklistView) {
  view = v
  calls.length = 0
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url.endsWith('/sections')) return json([])
    if (url.endsWith('/observations')) return json(observations)
    if (method !== 'GET') {
      calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (next) view = next
      return json(url.endsWith('/items') ? { ...view, itemId: 'new' } : view)
    }
    return json(view)
  })
}
const base = (c: ChecklistData | null, extra: Partial<ChecklistView> = {}): ChecklistView => ({
  scope: { facilityType: 'Distribution warehouse', jurisdiction: 'SG' },
  standards: [NFPA, FM],
  checklist: c,
  defaults: { count: 4 },
  pastReports: [
    { id: 'r1', title: 'Jurong DC 2024' },
    { id: 'r2', title: 'Tuas Hub 2023' },
  ],
  ...extra,
})
const show = () =>
  render(<Checklist reference="R1" canGenerate answering={null} onViewObservation={vi.fn()} />)

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  next = null
  observations = []
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('builds from three plain sections and posts what was picked', async () => {
  mock(base(null))
  show()
  await screen.findByRole('heading', { name: 'Build your checklist' })
  expect(
    screen.getByRole('checkbox', {
      name: 'Include the fixed questions set by your admin (4 for Distribution warehouse)',
    }),
  ).toBeChecked()
  // All standards and all past reports start picked, and list below their dropdown.
  const standards = screen.getByRole('list', { name: 'Chosen: Codes and standards' })
  expect(within(standards).getAllByRole('listitem')).toHaveLength(2)
  expect(
    within(screen.getByRole('list', { name: 'Chosen: Past Marsh reports' })).getAllByRole(
      'listitem',
    ),
  ).toHaveLength(2)

  // A small x removes one; the dropdown searches and ticks.
  fireEvent.click(within(standards).getByRole('button', { name: /^Remove FM 1-57/ }))
  expect(within(standards).getAllByRole('listitem')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: /^Codes and standards: 1 of 2/ }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search codes and standards' }), {
    target: { value: 'fm' },
  })
  expect(screen.queryByRole('checkbox', { name: /NFPA 13/ })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: /FM 1-57/ }))
  expect(within(standards).getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(within(standards).getByRole('button', { name: /^Remove NFPA 13/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /^Include the fixed/ }))

  next = base(checklist([item({ id: 'a', text: 'Roof' })]))
  fireEvent.click(screen.getByRole('button', { name: 'Generate checklist' }))
  await screen.findByRole('heading', { name: 'Construction' })
  expect(calls[0].body).toEqual({
    standardIds: ['fm157'],
    pastReportIds: ['r1', 'r2'],
    includeDefaults: false,
  })
})

it('says so when no past Marsh report matches', async () => {
  mock(base(null, { pastReports: [] }))
  show()
  expect(
    await screen.findByText('No past Marsh reports match this site type and country.'),
  ).toBeInTheDocument()
})

it('shows the Build view again on Regenerate, and Cancel goes back', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Roof' })])))
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate checklist' }))
  expect(await screen.findByRole('heading', { name: 'Build your checklist' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(await screen.findByRole('listitem', { name: 'Roof' })).toBeInTheDocument()
})

it('lists fixed, then past-report, then other questions, with a muted suffix and the notes', async () => {
  mock(
    base(
      checklist(
        [
          item({ id: 'o', text: 'Other one' }),
          item({
            id: 'p',
            origin: 'past_report',
            text: 'Dock seals',
            sourceReports: [{ title: 'Jurong DC 2024' }],
          }),
          item({ id: 'f', text: 'Roof rated', fixed: true }),
          item({ id: 'h', area: 'hazards', origin: 'hazard', text: 'Rack sprinklers' }),
        ],
        ['No past Marsh reports match this site type, so only the fixed questions are shown.'],
      ),
    ),
  )
  show()
  await screen.findByText(/No past Marsh reports match this site type, so only/)
  const rows = within(screen.getByRole('region', { name: 'Construction' })).getAllByRole('listitem')
  expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
    'Roof rated',
    'Dock seals',
    'Other one',
  ])
  expect(within(rows[0]).getByText('Fixed')).toBeInTheDocument()
  expect(within(rows[1]).getByText('from Jurong DC 2024')).toHaveAttribute(
    'title',
    'from Jurong DC 2024',
  )
  expect(within(rows[1]).queryByText(/Past report/)).toBeNull()
  expect(screen.getByRole('region', { name: 'Priority risks' })).toBeInTheDocument()
  expect(screen.queryByRole('tab')).toBeNull()
})

it('shows 8 questions a section, then Show more and Show less', async () => {
  mock(base(checklist(many)))
  show()
  const section = await screen.findByRole('region', { name: 'Construction' })
  expect(within(section).getAllByRole('listitem')).toHaveLength(8)
  fireEvent.click(within(section).getByRole('button', { name: 'Show 2 more' }))
  expect(within(section).getAllByRole('listitem')).toHaveLength(10)
  fireEvent.click(within(section).getByRole('button', { name: 'Show less' }))
  expect(within(section).getAllByRole('listitem')).toHaveLength(8)
})

it('edits a question inline: Enter saves, Escape cancels', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Roof' })])))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })
  const openEdit = () => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Roof' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    return screen.getByRole('textbox', { name: 'Edit Roof' })
  }
  fireEvent.keyDown(openEdit(), { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: 'Edit Roof' })).toBeNull()
  expect(calls).toEqual([])

  const box = openEdit()
  fireEvent.change(box, { target: { value: 'Roof deck' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { text: 'Roof deck' } }),
  )
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit Roof' })).toBeNull())
})

const rowOf = (name: string) => screen.getByRole('listitem', { name })
const answeringTab = {
  place: { kind: 'tab' as const, locations: [], last: null },
  onSaved: vi.fn(),
  onFullCapture: vi.fn(),
}
const showAnswering = () =>
  render(
    <Checklist reference="R1" canGenerate answering={answeringTab} onViewObservation={vi.fn()} />,
  )
const marked = (id: string, text: string, result: 'confirmed' | 'differs' | 'not_seen') =>
  item({ id, text, check: { result, at: '', by: '', observation: null } })
const OBS = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  note: `Note ${id}`,
  recordings: [],
  location: { name: 'Bay 3', building: 'Warehouse', floor: 'Ground' },
  severity: 'high',
  checklistItem: null,
  ...extra,
})

it('never moves a row when it is marked', async () => {
  const items = [
    item({ id: 'a', text: 'Alpha' }),
    marked('b', 'Bravo', 'confirmed'),
    item({ id: 'c', text: 'Charlie' }),
    marked('d', 'Delta', 'not_seen'),
  ]
  mock(base(checklist(items)))
  show()
  await screen.findByRole('listitem', { name: 'Alpha' })
  const order = () =>
    within(screen.getByRole('region', { name: 'Construction' }))
      .getAllByRole('listitem')
      .map((r) => r.getAttribute('aria-label'))
  expect(order()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  fireEvent.click(within(rowOf('Alpha')).getByRole('button', { name: /press to change/ }))
  expect(order()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
})

it('shows the question text for a template item, never its subsection heading', async () => {
  mock(
    base(checklist([item({ id: 't', origin: 'template', subsection: 'Roof', text: 'Roof deck' })])),
  )
  show()
  expect(await screen.findByRole('listitem', { name: 'Roof deck' })).toBeInTheDocument()
  expect(screen.queryByText('Roof')).toBeNull()
})

it('puts important items on top, oldest mark first, and marks one with a rollback', async () => {
  const imp = (id: string, text: string, at: string) => item({ id, text, important: { at } })
  mock(
    base(
      checklist([
        item({ id: 'a', text: 'Alpha' }),
        imp('b', 'Bravo', '2026-11-24T09:00:00Z'),
        item({ id: 'c', text: 'Charlie' }),
        imp('d', 'Delta', '2026-11-24T08:00:00Z'),
      ]),
    ),
  )
  show()
  await screen.findByRole('listitem', { name: 'Alpha' })
  const order = () =>
    within(screen.getByRole('region', { name: 'Construction' }))
      .getAllByRole('listitem')
      .map((r) => r.getAttribute('aria-label'))
  expect(order()).toEqual(['Delta', 'Bravo', 'Alpha', 'Charlie'])
  expect(within(rowOf('Delta')).getByRole('img', { name: 'Important' })).toBeInTheDocument()
  expect(within(rowOf('Alpha')).queryByRole('img', { name: 'Important' })).toBeNull()
  // An important question is bold; the others are not.
  expect(within(rowOf('Delta')).getByText('Delta').tagName).toBe('STRONG')
  expect(within(rowOf('Alpha')).getByText('Alpha').tagName).not.toBe('STRONG')

  // The newest important item goes under the earlier ones.
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Charlie' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mark as important' }))
  expect(order()).toEqual(['Delta', 'Bravo', 'Charlie', 'Alpha'])
  await waitFor(() =>
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { important: true } }),
  )

  // A refusal puts it back.
  vi.stubGlobal('fetch', () => json({ message: 'no' }, 500))
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Delta' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove importance' }))
  expect(order()[0]).toBe('Bravo')
  await waitFor(() => expect(order()[0]).toBe('Delta'))
})

it("a failed star undoes only its own row, not another row's tick saved meanwhile", async () => {
  mock(base(checklist([item({ id: 'a', text: 'Alpha' }), item({ id: 'b', text: 'Bravo' })])))
  showAnswering()
  await screen.findByRole('listitem', { name: 'Alpha' })
  // The star's request fails, but only after Bravo's tick has saved.
  let failStar = () => {}
  const ticked = base(
    checklist([item({ id: 'a', text: 'Alpha' }), marked('b', 'Bravo', 'confirmed')]),
  )
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (init.method === 'PATCH')
      return new Promise((done) => (failStar = () => done(json({ message: 'no' }, 500))))
    if (init.method === 'PUT') return json(ticked)
    return json(view)
  })
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Alpha' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mark as important' }))
  fireEvent.click(within(rowOf('Bravo')).getByRole('button', { name: /press to change/ }))
  const box = () => rowOf('Bravo').querySelector('.cl-state')
  await waitFor(() => expect(box()).toHaveAttribute('data-mark', 'confirmed'))
  failStar()
  await waitFor(() =>
    expect(within(rowOf('Alpha')).queryByRole('img', { name: 'Important' })).toBeNull(),
  )
  expect(box()).toHaveAttribute('data-mark', 'confirmed')
})

it('shows a muted "from" line for standards and past reports, and the fixed tag inline', async () => {
  mock(
    base(
      checklist([
        item({
          id: 'a',
          text: 'Alpha',
          sourceStandards: [{ title: 'NFPA 13' }, { title: 'FM 1-57' }],
        }),
        item({
          id: 'b',
          text: 'Bravo',
          fixed: true,
          origin: 'past_report',
          sourceReports: [{ title: 'Marsh Report: Office, 28 Feb 2025' }],
        }),
      ]),
    ),
  )
  show()
  await screen.findByRole('listitem', { name: 'Alpha' })
  expect(within(rowOf('Alpha')).getByText('from NFPA 13, FM 1-57')).toHaveClass('cl-source')
  const line = within(rowOf('Bravo')).getByText('from Marsh Report: Office, 28 Feb 2025')
  expect(line).toHaveAttribute('title', 'from Marsh Report: Office, 28 Feb 2025')
  expect(within(rowOf('Bravo')).getByText('Fixed')).toBeInTheDocument()
})

// jsdom lays nothing out, so alignment is pinned by structure: the box and the text are siblings in
// a flex row, and the CSS (checklist.css) centres the box on the first line.
it('puts the state box and the question side by side in one row', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Alpha '.repeat(40) })])))
  show()
  const row = (await screen.findByRole('region', { name: 'Construction' })).querySelector(
    '.cl-row',
  )!
  expect(row.firstElementChild).toHaveClass('cl-state')
  expect(row.children[1]).toHaveClass('cl-row-text')
})

it('colours the state box by mark: green tick, red cross, neutral not seen', async () => {
  mock(
    base(
      checklist([
        marked('a', 'Alpha', 'confirmed'),
        marked('b', 'Bravo', 'differs'),
        marked('c', 'Charlie', 'not_seen'),
      ]),
    ),
  )
  show()
  await screen.findByRole('listitem', { name: 'Alpha' })
  const box = (n: string) => rowOf(n).querySelector('.cl-state')
  expect(box('Alpha')).toHaveAttribute('data-mark', 'confirmed')
  expect(box('Bravo')).toHaveAttribute('data-mark', 'differs')
  expect(box('Charlie')).toHaveAttribute('data-mark', 'not_seen')
})

it('shows the link icon only on ticked or crossed rows', async () => {
  mock(
    base(
      checklist([
        marked('a', 'Alpha', 'confirmed'),
        marked('c', 'Charlie', 'not_seen'),
        item({ id: 'u', text: 'Unmarked' }),
      ]),
    ),
  )
  showAnswering()
  await screen.findByRole('listitem', { name: 'Alpha' })
  expect(
    within(rowOf('Alpha')).getByRole('button', { name: 'Link an observation' }),
  ).toBeInTheDocument()
  expect(within(rowOf('Charlie')).queryByRole('button', { name: 'Link an observation' })).toBeNull()
  expect(
    within(rowOf('Unmarked')).queryByRole('button', { name: 'Link an observation' }),
  ).toBeNull()
})

it('links an existing observation, searched and picked, with the row result', async () => {
  observations = [
    OBS('o1', { note: 'Rust on the roof' }),
    OBS('o2', { note: 'Blocked exit', severity: null, location: null }),
  ]
  mock(base(checklist([marked('a', 'Alpha', 'differs')])))
  showAnswering()
  await screen.findByRole('listitem', { name: 'Alpha' })
  fireEvent.click(within(rowOf('Alpha')).getByRole('button', { name: 'Link an observation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Link existing observation' }))
  const dialog = await screen.findByRole('dialog', { name: 'Link an observation' })
  expect(await within(dialog).findByText('Rust on the roof')).toBeInTheDocument()
  expect(dialog).toHaveTextContent('Warehouse › Ground › Bay 3 · High')
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search observations' }), {
    target: { value: 'blocked' },
  })
  expect(within(dialog).queryByText('Rust on the roof')).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: /Blocked exit/ }))
  await waitFor(() =>
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/observations/o2',
      body: { checklistItem: { itemId: 'a', result: 'differs' } },
    }),
  )
})

it('says so when there is no observation to link', async () => {
  mock(base(checklist([marked('a', 'Alpha', 'confirmed')])))
  showAnswering()
  await screen.findByRole('listitem', { name: 'Alpha' })
  fireEvent.click(within(rowOf('Alpha')).getByRole('button', { name: 'Link an observation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Link existing observation' }))
  expect(await screen.findByText('There are no observations to link yet.')).toBeInTheDocument()
})

it('opens the answer box from "Create new observation"', async () => {
  mock(base(checklist([marked('a', 'Alpha', 'confirmed')])))
  showAnswering()
  await screen.findByRole('listitem', { name: 'Alpha' })
  fireEvent.click(within(rowOf('Alpha')).getByRole('button', { name: 'Link an observation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create new observation' }))
  expect(await screen.findByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
})

it('offers View and Unlink on a linked row, and unlinks with a null checklistItem', async () => {
  const linked = item({
    id: 'a',
    text: 'Alpha',
    check: { result: 'confirmed', at: '', by: '', observation: { id: 'o9', location: null } },
  })
  mock(base(checklist([linked])))
  showAnswering()
  await screen.findByRole('listitem', { name: 'Alpha' })
  fireEvent.click(within(rowOf('Alpha')).getByRole('button', { name: 'Link an observation' }))
  expect(screen.getByRole('button', { name: 'Unlink observation' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Unlink observation' }))
  await waitFor(() =>
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/observations/o9',
      body: { checklistItem: null },
    }),
  )
})

it('saves an edit on blur, and an empty edit on blur reverts', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Roof' })])))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Roof' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    return screen.getByRole('textbox', { name: 'Edit Roof' })
  }
  const empty = open()
  fireEvent.change(empty, { target: { value: '  ' } })
  fireEvent.blur(empty)
  expect(screen.queryByRole('textbox', { name: 'Edit Roof' })).toBeNull()
  expect(calls).toEqual([])

  const box = open()
  fireEvent.change(box, { target: { value: 'Roof deck' } })
  fireEvent.blur(box)
  await waitFor(() =>
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { text: 'Roof deck' } }),
  )
})

it('shows Add item as a dashed button that opens the form', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Roof' })])))
  show()
  const add = await screen.findByRole('button', { name: 'Add item' })
  expect(add).toHaveClass('cl-add-btn')
  fireEvent.click(add)
  expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
})

it('deletes a question, hides it, and Undo restores it', async () => {
  const c = checklist([item({ id: 'a', text: 'Roof' })])
  mock(base(c))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })
  next = base({ ...c, items: [{ ...c.items[0], status: 'removed' }] })
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Roof' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText(/^Removed\./)).toBeInTheDocument()
  expect(screen.queryByRole('listitem', { name: 'Roof' })).toBeNull()
  expect(calls[0].url).toMatch(/\/items\/a\/remove$/)

  next = base(c)
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('listitem', { name: 'Roof' })).toBeInTheDocument()
  expect(calls[1].url).toMatch(/\/items\/a\/restore$/)
})

const pickSection = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Section' }))
  fireEvent.click(screen.getByRole('option', { name }))
}

it('adds an item to the last section by default, or picks another from the custom dropdown', async () => {
  const c = checklist([item({ id: 'a', text: 'Roof' })])
  mock(base(c))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })

  fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
  expect(document.querySelector('select')).toBeNull()
  expect(screen.getByRole('button', { name: 'Section' })).toHaveTextContent('Protection')
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: 'Walls' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(calls[0].body).toEqual({ text: 'Walls', area: '8' }))
  // Focus returns to the Add item button; the page is not scrolled.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add item' })).toHaveFocus())

  fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: 'Beams' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Section' }))
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Construction',
    'Protection',
    '+ New section',
  ])
  fireEvent.click(screen.getByRole('option', { name: 'Construction' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(calls[1].body).toEqual({ text: 'Beams', area: '7' }))
})

it('adds an item to a new section', async () => {
  const c = checklist([item({ id: 'a', text: 'Roof' })])
  mock(base(c))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })
  next = base({
    ...c,
    areas: [...c.areas, { id: '9', title: 'Housekeeping' }],
    items: [...c.items, item({ id: 'n', area: '9', origin: 'manual', text: 'Bins' })],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Bins' } })
  pickSection('+ New section')
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Name the new section.')
  fireEvent.change(screen.getByRole('textbox', { name: 'New section name' }), {
    target: { value: 'Housekeeping' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(calls[0].body).toEqual({ text: 'Bins', newSection: 'Housekeeping' }))
  expect(await screen.findByRole('region', { name: 'Housekeeping' })).toBeInTheDocument()
})

const words = (n: number) => Array.from({ length: n }, (_, k) => `w${k}`).join(' ')

it('counts words in the add form and refuses over 25', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Roof' })])))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: words(22) },
  })
  expect(screen.getByText('22 / 20 words')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(calls).toHaveLength(1))
  calls.length = 0

  fireEvent.click(await screen.findByRole('button', { name: 'Add item' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: words(26) },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Keep it to about 20 words.')
  expect(calls).toEqual([])
})

it('refuses to save an edit over 25 words', async () => {
  mock(base(checklist([item({ id: 'a', text: 'Roof' })])))
  show()
  await screen.findByRole('listitem', { name: 'Roof' })
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Roof' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const box = screen.getByRole('textbox', { name: 'Edit Roof' })
  fireEvent.change(box, { target: { value: words(26) } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(screen.getByRole('alert')).toHaveTextContent('Keep it to about 20 words.')
  expect(calls).toEqual([])
  expect(screen.getByRole('textbox', { name: 'Edit Roof' })).toBeInTheDocument()
})

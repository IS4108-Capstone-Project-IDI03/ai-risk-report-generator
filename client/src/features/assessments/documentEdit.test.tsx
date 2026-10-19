import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type {
  FindingCounts,
  ReportSection,
  ReviewSection,
  ReviewStatement,
  ReviewWorkspace,
  SectionDocument,
  SectionVersion,
  Summary,
} from './api'
import { sectionContent } from './documentContent'
import { formatDayTime } from './format'

// The document edit view of the review workspace (RV-08).

beforeAll(() => {
  // jsdom has no native dialogs, layout or scrolling; ProseMirror asks for them.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList
  Element.prototype.scrollIntoView = vi.fn()
  document.elementFromPoint = () => null
})

const REF = 'RPT-2026-0001'
const RECORD = {
  id: '6ab39003058299a45f20c9d4',
  reference: REF,
  client: 'Straits Logistics',
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'draft',
  captureStartedAt: '2026-09-23T09:05:00.000Z',
  createdAt: '2026-09-23T09:00:00.000Z',
  site: {
    code: 'SITE-0001',
    name: 'Jurong Distribution Hub',
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
  },
}
const PROVENANCE = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  effort: 'high',
  prompt_version: 'gn01-v2.4',
  template_version: 'global-pre-v2.0-2026-02',
  generated_at: '2026-10-03T06:00:00.000Z',
}
const PENDING: ReviewStatement['review'] = { state: 'pending', at: null, by: null }
const finding = (text: string, citations: string[], supported = true): ReviewStatement => ({
  text,
  generatedText: text,
  citations,
  supported,
  citationsRemoved: [],
  review: PENDING,
})
const counts = (pending = 0): FindingCounts => ({
  total: pending,
  pending,
  accepted: 0,
  edited: 0,
  rejected: 0,
})
const review = (state: ReviewSection['review']['state'], unsupportedStatements = 0) => ({
  state,
  unsupportedStatements,
  withdrawnSources: 0,
  changesSinceDraft: 0,
  changeCounts: { added: 0, changed: 0, removed: 0 },
})

const RISER = 'Riser penetrations were not fire-stopped at Level 3.'
const ROOF = 'The roof is of fire-resistive construction.'
const VALVES = 'Valves are checked weekly.'
const CONSTRUCTION: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'complete', written: 1, total: 1, tables: 1 },
  review: review('needs_review', 1),
  draft: {
    id: 'd7',
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [finding(RISER, ['O:o1']), finding(ROOF, [], false)],
      },
      { heading: 'Construction Table', kind: 'table', statements: [] },
    ],
    questions: [],
    guardrail: { passed: false, unsupported_count: 1 },
    provenance: PROVENANCE,
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  findings: counts(2),
  sources: {},
  observations: [
    {
      id: 'o1',
      copeDimensions: ['Construction'],
      note: 'Riser shaft not fire-stopped at L3.',
      transcripts: [],
      severity: 'high',
      location: 'Riser B, Level 3',
      standard: null,
    },
  ],
  replacement: null,
  history: [],
  document: null,
}
const FIRE: ReviewSection = {
  ...CONSTRUCTION,
  id: '9',
  title: 'Fire Protection',
  copeDimensions: ['Protection'],
  review: review('ai_draft'),
  draft: {
    ...CONSTRUCTION.draft!,
    id: 'd9',
    sectionId: '9',
    title: 'Fire Protection',
    subsections: [
      {
        heading: 'Sprinkler Protection',
        kind: 'narrative',
        statements: [finding(VALVES, ['O:o1'])],
      },
    ],
  },
  findings: counts(1),
}
const EXPOSURES: ReviewSection = {
  id: '10',
  title: 'External Exposures',
  copeDimensions: ['Exposure'],
  completion: { state: 'not_started', written: 0, total: 0, tables: 0 },
  review: review('not_drafted'),
  findings: counts(),
  draft: null,
  sources: {},
  observations: [],
  replacement: null,
  history: [],
  document: null,
}
const workspace = (
  sections: ReviewSection[],
  asOf = '2026-10-19T02:00:00.000Z',
): ReviewWorkspace => ({
  sections,
  parts: { '1': null, '2': null, '3': null, A: null },
  summary: counts(3),
  asOf,
})
// Generation's list, which says why Section 10 was not drafted (AC3).
const LISTED: Partial<ReportSection>[] = [
  {
    id: '10',
    title: 'External Exposures',
    copeDimensions: ['Exposure'],
    minObservations: 1,
    usableObservations: 0,
    inputsMissing: null,
  },
]
const SUMMARY: Summary = {
  purposeAndScope: ['This report was prepared for Straits Logistics.'],
  executiveSummary: {
    draft: null,
    missing: [{ id: '10', title: 'External Exposures' }],
    staleSections: [],
  },
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A section saved from the document editor: its path and body.
type Saved = {
  url: string
  body: { baseVersion: number; draftId: string | null; document: SectionDocument }
}
const saves: Saved[] = []
let answerSave: (saved: Saved) => Promise<Response> = (saved) =>
  json(200, {
    version: saved.body.baseVersion + 1,
    draftId: saved.body.draftId,
    document: saved.body.document,
    savedAt: '2026-10-19T02:30:00.000Z',
    savedBy: { id: RECORD.engineer.id, name: 'Alex Rowe' },
  })
let reviews: ReviewWorkspace[] = []

function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && url.endsWith('/document')) {
      const saved = { url, body: JSON.parse(String(init.body)) }
      saves.push(saved)
      return answerSave(saved)
    }
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`)
      return json(200, reviews.length > 1 ? reviews.shift() : reviews[0])
    if (url === `/api/assessments/${REF}/sections`) return json(200, LISTED)
    if (url === `/api/assessments/${REF}/summary`) return json(200, SUMMARY)
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
}

async function openReview(first = workspace([CONSTRUCTION, FIRE, EXPOSURES])) {
  reviews = [first]
  mockGateway()
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
}

async function openDocument(first = workspace([CONSTRUCTION, FIRE, EXPOSURES])) {
  await openReview(first)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit document' }))
  await screen.findByRole('textbox', { name: 'Report document' }, { timeout: 10_000 })
}

const page = () => screen.getByRole('textbox', { name: 'Report document' })
const editorOf = () => (page() as HTMLElement & { editor: Editor }).editor
// The document position just after some text, to type there.
function after(text: string) {
  let at = -1
  editorOf().state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text))
      at = pos + node.text!.indexOf(text) + text.length
  })
  return at
}
function select(text: string) {
  const end = after(text)
  act(() => {
    editorOf().commands.setTextSelection({ from: end - text.length, to: end })
  })
}
const typeAt = (position: number, text: string) =>
  act(() => {
    editorOf().commands.insertContentAt(position, text)
  })
// The first paragraph of a section, where its text starts.
function startOf(sectionId: string) {
  let at = -1
  editorOf().state.doc.forEach((section, offset) => {
    if (section.attrs.id !== sectionId) return
    section.descendants((node, pos) => {
      if (at === -1 && node.type.name === 'paragraph') at = offset + 1 + pos + 1
    })
  })
  return at
}
const saveNow = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const savedSection = (id: string) =>
  saves.filter((s) => s.url.endsWith(`/sections/${id}/document`)).at(-1)?.body

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  saves.length = 0
  answerSave = (saved) =>
    json(200, {
      version: saved.body.baseVersion + 1,
      draftId: saved.body.draftId,
      document: saved.body.document,
      savedAt: '2026-10-19T02:30:00.000Z',
      savedBy: { id: RECORD.engineer.id, name: 'Alex Rowe' },
    })
})

it('opens the whole report as one document, each section under its fixed heading in order (AC1)', async () => {
  await openDocument()
  const headings = within(page())
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent)
  expect(headings).toEqual([
    '1. Purpose and Scope',
    '2. Executive Summary',
    '3. Opportunities for Improvement',
    '7. Construction',
    '9. Fire Protection',
    '10. External Exposures',
    'Appendix A. Site Photos',
  ])
  // Each drafted section's findings sit in its template subsections, and the
  // headings and parts filled in elsewhere cannot be typed into.
  expect(within(page()).getByRole('heading', { name: 'Construction Narrative' })).toHaveAttribute(
    'contenteditable',
    'false',
  )
  expect(within(page()).getByText(RISER)).toBeInTheDocument()
  expect(
    within(page()).getByText('This report was prepared for Straits Logistics.'),
  ).toBeInTheDocument()
  expect(within(page()).getByText(/completed from measured values/)).toBeInTheDocument()

  // A key that would delete a fixed heading changes nothing.
  act(() => {
    editorOf().commands.setTextSelection(startOf('7'))
  })
  const before = editorOf().getJSON()
  act(() => {
    editorOf().commands.joinBackward()
  })
  expect(editorOf().getJSON()).toEqual(before)
}, 20_000)

it('says why a section was not drafted, and takes text written into it (AC3, AC13)', async () => {
  await openDocument()
  expect(
    within(page()).getByText(
      /it needs 1 usable observation filed under Exposure, and 0 are captured/,
    ),
  ).toBeInTheDocument()

  typeAt(startOf('10'), 'There are no exposures within 30 m.')
  saveNow()

  await waitFor(() => expect(savedSection('10')).toBeDefined())
  expect(savedSection('10')).toEqual({
    baseVersion: 0,
    draftId: null,
    document: {
      intro: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'There are no exposures within 30 m.' }],
        },
      ],
      subsections: [],
    },
  })
  // Only the changed section is saved, and the save says when (AC13).
  expect(saves).toHaveLength(1)
  expect(await screen.findByText(/All changes saved/)).toBeInTheDocument()
  expect(
    screen.getByText(`· Last saved ${formatDayTime(new Date('2026-10-19T02:30:00.000Z'))}`),
  ).toBeInTheDocument()
}, 20_000)

it('edits a drafted finding in place, which drops its AI styling and keeps its citation (AC4, AC9, AC12)', async () => {
  await openDocument()
  const passage = () =>
    within(page())
      .getByText(/Valves are/)
      .closest('p')!
  expect(passage()).toHaveClass('dm-ai')
  expect(
    within(passage()).getByRole('img', { name: /^Citation 1: Site observation/ }),
  ).toBeInTheDocument()

  typeAt(after('Valves are'), ' visually')

  expect(passage()).not.toHaveClass('dm-ai')
  saveNow()
  await waitFor(() => expect(savedSection('9')).toBeDefined())
  expect(savedSection('9')).toMatchObject({
    baseVersion: 0,
    draftId: 'd9',
    document: {
      subsections: [
        {
          heading: 'Sprinkler Protection',
          blocks: [
            {
              type: 'paragraph',
              finding: '0.0',
              content: [
                { type: 'text', text: 'Valves are visually checked weekly.' },
                { type: 'cite', id: 'O:o1' },
              ],
            },
          ],
        },
      ],
    },
  })
}, 20_000)

it('applies bold, italic, underline, sub-headings and lists, from the toolbar or the keyboard (AC6)', async () => {
  await openDocument()
  select('checked')
  fireEvent.click(screen.getByRole('button', { name: /^Bold/ }))
  select('weekly')
  fireEvent.keyDown(page(), { key: 'i', ctrlKey: true })
  select('Valves')
  fireEvent.click(screen.getByRole('button', { name: /^Underline/ }))
  expect(screen.getByRole('button', { name: /^Underline/ })).toHaveAttribute('aria-pressed', 'true')

  // A drafted finding set as a sub-heading is still that finding, no longer
  // styled as the AI's; new text can be a sub-heading or a list too.
  select('fire-stopped')
  fireEvent.keyDown(page(), { key: '4', ctrlKey: true, altKey: true })
  const riser = within(page()).getByText(RISER).closest('h4')!
  expect(riser).toHaveAttribute('data-finding', '7:0.0')
  expect(screen.getByRole('button', { name: /^Sub-heading/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  typeAt(startOf('10'), 'Neighbours')
  select('Neighbours')
  fireEvent.click(screen.getByRole('button', { name: /^Sub-heading/ }))
  act(() => {
    editorOf().commands.setTextSelection(after('Neighbours'))
    editorOf().commands.splitBlock()
  })
  typeAt(after('Neighbours') + 2, 'A timber yard')
  fireEvent.click(screen.getByRole('button', { name: /^Bulleted list/ }))
  saveNow()

  await waitFor(() => expect(savedSection('10')).toBeDefined())
  expect(savedSection('9')!.document.subsections[0].blocks[0]).toMatchObject({
    content: [
      { type: 'text', text: 'Valves', marks: ['underline'] },
      { type: 'text', text: ' are ' },
      { type: 'text', text: 'checked', marks: ['bold'] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'weekly', marks: ['italic'] },
      { type: 'text', text: '.' },
      { type: 'cite', id: 'O:o1' },
    ],
  })
  expect(savedSection('7')!.document.subsections[0].blocks[0]).toEqual({
    type: 'heading',
    finding: '0.0',
    content: [
      { type: 'text', text: RISER },
      { type: 'cite', id: 'O:o1' },
    ],
  })
  expect(savedSection('10')!.document.intro).toEqual([
    { type: 'heading', content: [{ type: 'text', text: 'Neighbours' }] },
    {
      type: 'bulletList',
      items: [{ type: 'paragraph', content: [{ type: 'text', text: 'A timber yard' }] }],
    },
  ])
}, 20_000)

it('undoes and redoes changes in order (AC7)', async () => {
  await openDocument()
  typeAt(startOf('10'), 'First.')
  // Two separate changes, not one run of typing.
  act(() => {
    editorOf().view.dispatch(closeHistory(editorOf().state.tr))
  })
  typeAt(after('First.'), ' Second.')
  const undo = screen.getByRole('button', { name: /^Undo/ })
  const redo = screen.getByRole('button', { name: /^Redo/ })

  fireEvent.click(undo)
  expect(within(page()).queryByText(/Second/)).toBeNull()
  expect(within(page()).getByText('First.')).toBeInTheDocument()
  fireEvent.click(undo)
  expect(within(page()).queryByText(/First/)).toBeNull()
  fireEvent.click(redo)
  fireEvent.click(redo)
  expect(within(page()).getByText('First. Second.')).toBeInTheDocument()
}, 20_000)

it('finds text across every section and replaces one match or all of them (AC8)', async () => {
  await openDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Find and replace/ }))
  const bar = screen.getByRole('search', { name: 'Find and replace' })
  fireEvent.change(within(bar).getByLabelText('Find'), { target: { value: 'were' } })

  // "were" in Section 7, nowhere else; then "weekly" in 9.
  expect(within(bar).getByText('1 of 1 match')).toBeInTheDocument()
  expect(page().querySelectorAll('.dm-match')).toHaveLength(1)
  fireEvent.change(within(bar).getByLabelText('Find'), { target: { value: 'e' } })
  const all = page().querySelectorAll('.dm-match').length
  expect(within(bar).getByText(`1 of ${all} matches`)).toBeInTheDocument()

  fireEvent.change(within(bar).getByLabelText('Find'), { target: { value: 'Level 3' } })
  fireEvent.change(within(bar).getByLabelText('Replace with'), { target: { value: 'L3' } })
  fireEvent.click(within(bar).getByRole('button', { name: 'Replace' }))
  expect(
    within(page()).getByText('Riser penetrations were not fire-stopped at L3.'),
  ).toBeInTheDocument()

  typeAt(startOf('10'), 'Fire-stopping at Level 4 and Level 5 is complete.')
  fireEvent.change(within(bar).getByLabelText('Find'), { target: { value: 'level' } })
  fireEvent.change(within(bar).getByLabelText('Replace with'), { target: { value: 'Floor' } })
  fireEvent.click(within(bar).getByRole('button', { name: 'Replace all' }))
  expect(within(bar).getByText('Replaced 2 matches.')).toBeInTheDocument()
  expect(
    within(page()).getByText('Fire-stopping at Floor 4 and Floor 5 is complete.'),
  ).toBeInTheDocument()
}, 20_000)

it('flags a claim whose citation marker is deleted, and keeps an unsupported one flagged (AC10, AC11)', async () => {
  await openDocument()
  const riser = () =>
    within(page())
      .getByText(/Riser penetrations/)
      .closest('p')!
  const roof = () =>
    within(page())
      .getByText(/The roof/)
      .closest('p')!
  expect(within(roof()).getByText('Unsupported')).toBeInTheDocument()

  // Edited, the unsupported finding keeps its flag (AC11).
  typeAt(after('The roof is of'), ' non-combustible,')
  expect(within(roof()).getByText('Unsupported')).toBeInTheDocument()

  // The citation marker is deleted (AC10).
  act(() => {
    const at = after('at Level 3.')
    editorOf().commands.deleteRange({ from: at, to: at + 1 })
  })
  expect(within(riser()).queryByRole('img', { name: /^Citation/ })).toBeNull()
  expect(within(riser()).getByText('Citation deleted')).toBeInTheDocument()
  saveNow()
  await waitFor(() => expect(savedSection('7')).toBeDefined())
  expect(savedSection('7')!.document.subsections[0].blocks[0]).toEqual({
    type: 'paragraph',
    finding: '0.0',
    content: [{ type: 'text', text: RISER }],
  })
}, 20_000)

it('saves on its own once typing pauses (AC13)', async () => {
  await openDocument()
  typeAt(startOf('10'), 'No exposures.')
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  await waitFor(() => expect(savedSection('10')).toBeDefined(), { timeout: 4000 })
  expect(await screen.findByText(/All changes saved/)).toBeInTheDocument()
}, 20_000)

it('warns before unsaved changes are discarded, on leaving for review or another tab (AC14)', async () => {
  await openDocument()
  typeAt(startOf('10'), 'Not saved yet.')

  fireEvent.click(screen.getByRole('button', { name: 'Return to review' }))
  const dialog = screen.getByRole('dialog', { name: 'Leave with unsaved changes?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByRole('textbox', { name: 'Report document' })).toBeInTheDocument()

  // Choosing the tab the document is already on is not leaving it.
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
  expect(screen.queryByRole('dialog', { name: 'Leave with unsaved changes?' })).toBeNull()

  fireEvent.click(screen.getByRole('tab', { name: /^Overview/ }))
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Leave with unsaved changes?' })).getByRole(
      'button',
      { name: 'Discard and leave' },
    ),
  )
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Report document' })).toBeNull())
  expect(saves).toHaveLength(0)

  // The browser asks before the page is left.
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit document' }))
  await screen.findByRole('textbox', { name: 'Report document' }, { timeout: 10_000 })
  typeAt(startOf('10'), 'Again.')
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
}, 20_000)

it('saves and returns to review on the section being edited, showing the change (AC2, AC12, AC15)', async () => {
  const written: SectionVersion = {
    version: 1,
    draftId: null,
    document: {
      intro: [
        { type: 'paragraph', content: [{ type: 'text', text: 'No exposures within 30 m.' }] },
      ],
      subsections: [],
    },
    savedAt: '2026-10-19T02:30:00.000Z',
    savedBy: { id: RECORD.engineer.id, name: 'Alex Rowe' },
    current: true,
  }
  const reread = workspace(
    [
      CONSTRUCTION,
      FIRE,
      {
        ...EXPOSURES,
        completion: { state: 'complete', written: 0, total: 0, tables: 0 },
        review: review('edited'),
        document: written,
      },
    ],
    '2026-10-19T02:31:00.000Z',
  )
  await openDocument()
  reviews = [reread]
  typeAt(startOf('10'), 'No exposures within 30 m.')

  fireEvent.click(screen.getByRole('button', { name: 'Return to review' }))
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Leave with unsaved changes?' })).getByRole(
      'button',
      { name: 'Save and leave' },
    ),
  )

  const editor = await screen.findByRole('region', { name: 'Draft editor' })
  expect(
    within(editor).getByRole('heading', { name: '10. External Exposures' }),
  ).toBeInTheDocument()
  expect(savedSection('10')).toBeDefined()
  // Read again from the gateway, the section shows what was saved.
  expect(await within(editor).findByText('No exposures within 30 m.')).toBeInTheDocument()
  expect(within(editor).getByText('Written by you')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Report sections' })
  expect(
    within(within(nav).getByRole('button', { name: /External Exposures/ })).getByText(
      'Edited by you',
    ),
  ).toBeVisible()

  // Reopened, the document holds the saved text (AC15).
  fireEvent.click(screen.getByRole('button', { name: 'Edit document' }))
  await screen.findByRole('textbox', { name: 'Report document' }, { timeout: 10_000 })
  expect(within(page()).getByText('No exposures within 30 m.')).toBeInTheDocument()
}, 20_000)

it('scrolls to a section chosen in the outline (AC5)', async () => {
  await openDocument()
  const outline = screen.getByRole('navigation', { name: 'Document outline' })
  const scrolled = vi.mocked(Element.prototype.scrollIntoView)
  scrolled.mockClear()

  fireEvent.click(within(outline).getByRole('button', { name: /Fire Protection/ }))

  expect(scrolled).toHaveBeenCalled()
  expect(scrolled.mock.contexts.at(-1)).toBe(document.getElementById('dm-section-9'))
  expect(within(outline).getByRole('button', { name: /Fire Protection/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
}, 20_000)

it('asks to reload when a section was saved from somewhere else', async () => {
  answerSave = () => json(409, { error: 'This section was saved from somewhere else.' })
  await openDocument()
  typeAt(startOf('10'), 'Clash.')
  saveNow()

  const alert = (await screen.findByText(/saved from somewhere else/)).closest('[role="alert"]')!
  expect(
    within(alert as HTMLElement).getByRole('button', { name: 'Reload the document' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
}, 20_000)

it("shows a section's saved document in review: rewording later wins, rejected findings stay out", () => {
  const document: SectionDocument = {
    intro: [],
    subsections: [
      {
        heading: 'Construction Narrative',
        blocks: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Fire stopping is ongoing.' }] },
          {
            type: 'paragraph',
            finding: '0.0',
            content: [
              { type: 'text', text: 'Riser penetrations were ' },
              { type: 'text', text: 'not', marks: ['bold'] },
              { type: 'text', text: ' fire-stopped at Level 3.' },
              { type: 'cite', id: 'O:o1' },
            ],
          },
        ],
      },
      { heading: 'Construction Table', blocks: [] },
    ],
  }
  const version: SectionVersion = {
    version: 2,
    draftId: 'd7',
    document,
    savedAt: '2026-10-19T02:30:00.000Z',
    savedBy: { id: 'u', name: 'Alex Rowe' },
    current: true,
  }
  // Saved as formatted; the unsupported finding, not in the version, follows.
  expect(sectionContent({ ...CONSTRUCTION, document: version }).subsections[0].blocks).toEqual([
    document.subsections[0].blocks[0],
    document.subsections[0].blocks[1],
    { type: 'paragraph', finding: '0.1', content: [{ type: 'text', text: ROOF }] },
  ])

  // Reworded in the review workspace since, and the other finding rejected.
  const reworded = structuredClone(CONSTRUCTION)
  reworded.draft!.subsections[0].statements[0].text =
    'Riser penetrations at Level 3 lack fire stopping.'
  reworded.draft!.subsections[0].statements[1].review = { state: 'rejected', at: null, by: null }
  expect(sectionContent({ ...reworded, document: version }).subsections[0].blocks).toEqual([
    document.subsections[0].blocks[0],
    {
      type: 'paragraph',
      finding: '0.0',
      content: [
        { type: 'text', text: 'Riser penetrations at Level 3 lack fire stopping.' },
        { type: 'cite', id: 'O:o1' },
      ],
    },
  ])

  // Set aside once the section is drafted again.
  expect(
    sectionContent({ ...CONSTRUCTION, document: { ...version, current: false } }).subsections[0]
      .blocks,
  ).toHaveLength(2)
})

it('shows Edited by you beside Needs review once a flagged section is changed in the document (AC12)', async () => {
  await openReview(
    workspace([
      { ...CONSTRUCTION, review: { ...review('needs_review', 1), editedInDocument: true } },
      { ...FIRE, review: review('edited') },
      EXPOSURES,
    ]),
  )
  const nav = await screen.findByRole('navigation', { name: 'Report sections' })
  const construction = within(nav).getByRole('button', { name: /Construction/ })
  expect(within(construction).getByText('Needs review')).toBeVisible()
  expect(within(construction).getByText('Edited by you')).toBeVisible()
  // A section that is only edited says so once.
  expect(
    within(within(nav).getByRole('button', { name: /Fire Protection/ })).getAllByText(
      'Edited by you',
    ),
  ).toHaveLength(1)
}, 20_000)

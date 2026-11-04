import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { Assessment, ReviewSection, ReviewStatement, ReviewWorkspace, Summary } from './api'
import { toggleSubheading } from './document/commands'
import { coverDetails } from './document/page/frontMatter'
import { FrontPages } from './document/page/PageFrame'

// Marsh's page layout in the document editor (RV-12). jsdom lays nothing out,
// so here each section is counted on a page of its own; where blocks break
// across pages is tested in document/page/paginate.test.ts.

beforeAll(() => {
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
  clientId: '6ab39003058299a45f20c9e0',
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'draft',
  captureStartedAt: '2026-09-23T09:05:00.000Z',
  createdAt: '2026-09-23T09:00:00.000Z',
  site: {
    id: '6ab39003058299a45f20c9e1',
    code: 'SITE-0001',
    name: 'Jurong Distribution Hub',
    // No address recorded (AC4).
    address: null,
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
    removed: false,
    change: { allowed: true, reason: null, assessments: 1 },
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
const finding = (text: string): ReviewStatement => ({
  text,
  generatedText: text,
  citations: ['O:o1'],
  supported: true,
  citationsRemoved: [],
  review: { state: 'pending', at: null, by: null },
})
const counts = (pending = 0) => ({ total: pending, pending, accepted: 0, edited: 0, rejected: 0 })
const review = (state: ReviewSection['review']['state']) => ({
  state,
  unsupportedStatements: 0,
  withdrawnSources: 0,
  changesSinceDraft: 0,
  changeCounts: { added: 0, changed: 0, removed: 0 },
})
const CONSTRUCTION: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'complete', written: 1, total: 1, tables: 1 },
  review: review('ai_draft'),
  draft: {
    id: 'd7',
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [finding('The roof is of fire-resistive construction.')],
      },
      { heading: 'Construction Table', kind: 'table', statements: [] },
    ],
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: PROVENANCE,
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  findings: counts(1),
  sources: {},
  observations: [],
  replacement: null,
  history: [],
  document: null,
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
const WORKSPACE: ReviewWorkspace = {
  sections: [CONSTRUCTION, EXPOSURES],
  parts: { '1': null, '2': null, '3': null, A: null },
  summary: counts(1),
  asOf: '2026-10-19T02:00:00.000Z',
}
const SUMMARY: Summary = {
  purposeAndScope: ['This report was prepared for Straits Logistics.'],
  executiveSummary: { draft: null, missing: [], staleSections: [] },
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

function mockGateway() {
  vi.stubGlobal('fetch', (url: string) => {
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`) return json(200, WORKSPACE)
    if (url === `/api/assessments/${REF}/sections`) return json(200, [])
    if (url === `/api/assessments/${REF}/summary`) return json(200, SUMMARY)
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
}

async function openPageLayout() {
  mockGateway()
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit document' }))
  await screen.findByRole('textbox', { name: 'Report document' }, { timeout: 10_000 })
  fireEvent.click(screen.getByRole('button', { name: 'Page layout' }))
}

const page = () => screen.getByRole('textbox', { name: 'Report document' })
const editorOf = () => (page() as HTMLElement & { editor: Editor }).editor
// The contents as each entry reads: number, title and page run together.
const contents = () =>
  within(screen.getByRole('region', { name: 'Contents' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('switches the document into Marsh pages and back, in the same editor (AC1)', async () => {
  await openPageLayout()
  const editor = editorOf()
  expect(await screen.findByRole('region', { name: 'Cover' })).toBeInTheDocument()
  // The report is still the same document to write in.
  expect(editorOf()).toBe(editor)
  expect(within(page()).getByText('The roof is of fire-resistive construction.')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Continuous view' }))
  expect(screen.queryByRole('region', { name: 'Cover' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Page layout' })).toBeInTheDocument()
  expect(editorOf()).toBe(editor)
})

it('shows the cover and details page from the assessment, its client and site (AC2, AC4)', async () => {
  await openPageLayout()
  const cover = await screen.findByRole('region', { name: 'Cover' })
  expect(within(cover).getByText('Property Risk Evaluation Report')).toBeInTheDocument()
  expect(within(cover).getByText('Jurong Distribution Hub')).toBeInTheDocument()
  expect(within(cover).getByText('21 April 2026')).toBeInTheDocument()
  // The text wordmark until Marsh supplies its logo.
  expect(within(cover).getByText('MARSH')).toBeInTheDocument()
  // No address is recorded: the cover says so and fills nothing in.
  expect(within(cover).getByText('Not entered')).toBeInTheDocument()

  const details = screen.getByRole('region', { name: 'Report details' })
  const row = (label: string) =>
    within(details).getByRole('rowheader', { name: label }).closest('tr')!
  expect(within(details).getByRole('columnheader', { name: 'Straits Logistics' })).toBeVisible()
  expect(row('Location Surveyed')).toHaveTextContent('Jurong Distribution Hub')
  expect(row('Address')).toHaveTextContent('Not entered')
  expect(row('Surveyed By')).toHaveTextContent('Alex Rowe')
  expect(row('Survey Dates')).toHaveTextContent('21 April 2026')
  expect(row('Survey Type')).toHaveTextContent('Property risk survey')
  expect(row('Report Reference')).toHaveTextContent(REF)
})

it('keeps the cover out of the text, showing a corrected detail at once (AC3)', async () => {
  await openPageLayout()
  const cover = await screen.findByRole('region', { name: 'Cover' })
  expect(page()).not.toContainElement(cover)
  expect(cover.closest('[contenteditable="true"]')).toBeNull()
  cleanup()

  // The cover reads the record it is given each time it is drawn.
  const record = RECORD as unknown as Assessment
  const { rerender } = render(
    <FrontPages details={coverDetails(record)} contents={[]} onOpen={() => {}} />,
  )
  rerender(
    <FrontPages
      details={coverDetails({ ...record, site: { ...record.site, address: '1 Tuas Avenue 2' } })}
      contents={[]}
      onOpen={() => {}}
    />,
  )
  const corrected = screen.getByRole('region', { name: 'Cover' })
  expect(within(corrected).getByText('1 Tuas Avenue 2')).toBeInTheDocument()
  expect(within(corrected).queryByText('Not entered')).not.toBeInTheDocument()
})

it('lists the sections and their sub-headings with the page each starts on (AC5)', async () => {
  await openPageLayout()
  await waitFor(() => expect(contents()).not.toHaveLength(0))
  expect(contents()).toEqual([
    '1.Purpose and Scope1',
    '2.Executive Summary2',
    '3.Opportunities for Improvement3',
    '7.Construction4',
    'Construction Narrative4',
    'Construction Table4',
    '10.External Exposures5',
    'Appendix A:Site Photos6',
  ])
})

it('updates the contents when a sub-heading is written (AC6)', async () => {
  await openPageLayout()
  await waitFor(() => expect(contents()).not.toHaveLength(0))
  // Section 2 has no draft: its one paragraph becomes a sub-heading.
  let at = -1
  editorOf().state.doc.forEach((section, offset) => {
    if (section.attrs.id !== '2') return
    section.descendants((node, pos) => {
      if (at === -1 && node.type.name === 'paragraph') at = offset + 1 + pos + 1
    })
  })
  act(() => {
    editorOf().commands.insertContentAt(at, 'Changes since Previous Survey')
    editorOf().commands.setTextSelection(at + 2)
    toggleSubheading(editorOf())
  })
  await waitFor(() =>
    expect(contents()).toEqual(expect.arrayContaining(['Changes since Previous Survey2'])),
  )
})

it('numbers every page after the cover, the front matter in roman numerals (AC7)', async () => {
  await openPageLayout()
  // Six sections, each on its own page here.
  await waitFor(() => expect(screen.getAllByLabelText(/^Page \d+$/)).toHaveLength(6))
  expect(
    within(screen.getByRole('region', { name: 'Cover' })).queryByLabelText(/^Page /),
  ).toBeNull()
  expect(
    within(screen.getByRole('region', { name: 'Report details' })).getByLabelText('Page i'),
  ).toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: 'Contents' })).getByLabelText('Page ii'),
  ).toBeInTheDocument()
})

// Sections 1 and 2 and Appendix A in the Review and Generation tabs
// (GN-07). The gateway is a stubbed fetch, so nothing is drafted for real.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { AppendixList, ReviewSection, SectionDraft, Summary } from './api'

const REF = 'RPT-2026-0001'
const RECORD = {
  id: '6ab39003058299a45f20c9d4',
  reference: REF,
  client: 'Straits Logistics',
  policyReference: null,
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  standards: ['FM Global 2-0'],
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
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  prompt_version: 'gn07-v1',
  template_version: 'global-pre-v2.0-2026-02',
  generated_at: '2026-10-10T06:00:00.000Z',
}
const CONSTRUCTION: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'complete', written: 1, total: 1, tables: 0 },
  review: {
    state: 'ai_draft',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
  },
  draft: {
    id: 'd7',
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [
          {
            text: 'The hub is concrete.',
            generatedText: 'The hub is concrete.',
            citations: [],
            supported: true,
            review: { state: 'pending', at: null, by: null },
          },
        ],
      },
    ],
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: PROVENANCE,
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  sources: {},
  observations: [],
  // RV-02's review state: one finding waiting, no replacement, no history.
  findings: { total: 1, pending: 1, accepted: 0, edited: 0, rejected: 0 },
  replacement: null,
  history: [],
}
const PURPOSE = 'The purpose of this PRE report is to assist Straits Logistics.'
const ACTIVITY = 'An exit meeting with management to develop a recommended action plan.'
const MISSING = [
  { id: '4', title: 'Risk Quality Ratings and Comments' },
  { id: '5', title: 'Loss Estimates' },
]
const SUMMARY_DRAFT: SectionDraft = {
  id: 's2',
  sectionId: '2',
  title: 'Executive Summary',
  subsections: [
    {
      heading: 'Executive Summary',
      kind: 'narrative',
      statements: [
        { text: 'The hub is of concrete construction.', citations: ['S:7'], supported: true },
        { text: 'It is well run.', citations: [], supported: false },
      ],
    },
    { heading: 'Changes Since Previous Survey', kind: 'narrative', statements: [] },
    { heading: 'Planned Changes / Projects', kind: 'narrative', statements: [] },
  ],
  sources: {},
  questions: [],
  guardrail: { passed: false, unsupported_count: 1 },
  provenance: PROVENANCE,
  createdAt: '2026-10-10T06:00:00.000Z',
}

const photo = (id: string, name: string, selected = false) => ({
  photoId: id,
  observationId: 'o1',
  name,
  url: `/api/observations/o1/photos/${id}/image`,
  location: 'Pump room, B1',
  category: 'Protection',
  note: 'Fire pump controller in auto.',
  selected,
})

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

let summary: Summary
// The review workspace's sections 7-12; one drafted unless a test empties it.
let reviewSections: ReviewSection[] = [CONSTRUCTION]
let appendix: AppendixList
// Each PUT to the appendix, as sent.
const puts: unknown[] = []
const posts: string[] = []

function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`) return json(200, { sections: reviewSections })
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    if (url === `/api/assessments/${REF}/summary/draft`) {
      posts.push(url)
      summary = {
        ...summary,
        executiveSummary: { draft: SUMMARY_DRAFT, missing: [], staleSections: [] },
      }
      return json(201, SUMMARY_DRAFT)
    }
    if (url === `/api/assessments/${REF}/summary`) return json(200, summary)
    if (url === `/api/assessments/${REF}/appendix`) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          photos: { photoId: string; caption: string }[]
        }
        puts.push(body)
        const byId = new Map(appendix.available.map((p) => [p.photoId, p]))
        appendix = {
          selected: body.photos.map((p) => ({ ...byId.get(p.photoId)!, caption: p.caption })),
          available: appendix.available.map((p) => ({
            ...p,
            selected: body.photos.some((b) => b.photoId === p.photoId),
          })),
        }
      }
      return json(200, appendix)
    }
    return json(200, [])
  })
}

async function openTab(tab: RegExp) {
  mockGateway()
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: tab }))
}
const nav = () => screen.findByRole('navigation', { name: 'Report sections' })
const editor = () => screen.getByRole('region', { name: 'Draft editor' })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  puts.length = 0
  posts.length = 0
  reviewSections = [CONSTRUCTION]
})

function reset(
  draft: SectionDraft | null = null,
  staleSections: Summary['executiveSummary']['staleSections'] = [],
) {
  summary = {
    purposeAndScope: [PURPOSE, [ACTIVITY]],
    executiveSummary: { draft, missing: draft ? [] : MISSING, staleSections },
  }
  appendix = { selected: [], available: [photo('p1', 'pump.jpg'), photo('p2', 'panel.jpg')] }
}

it('shows Section 1 assembled from the assessment details (AC1)', async () => {
  reset()
  await openTab(/^Review/)
  const rail = await nav()

  fireEvent.click(within(rail).getByRole('button', { name: /Purpose and Scope/ }))

  expect(within(editor()).getByRole('heading', { name: '1. Purpose and Scope' })).toBeVisible()
  expect(await within(editor()).findByText(PURPOSE)).toBeVisible()
  // The visit activities are a list, as in Marsh's reports.
  expect(within(editor()).getByRole('listitem')).toHaveTextContent(ACTIVITY)
  expect(within(editor()).getByText(/Assembled from the assessment details/)).toBeVisible()
}, 15_000)

it('lists the sections the Executive Summary still needs (AC3)', async () => {
  reset()
  await openTab(/^Review/)
  fireEvent.click(within(await nav()).getByRole('button', { name: /Executive Summary/ }))

  expect(await within(editor()).findByText('Complete these sections first')).toBeVisible()
  expect(within(editor()).getByText('4. Risk Quality Ratings and Comments')).toBeVisible()
  expect(within(editor()).getByText('5. Loss Estimates')).toBeVisible()
}, 15_000)

it('shows the drafted Executive Summary citing sections, and marks it out of date (AC2, AC4)', async () => {
  reset(SUMMARY_DRAFT, [{ id: '7', title: 'Construction' }])
  await openTab(/^Review/)
  const rail = await nav()
  const two = within(rail).getByRole('button', { name: /Executive Summary/ })
  expect(await within(two).findByText('Out of date')).toBeVisible()

  fireEvent.click(two)

  expect(await within(editor()).findByText('The hub is of concrete construction.')).toBeVisible()
  expect(within(editor()).getByText('Section 7')).toBeVisible()
  expect(within(editor()).getByText('Unsupported')).toBeVisible()
  expect(within(editor()).getByText('This summary is out of date')).toBeVisible()
  expect(within(editor()).getByText(/7\. Construction changed/)).toBeVisible()
  // The template's other two parts are left for the engineer.
  expect(within(editor()).getByText('Changes Since Previous Survey')).toBeVisible()
  expect(within(editor()).getAllByText(/Left for the engineer to write/)).toHaveLength(2)
}, 15_000)

it('chooses, orders, captions and removes Appendix A photos (AC5-AC10, AC12)', async () => {
  reset()
  await openTab(/^Review/)
  fireEvent.click(within(await nav()).getByRole('button', { name: /Site Photos/ }))
  const chosen = await screen.findByRole('region', { name: 'In Appendix A' })
  const available = screen.getByRole('region', { name: 'Available photos' })

  // AC9: nothing is shown until chosen. AC5, AC10: every photo with its details.
  expect(within(chosen).getByText('No photos in Appendix A')).toBeVisible()
  expect(within(available).getAllByRole('listitem')).toHaveLength(2)
  expect(within(available).getAllByText('Pump room, B1')).toHaveLength(2)
  expect(within(available).getAllByText('Protection')).toHaveLength(2)

  // AC6: added with a default caption, then a second.
  fireEvent.click(within(available).getByRole('button', { name: 'Add pump.jpg to the appendix' }))
  await waitFor(() => expect(puts).toHaveLength(1))
  fireEvent.click(within(available).getByRole('button', { name: 'Add panel.jpg to the appendix' }))
  await waitFor(() => expect(puts).toHaveLength(2))
  expect(puts[1]).toEqual({
    photos: [
      { photoId: 'p1', caption: 'Pump room, B1 — Protection' },
      { photoId: 'p2', caption: 'Pump room, B1 — Protection' },
    ],
  })
  // AC8: the chosen photos show, in order.
  await waitFor(() => expect(within(chosen).getAllByRole('listitem')).toHaveLength(2))

  // AC12: reorder.
  fireEvent.click(within(chosen).getByRole('button', { name: 'Move panel.jpg up' }))
  await waitFor(() => expect(puts).toHaveLength(3))
  expect((puts[2] as { photos: { photoId: string }[] }).photos.map((p) => p.photoId)).toEqual([
    'p2',
    'p1',
  ])

  // A caption saves when the field is left.
  const caption = await within(chosen).findByRole('textbox', { name: 'Caption for pump.jpg' })
  fireEvent.change(caption, { target: { value: 'Fire pump controller' } })
  fireEvent.blur(caption)
  await waitFor(() => expect(puts).toHaveLength(4))
  expect(puts[3]).toEqual({
    photos: [
      { photoId: 'p2', caption: 'Pump room, B1 — Protection' },
      { photoId: 'p1', caption: 'Fire pump controller' },
    ],
  })

  // AC7: removed.
  fireEvent.click(
    within(chosen).getByRole('button', { name: 'Remove panel.jpg from the appendix' }),
  )
  await waitFor(() => expect(puts).toHaveLength(5))
  expect(puts[4]).toEqual({ photos: [{ photoId: 'p1', caption: 'Fire pump controller' }] })
}, 20_000)

it('opens Section 1 and Appendix A before any section is drafted (AC1, AC5)', async () => {
  reset()
  reviewSections = [{ ...CONSTRUCTION, draft: null }]
  await openTab(/^Review/)
  expect(await screen.findByText('No sections drafted yet')).toBeInTheDocument()

  fireEvent.click(within(await nav()).getByRole('button', { name: /Site Photos/ }))
  expect(await screen.findByRole('region', { name: 'Available photos' })).toBeVisible()
  fireEvent.click(within(await nav()).getByRole('button', { name: /Purpose and Scope/ }))
  expect(await within(editor()).findByText(PURPOSE)).toBeVisible()
}, 15_000)

it('drafts the Executive Summary from Generation only once every section is complete (AC3)', async () => {
  reset()
  await openTab(/^Generation/)
  const row = await screen.findByRole('group', { name: 'Section 2 Executive Summary' })

  expect(await within(row).findByRole('button', { name: 'Draft' })).toBeDisabled()
  expect(
    within(row).getByText(
      /Complete these sections first: 4 Risk Quality Ratings and Comments, 5 Loss Estimates/,
    ),
  ).toBeVisible()
  expect(posts).toEqual([])
}, 15_000)

it('drafts the Executive Summary when the sections are complete', async () => {
  reset()
  summary.executiveSummary.missing = []
  await openTab(/^Generation/)
  const row = await screen.findByRole('group', { name: 'Section 2 Executive Summary' })

  fireEvent.click(await within(row).findByRole('button', { name: 'Draft' }))

  await waitFor(() => expect(posts).toHaveLength(1))
  expect(await within(row).findByText('Drafted')).toBeVisible()
  expect(within(row).getByRole('button', { name: 'Redraft' })).toBeEnabled()
}, 15_000)

it('opens the drafted Executive Summary from its Generation row, like the other sections', async () => {
  reset(SUMMARY_DRAFT)
  await openTab(/^Generation/)
  const row = await screen.findByRole('group', { name: 'Section 2 Executive Summary' })

  fireEvent.click(await within(row).findByRole('button', { name: 'View draft' }))

  const draft = screen.getByRole('region', { name: '2. Executive Summary draft' })
  expect(within(draft).getByText('The hub is of concrete construction.')).toBeVisible()
  expect(within(draft).getByText('Section 7')).toBeVisible()
  expect(within(draft).getByText('Changes Since Previous Survey')).toBeVisible()
  // On Generation the draft fills its width, as the sections' drafts do.
  expect(draft.querySelector('[style*="measure-prose"]')).toBeNull()
  fireEvent.click(within(row).getByRole('button', { name: 'Hide draft' }))
  expect(screen.queryByRole('region', { name: '2. Executive Summary draft' })).toBeNull()
}, 15_000)

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type {
  DocumentInline,
  FindingCounts,
  ReviewSection,
  ReviewStatement,
  ReviewWorkspace,
  SectionDocument,
  SectionHistory,
  SectionHistoryEntry,
} from './api'
import { ReviewWorkspace as ReviewWorkspaceScreen } from './screens/ReviewWorkspace'

// A report section's version history in the review workspace (RV-06).

beforeAll(() => {
  // jsdom does not implement native modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

const REF = 'RPT-2026-0001'
const ALEX = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const RECORD = {
  id: '6ab39003058299a45f20c9d4',
  reference: REF,
  client: 'Straits Logistics',
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  engineer: ALEX,
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
// Times in the browser's own time zone, as the screen shows them.
const DRAFTED = new Date(2026, 9, 3, 14, 0).toISOString()
const SAVED_1 = new Date(2026, 9, 11, 14, 2).toISOString()
const SAVED_2 = new Date(2026, 9, 12, 9, 30).toISOString()

const RISER = 'Riser penetrations were not fire-stopped at Level 3.'
const ROOF = 'The roof is of fire-resistive construction.'
const ONGOING = 'Fire stopping was ongoing at Level 2.'
const FINISHED = 'Fire stopping was finished at Level 2.'
const VALVES = 'The sprinkler valves are chained open.'
const PERMITS = 'Hot work permits are kept on site.'

const finding = (text: string, citations: string[], supported = true): ReviewStatement => ({
  text,
  generatedText: text,
  citations,
  supported,
  citationsRemoved: [],
  review: { state: 'pending', at: null, by: null },
})
const counts = (pending = 0): FindingCounts => ({
  total: pending,
  pending,
  accepted: 0,
  edited: 0,
  rejected: 0,
})
const text = (t: string): DocumentInline => ({ type: 'text', text: t })
const paragraph = (content: DocumentInline[], finding?: string) => ({
  type: 'paragraph' as const,
  ...(finding && { finding }),
  content,
})
// Section 7's text: its two findings, then what the engineer wrote.
const narrative = (...written: string[]): SectionDocument => ({
  intro: [],
  subsections: [
    {
      heading: 'Construction Narrative',
      blocks: [
        paragraph([text(RISER), { type: 'cite', id: 'O:o1' }], '0.0'),
        paragraph([text(ROOF)], '0.1'),
        ...written.map((w) => paragraph([text(w)])),
      ],
    },
    { heading: 'Construction Table', blocks: [] },
  ],
})
const VERSION_1 = narrative(ONGOING, VALVES)
const VERSION_2 = narrative(FINISHED, PERMITS)

const CONSTRUCTION: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'complete', written: 1, total: 1, tables: 1 },
  review: {
    state: 'needs_review',
    unsupportedStatements: 1,
    withdrawnSources: 0,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
    editedInDocument: true,
  },
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
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v2.4',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: DRAFTED,
    },
    createdAt: DRAFTED,
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
  // Saved twice in the document editor; the second is the text now.
  document: {
    version: 2,
    draftId: 'd7',
    document: VERSION_2,
    restoredFrom: null,
    savedAt: SAVED_2,
    savedBy: ALEX,
    current: true,
  },
}
const FIRE: ReviewSection = {
  ...CONSTRUCTION,
  id: '9',
  title: 'Fire Protection',
  copeDimensions: ['Protection'],
  review: { ...CONSTRUCTION.review, state: 'ai_draft', unsupportedStatements: 0 },
  draft: {
    ...CONSTRUCTION.draft!,
    id: 'd9',
    sectionId: '9',
    title: 'Fire Protection',
    subsections: [
      {
        heading: 'Sprinkler Protection',
        kind: 'narrative',
        statements: [finding('Valves are checked weekly.', ['O:o1'])],
      },
    ],
  },
  findings: counts(1),
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

const entry = (fields: Partial<SectionHistoryEntry> & Pick<SectionHistoryEntry, 'id'>) => ({
  kind: 'version' as const,
  version: null,
  draftId: 'd7',
  onSavedDraft: true,
  origin: 'saved' as const,
  restoredFrom: null,
  document: VERSION_2,
  at: SAVED_2,
  by: ALEX,
  model: null,
  ...fields,
})
// Section 7's history: its AI draft, then two saves, oldest first.
const HISTORY: SectionHistory = {
  sectionId: '7',
  entries: [
    entry({
      id: 'draft:d7',
      kind: 'draft',
      origin: 'drafted',
      document: narrative(),
      at: DRAFTED,
      model: 'claude-opus-5-5',
    }),
    entry({ id: 'version:1', version: 1, document: VERSION_1, at: SAVED_1 }),
    entry({ id: 'version:2', version: 2, document: VERSION_2, at: SAVED_2 }),
  ],
  latestVersion: 2,
  savedDraftId: 'd7',
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

// What the gateway was sent to write: its path and body.
type Sent = { url: string; body: unknown }
const sent: Sent[] = []
let answerRestore: (body: { from: string }) => Promise<Response> = () =>
  json(500, { error: 'Not expected.' })

function mockGateway(review = workspace([CONSTRUCTION, FIRE])) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET' && url.includes('/sections/')) {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      sent.push({ url, body })
      return answerRestore(body)
    }
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`) return json(200, review)
    if (url === `/api/assessments/${REF}/sections/7/versions`) return json(200, HISTORY)
    if (url === `/api/assessments/${REF}/sections/9/versions`)
      return json(200, { sectionId: '9', entries: [], latestVersion: 0, savedDraftId: 'd9' })
    if (url === `/api/assessments/${REF}/ofis`) return json(200, { suggestions: [], accepted: [] })
    return json(200, [])
  })
}

async function openWorkspace() {
  mockGateway()
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
}
async function openHistory() {
  await openWorkspace()
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
  const editor = await screen.findByRole('region', { name: 'Draft editor' })
  fireEvent.click(within(editor).getByRole('button', { name: 'Version history' }))
  await within(versions()).findAllByRole('button')
}

const versions = () => screen.getByRole('complementary', { name: 'Versions' })
const view = () => screen.getByRole('region', { name: 'Version history' })
const comparison = () => within(view()).getByRole('region', { name: 'Comparison' })
const rows = () => within(versions()).getAllByRole('button')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sent.length = 0
  answerRestore = () => json(500, { error: 'Not expected.' })
})

it('lists the section’s versions oldest first, each with who made it and when (AC1, AC2)', async () => {
  await openHistory()

  // In time order: the AI draft, then each save (AC1).
  expect(rows().map((r) => within(r).getByText(/^(AI draft|Version \d)$/).textContent)).toEqual([
    'AI draft',
    'Version 1',
    'Version 2',
  ])
  // Each says who made it and when (AC2), and how it came about.
  const [drafted, first, second] = rows()
  expect(within(drafted).getByText('Alex Rowe · 03 Oct 2026 14:00')).toBeInTheDocument()
  expect(within(drafted).getByText('Drafted by claude-opus-5-5')).toBeInTheDocument()
  expect(within(first).getByText('Alex Rowe · 11 Oct 2026 14:02')).toBeInTheDocument()
  expect(within(first).getByText('Saved in the document')).toBeInTheDocument()
  expect(within(second).getByText('Alex Rowe · 12 Oct 2026 09:30')).toBeInTheDocument()
  expect(within(second).getByText('Latest')).toBeInTheDocument()

  // It opens on the newest version that is not the current text.
  expect(first).toHaveAttribute('aria-current', 'true')
  expect(within(view()).getByRole('heading', { name: 'Version 1' })).toBeInTheDocument()
  expect(within(view()).getByText('Alex Rowe · 11 Oct 2026 14:02')).toBeInTheDocument()
})

it('compares an earlier version with the current text, marking added, deleted and changed text (AC3-AC5)', async () => {
  await openHistory()

  expect(within(comparison()).getByText('From version 1 to the current text')).toBeInTheDocument()
  // Added since (AC3), and deleted since (AC4).
  expect(within(comparison()).getByText(PERMITS).closest('ins')).not.toBeNull()
  expect(within(comparison()).getByText(VALVES).closest('del')).not.toBeNull()
  // Changed (AC5): the word deleted beside the one added in its place, as one change.
  const was = within(comparison()).getByText('ongoing')
  expect(was.tagName).toBe('DEL')
  const change = was.closest('.rv-diff-change')!
  expect(within(change as HTMLElement).getByText('finished').tagName).toBe('INS')
  expect(within(comparison()).getByText('Changed from', { exact: false })).toBeInTheDocument()
  // Counted, and text both share is left unmarked.
  expect(within(comparison()).getByText('1 added')).toBeInTheDocument()
  expect(within(comparison()).getByText('1 deleted')).toBeInTheDocument()
  expect(within(comparison()).getByText('1 changed')).toBeInTheDocument()
  expect(within(comparison()).getByText(ROOF).closest('ins, del')).toBeNull()

  // Compared with the version before it, the AI draft, version 1 only adds.
  fireEvent.click(within(view()).getByRole('button', { name: 'Version before' }))
  expect(
    within(comparison()).getByText('From the AI draft of 03 Oct 14:00 to version 1'),
  ).toBeInTheDocument()
  expect(within(comparison()).getByText('2 added')).toBeInTheDocument()
  expect(within(comparison()).getByText(ONGOING).closest('ins')).not.toBeNull()

  // The latest version is the current text.
  fireEvent.click(rows()[2])
  fireEvent.click(within(view()).getByRole('button', { name: 'Current text' }))
  expect(within(comparison()).getByText(/No differences/)).toBeInTheDocument()
  expect(within(view()).getByRole('button', { name: 'Restore this version' })).toBeDisabled()
})

it('restores an earlier version as the section’s draft, built on the newest version (AC6, AC7)', async () => {
  const restored = workspace(
    [
      {
        ...CONSTRUCTION,
        document: {
          ...CONSTRUCTION.document!,
          version: 3,
          document: VERSION_1,
          restoredFrom: 'version:1',
        },
      },
      FIRE,
    ],
    '2026-10-19T02:05:00.000Z',
  )
  answerRestore = () =>
    json(200, {
      version: { ...restored.sections[0].document, current: undefined },
      workspace: restored,
    })
  await openHistory()

  fireEvent.click(within(view()).getByRole('button', { name: 'Restore this version' }))
  const dialog = screen.getByRole('dialog', { name: 'Restore version 1?' })
  expect(within(dialog).getByText(/Other sections are not changed/)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restore version' }))

  // Back on the draft, which now holds the version's text (AC6).
  const editor = await screen.findByRole('region', { name: 'Draft editor' })
  expect(within(editor).getByText('Restored version 1')).toBeInTheDocument()
  expect(within(editor).getByText(/saved as version 3/)).toBeInTheDocument()
  expect(within(editor).getByText(ONGOING)).toBeInTheDocument()
  expect(within(editor).queryByText(PERMITS)).toBeNull()
  // One restore of section 7 alone, on the version and draft it was looking at (AC7).
  expect(sent).toEqual([
    {
      url: `/api/assessments/${REF}/sections/7/versions/restore`,
      body: { baseVersion: 2, draftId: 'd7', from: 'version:1' },
    },
  ])
})

it('keeps the history open on a refused restore, with the reason', async () => {
  answerRestore = () =>
    json(409, { error: 'This section was saved again after you opened its version history.' })
  await openHistory()

  fireEvent.click(within(view()).getByRole('button', { name: 'Restore this version' }))
  const dialog = screen.getByRole('dialog', { name: 'Restore version 1?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restore version' }))

  expect(await within(dialog).findByText('Version not restored')).toBeInTheDocument()
  expect(within(dialog).getByText(/saved again after you opened/)).toBeInTheDocument()
  expect(view()).toBeInTheDocument()
})

it('stays open as another section is chosen, and opens from the assessment’s ⋯ menu', async () => {
  await openWorkspace()
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }))

  // The Review tab opens on its version history.
  await within(await screen.findByRole('complementary', { name: 'Versions' })).findAllByRole(
    'button',
  )
  expect(within(view()).getByRole('heading', { name: '7. Construction' })).toBeInTheDocument()

  // Another section in the rail: its own history, still in the history view.
  const nav = screen.getByRole('navigation', { name: 'Report sections' })
  fireEvent.click(within(nav).getByRole('button', { name: /Fire Protection/ }))
  expect(within(view()).getByRole('heading', { name: '9. Fire Protection' })).toBeInTheDocument()
  expect(await within(view()).findByText('No versions yet')).toBeInTheDocument()
  fireEvent.click(within(view()).getByRole('button', { name: 'Back to the draft' }))
  expect(screen.getByRole('region', { name: 'Draft editor' })).toBeInTheDocument()
})

it('shows the history without Restore to whoever may not change the section', async () => {
  mockGateway()
  render(
    <ReviewWorkspaceScreen
      reference={REF}
      canReview={false}
      wrapStyle={{}}
      railStyle={{}}
      panelStyle={{}}
      onGenerate={() => {}}
    />,
  )
  const editor = await screen.findByRole('region', { name: 'Draft editor' })
  fireEvent.click(within(editor).getByRole('button', { name: 'Version history' }))
  await within(versions()).findAllByRole('button')

  expect(within(comparison()).getByText(PERMITS).closest('ins')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull()
})

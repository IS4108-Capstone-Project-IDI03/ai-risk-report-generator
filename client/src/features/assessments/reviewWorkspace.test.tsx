import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { ReviewSection, SourcePassage } from './api'

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
  model: 'claude-opus-5-5',
  effort: 'high',
  prompt_version: 'gn01-v2.3',
  template_version: 'global-pre-v2.0-2026-02',
  generated_at: '2026-10-03T06:00:00.000Z',
}
const passage = (fields: Partial<SourcePassage> & Pick<SourcePassage, 'id'>): SourcePassage => ({
  kind: 'standard',
  text: '',
  headings: [],
  pageStart: null,
  pageEnd: null,
  documentId: 'doc',
  document: null,
  ...fields,
})
const STANDARD = passage({
  id: 'C:fm121:4',
  text: 'Fire-stop all penetrations of rated assemblies.',
  headings: ['Fire stopping', 'Penetrations'],
  pageStart: 12,
  pageEnd: 13,
  documentId: 'fm121',
  document: {
    title: 'FM Global Data Sheet 1-21',
    issuingBody: 'FM Global',
    sourceType: 'fm_standard',
    edition: '2022',
    effectiveDate: '2022-04-01',
    withdrawnAt: null,
    fileUrl: '/api/knowledge-documents/fm121/file',
  },
})
const WITHDRAWN = passage({
  id: 'C:nfpa25:2',
  text: 'Inspect control valves weekly.',
  pageStart: 3,
  documentId: 'nfpa25',
  document: {
    title: 'NFPA 25',
    issuingBody: 'NFPA',
    sourceType: 'nfpa_standard',
    edition: '2020',
    effectiveDate: '2020-01-01',
    withdrawnAt: '2026-10-04T02:00:00.000Z',
    fileUrl: '/api/knowledge-documents/nfpa25/file',
  },
})
const PRECEDENT = passage({
  id: 'P:rep:9',
  kind: 'precedent',
  text: 'The building is of fire-resistive construction.',
  headings: ['Property Risk Evaluation Report', 'Construction'],
  pageStart: 6,
  documentId: 'rep',
  document: {
    title: 'Jurong Logistics Hub PRE 2024',
    issuingBody: 'Marsh',
    sourceType: 'marsh_report',
    edition: null,
    effectiveDate: '2024-03-12',
    withdrawnAt: null,
    fileUrl: '/api/knowledge-documents/rep/file',
  },
})

const CONSTRUCTION: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'partial', written: 1, total: 2, tables: 1 },
  review: {
    state: 'needs_review',
    unsupportedStatements: 1,
    withdrawnSources: 1,
    changesSinceDraft: 0,
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
            text: 'Riser penetrations were not fire-stopped at Level 3.',
            citations: ['O:o1', 'C:fm121:4'],
            supported: true,
          },
          {
            text: 'Sprinkler control valves are inspected weekly.',
            citations: ['O:o2', 'C:nfpa25:2'],
            supported: true,
          },
          {
            text: 'The building is of fire-resistive construction.',
            citations: ['P:rep:9'],
            supported: false,
          },
        ],
      },
      { heading: 'Construction Table', kind: 'table', statements: [] },
      { heading: 'Details on Combustible Construction', kind: 'narrative', statements: [] },
    ],
    questions: ['Is there a recent riser survey?'],
    guardrail: { passed: false, unsupported_count: 1 },
    provenance: PROVENANCE,
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  sources: { [STANDARD.id]: STANDARD, [WITHDRAWN.id]: WITHDRAWN, [PRECEDENT.id]: PRECEDENT },
  observations: [
    {
      id: 'o1',
      copeDimension: 'Construction',
      note: 'Riser shaft not fire-stopped at L3.',
      transcripts: [],
      severity: 'high',
      location: 'Riser B, Level 3',
      standard: null,
    },
    {
      id: 'o2',
      copeDimension: 'Protection',
      note: null,
      transcripts: ['Valve tags show weekly checks.'],
      severity: 'low',
      location: 'Pump room, Basement 1',
      standard: 'NFPA 25',
    },
  ],
}
const FIRE: ReviewSection = {
  ...CONSTRUCTION,
  id: '9',
  title: 'Fire Protection',
  copeDimensions: ['Protection'],
  completion: { state: 'complete', written: 1, total: 1, tables: 0 },
  review: {
    state: 'ai_draft',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
  },
  draft: {
    ...CONSTRUCTION.draft!,
    id: 'd9',
    sectionId: '9',
    title: 'Fire Protection',
    subsections: [
      {
        heading: 'Sprinkler Protection',
        kind: 'narrative',
        statements: [{ text: 'Valves are checked weekly.', citations: ['O:o2'], supported: true }],
      },
    ],
    questions: [],
  },
  sources: {},
  observations: [CONSTRUCTION.observations[1]],
}
const EXPOSURES: ReviewSection = {
  id: '10',
  title: 'External Exposures',
  copeDimensions: ['Exposure'],
  completion: { state: 'not_started', written: 0, total: 0, tables: 0 },
  review: {
    state: 'not_drafted',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
  },
  draft: null,
  sources: {},
  observations: [],
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

function mockGateway(review: () => Promise<Response>) {
  vi.stubGlobal('fetch', (url: string) => {
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/review`) return review()
    if (url === `/api/assessments/${REF}/sections`) return json(200, [])
    return json(200, [])
  })
}

async function openReview(review = () => json(200, { sections: [CONSTRUCTION, FIRE, EXPOSURES] })) {
  mockGateway(review)
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /^Review/ }))
}

const editor = () => screen.getByRole('region', { name: 'Draft editor' })
const panel = () => screen.getByRole('complementary', { name: 'Source panel' })
const viewer = () => within(panel()).getByRole('article', { name: 'Source passage' })
// The value shown beside a label in a source's details.
const detail = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label, { selector: 'dt' }).nextElementSibling

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows the draft editor with its sources, observations and claims beside it (AC1-AC4)', async () => {
  await openReview()

  // The first drafted section opens in the draft editor (AC1).
  expect(await screen.findByRole('region', { name: 'Draft editor' })).toBeInTheDocument()
  expect(within(editor()).getByRole('heading', { name: '7. Construction' })).toBeInTheDocument()
  expect(within(editor()).getByText(/claude-opus-5-5 \(high effort\)/)).toBeInTheDocument()
  expect(within(editor()).getByText(/completed from measured values/)).toBeInTheDocument()
  expect(within(editor()).getByText(/No evidence covers this subsection/)).toBeInTheDocument()
  expect(within(editor()).getByText('Unsupported')).toBeInTheDocument()
  expect(within(editor()).getByText('Is there a recent riser survey?')).toBeInTheDocument()

  // The reference source panel sits beside it, listing every cited passage (AC2).
  const sources = within(panel()).getByRole('region', { name: 'Reference sources' })
  expect(within(sources).getByText('FM Global Data Sheet 1-21')).toBeInTheDocument()
  expect(within(sources).getByText('pp. 12–13')).toBeInTheDocument()
  expect(within(sources).getByText('Jurong Logistics Hub PRE 2024')).toBeInTheDocument()

  // The original observations, verbatim, including another category's cited one (AC3).
  const observations = within(panel()).getByRole('region', { name: 'Original observations' })
  expect(within(observations).getByText('Riser shaft not fire-stopped at L3.')).toBeInTheDocument()
  expect(within(observations).getByText('Valve tags show weekly checks.')).toBeInTheDocument()
  expect(within(observations).getByText('Riser B, Level 3')).toBeInTheDocument()

  // Every claim, with its citations (AC4).
  const claims = within(panel()).getByRole('region', { name: 'Claims' })
  expect(within(claims).getAllByRole('listitem')).toHaveLength(3)
  expect(within(claims).getByText('3 · 1 unsupported')).toBeInTheDocument()
  for (const statement of CONSTRUCTION.draft!.subsections[0].statements)
    expect(within(claims).getByText(statement.text)).toBeInTheDocument()
  const resting = within(claims).getAllByRole('listitem')[2]
  expect(within(resting).getByText('Unsupported')).toBeInTheDocument()
  expect(within(resting).getByRole('button', { name: /^Citation 5: Jurong/ })).toBeInTheDocument()
}, 15_000)

it("shows each section's completion and review state in the navigation (AC5, AC6)", async () => {
  await openReview()
  const nav = await screen.findByRole('navigation', { name: 'Report sections' })
  const row = (name: RegExp) => within(nav).getByRole('button', { name })

  expect(row(/Construction/)).toHaveAttribute('aria-current', 'true')
  expect(within(row(/Construction/)).getByText('Partly written · 1 of 2 subsections')).toBeVisible()
  expect(within(row(/Construction/)).getByText('Needs review')).toBeVisible()
  expect(within(row(/Fire Protection/)).getByText('Complete · 1 of 1 subsection')).toBeVisible()
  expect(within(row(/Fire Protection/)).getByText('AI draft')).toBeVisible()
  expect(within(row(/External Exposures/)).getByText('Not started')).toBeVisible()
  expect(within(row(/External Exposures/)).getByText('Not drafted')).toBeVisible()
  expect(within(nav).getByText('2 of 3 sections drafted')).toBeInTheDocument()
  expect(within(nav).getByText('1 section needs review')).toBeInTheDocument()
}, 15_000)

it('opens the exact passage a citation references, with its page, title, edition and date (AC7-AC11)', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })
  expect(within(panel()).getByText(/Select a citation number in the draft/)).toBeInTheDocument()

  // Citations are numbered across the section, in the order first cited.
  fireEvent.click(
    within(editor()).getByRole('button', {
      name: 'Citation 2: FM Global Data Sheet 1-21, pp. 12–13',
    }),
  )

  const open = viewer()
  expect(within(open).getByText(STANDARD.text)).toBeInTheDocument()
  expect(within(open).getByText('External standard')).toBeInTheDocument()
  expect(detail(open, 'Pages')).toHaveTextContent('12–13')
  expect(within(open).getByRole('heading', { name: 'FM Global Data Sheet 1-21' })).toBeVisible()
  expect(detail(open, 'Edition')).toHaveTextContent('2022')
  expect(detail(open, 'Effective date')).toHaveTextContent('1 Apr 2022')
  expect(detail(open, 'Heading')).toHaveTextContent('Fire stopping › Penetrations')
  expect(within(open).queryByText('Withdrawn')).toBeNull()
  expect(
    within(open).getByRole('link', { name: /Open the original PDF at page 12/ }),
  ).toHaveAttribute('href', '/api/knowledge-documents/fm121/file#page=12')
  // The open citation stays marked in the draft, and its claim is picked out.
  expect(within(editor()).getByRole('button', { name: /^Citation 2:/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  expect(
    within(panel()).getByText(CONSTRUCTION.draft!.subsections[0].statements[0].text).closest('li'),
  ).toHaveClass('is-active')

  // An observation citation opens the observation as captured.
  fireEvent.click(within(editor()).getByRole('button', { name: /^Citation 1: Site observation/ }))
  const observation = within(panel()).getByRole('article', { name: 'Field observation' })
  expect(within(observation).getByText('Riser shaft not fire-stopped at L3.')).toBeInTheDocument()
  expect(detail(observation, 'Severity')).toHaveTextContent('High')

  fireEvent.click(within(panel()).getByRole('button', { name: 'Close source' }))
  expect(within(panel()).queryByRole('article')).toBeNull()
}, 15_000)

it('opens a cited past report, and labels a withdrawn source (AC7, AC12)', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })

  fireEvent.click(within(editor()).getByRole('button', { name: /^Citation 5: Jurong Logistics/ }))
  let open = viewer()
  expect(within(open).getByText(PRECEDENT.text)).toBeInTheDocument()
  expect(within(open).getByText('Past report')).toBeInTheDocument()
  expect(detail(open, 'Page')).toHaveTextContent('6')
  expect(detail(open, 'Report date')).toHaveTextContent('12 Mar 2024')
  expect(within(open).queryByText('Edition')).toBeNull()
  expect(within(open).getByText(/wording and precedent only/)).toBeInTheDocument()

  // A source withdrawn since drafting is labelled, in the list and when opened.
  expect(within(editor()).getByText('A source this draft cites has been withdrawn')).toBeVisible()
  const sources = within(panel()).getByRole('region', { name: 'Reference sources' })
  const listed = within(sources).getByRole('button', { name: /NFPA 25/ })
  expect(within(listed).getByText('Withdrawn')).toBeInTheDocument()
  fireEvent.click(listed)
  open = viewer()
  expect(within(open).getByRole('heading', { name: 'NFPA 25' })).toBeVisible()
  expect(within(open).getByText('Withdrawn', { selector: 'span' })).toBeInTheDocument()
  expect(detail(open, 'Withdrawn')).toHaveTextContent('Oct 2026')
  expect(detail(open, 'Edition')).toHaveTextContent('2020')
  expect(detail(open, 'Effective date')).toHaveTextContent('1 Jan 2020')
}, 15_000)

it('moves between sections and shows one without a draft as not drafted', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })
  const nav = screen.getByRole('navigation', { name: 'Report sections' })

  fireEvent.click(within(editor()).getByRole('button', { name: 'Next' }))
  expect(within(editor()).getByRole('heading', { name: '9. Fire Protection' })).toBeVisible()
  expect(within(panel()).getByText('The draft cites no standards or past reports.')).toBeVisible()

  fireEvent.click(within(nav).getByRole('button', { name: /External Exposures/ }))
  expect(within(editor()).getByText('Not drafted yet')).toBeInTheDocument()
  expect(within(editor()).getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(within(panel()).getByText(/no draft, so nothing is cited yet/)).toBeInTheDocument()
  // Its button leads to drafting.
  fireEvent.click(within(editor()).getByRole('button', { name: 'Go to Report generation' }))
  expect(screen.getByRole('tab', { name: /Report generation/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}, 15_000)

it('says when there is nothing to review yet', async () => {
  await openReview(() => json(200, { sections: [EXPOSURES] }))
  expect(await screen.findByText('No sections drafted yet')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Draft editor' })).toBeNull()
}, 15_000)

it('says why the workspace could not be loaded', async () => {
  await openReview(() => json(503, { error: 'The drafting service could not be reached.' }))
  expect(await screen.findByText('The review workspace could not be loaded')).toBeInTheDocument()
  expect(screen.getByText('The drafting service could not be reached.')).toBeInTheDocument()
}, 15_000)

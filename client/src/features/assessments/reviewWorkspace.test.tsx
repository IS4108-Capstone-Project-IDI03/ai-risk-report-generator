import { SourcePanel } from './components/SourcePanel'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { ReviewWorkspace as ReviewWorkspaceScreen } from './screens/ReviewWorkspace'
import type {
  AcceptedOfi,
  FindingCounts,
  FindingState,
  OfiList,
  ReviewSection,
  ReviewStatement,
  ReviewWorkspace,
  SourcePassage,
} from './api'

// jsdom does not implement native modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
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

// A finding as the gateway sends it (RV-02): pending review unless a test decides it.
const PENDING: ReviewStatement['review'] = { state: 'pending', at: null, by: null }
const finding = (
  text: string,
  citations: string[],
  supported = true,
  review: ReviewStatement['review'] = PENDING,
  generatedText = text,
): ReviewStatement => ({ text, generatedText, citations, supported, review })
const counts = (fields: Partial<FindingCounts> = {}): FindingCounts => {
  const c = { pending: 0, accepted: 0, edited: 0, rejected: 0, ...fields }
  return { total: c.pending + c.accepted + c.edited + c.rejected, ...c }
}
// The review workspace as the gateway sends it, its summary counted from the sections.
function workspace(sections: ReviewSection[], asOf = '2026-10-11T06:00:00.000Z'): ReviewWorkspace {
  const sum = (state: FindingState) => sections.reduce((n, s) => n + s.findings[state], 0)
  return {
    sections,
    summary: counts({
      pending: sum('pending'),
      accepted: sum('accepted'),
      edited: sum('edited'),
      rejected: sum('rejected'),
    }),
    asOf,
  }
}

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
          finding('Riser penetrations were not fire-stopped at Level 3.', ['O:o1', 'C:fm121:4']),
          finding('Sprinkler control valves are inspected weekly.', ['O:o2', 'C:nfpa25:2']),
          finding('The building is of fire-resistive construction.', ['P:rep:9'], false),
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
  findings: counts({ pending: 3 }),
  replacement: null,
  history: [],
  sources: { [STANDARD.id]: STANDARD, [WITHDRAWN.id]: WITHDRAWN, [PRECEDENT.id]: PRECEDENT },
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
    {
      id: 'o2',
      copeDimensions: ['Protection'],
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
    changeCounts: { added: 0, changed: 0, removed: 0 },
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
        statements: [finding('Valves are checked weekly.', ['O:o2'])],
      },
    ],
    questions: [],
  },
  findings: counts({ pending: 1 }),
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
    changeCounts: { added: 0, changed: 0, removed: 0 },
  },
  findings: counts(),
  draft: null,
  sources: {},
  observations: [],
  replacement: null,
  history: [],
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// Section 3's OFIs (GN-05); none unless a test sets them.
let ofis: OfiList = { suggestions: [], accepted: [] }

// A review decision (RV-02) the gateway received: its method, path and body.
type Sent = { method: string; url: string; body: unknown }
let decide: (sent: Sent) => Promise<Response> = () => json(500, { error: 'Not expected.' })
const sent: Sent[] = []

function mockGateway(review: () => Promise<Response>) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    // Review decisions; anything else written, e.g. a capture session, is answered as before.
    if (init?.method && init.method !== 'GET' && url.includes('/sections/')) {
      const request = {
        method: init.method,
        url,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      sent.push(request)
      return decide(request)
    }
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/ofis`) return json(200, ofis)
    if (url === `/api/assessments/${REF}/review`) return review()
    if (url === `/api/assessments/${REF}/sections`) return json(200, [])
    return json(200, [])
  })
}

async function openReview(review = () => json(200, workspace([CONSTRUCTION, FIRE, EXPOSURES]))) {
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
  sent.length = 0
  decide = () => json(500, { error: 'Not expected.' })
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
  // The last section leads on to Appendix A (GN-07), so its Next is live.
  expect(within(editor()).getByRole('button', { name: 'Next' })).toBeEnabled()
  expect(within(panel()).getByText(/no draft, so nothing is cited yet/)).toBeInTheDocument()
  // Its button leads to drafting.
  fireEvent.click(within(editor()).getByRole('button', { name: 'Go to Generation' }))
  expect(screen.getByRole('tab', { name: /Generation/ })).toHaveAttribute('aria-selected', 'true')
}, 15_000)

it('says when there is nothing to review yet', async () => {
  await openReview(() => json(200, workspace([EXPOSURES])))
  expect(await screen.findByText('No sections drafted yet')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Draft editor' })).toBeNull()
}, 15_000)

it('says why the workspace could not be loaded', async () => {
  await openReview(() => json(503, { error: 'The drafting service could not be reached.' }))
  expect(await screen.findByText('The review workspace could not be loaded')).toBeInTheDocument()
  expect(screen.getByText('The drafting service could not be reached.')).toBeInTheDocument()
}, 15_000)

it('shows the OFIs accepted into the report as section 3 (GN-05)', async () => {
  const ofi: AcceptedOfi = {
    id: 'ofi1',
    number: '2026-01',
    title: 'Lock Open Sprinkler Control Valve',
    category: 'Physical Protection',
    type: 'Fire Protection System Operation',
    description: 'Lock the valve open.',
    observation: 'The valve was found shut.',
    likelihood: 'Likely',
    consequence: 'Major',
    priority: 'Priority 1',
    effort: 'Minor Capital',
    observations: [],
    standards: [],
    precedent: null,
    sources: {},
    precedentReport: null,
    status: 'New',
    issueDate: '2026-04-21T00:00:00.000Z',
    provenance: {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      prompt_version: 'gn05-v4',
      config_version: 'ofi-config-2026-10-08',
      generated_at: '2026-10-08T12:00:00.000Z',
    },
  }
  ofis = {
    suggestions: [{ ...ofi, id: 'ofi2', title: 'Improve Hot Work Permit' }],
    accepted: [ofi],
  }
  await openReview()
  const nav = await screen.findByRole('navigation', { name: 'Report sections' })
  // A drafted section still opens first; section 3 leads the rail with its count.
  expect(within(nav).getByRole('button', { name: /Construction/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  const three = within(nav).getByRole('button', { name: /Opportunities for Improvement/ })
  expect(within(three).getByText('1 in the report')).toBeVisible()

  fireEvent.click(three)
  // Laid out like a section's draft: the editor bar, the provenance, then each OFI in an
  // AI draft box.
  // Counted with every part of the report: 1, 2, 3, 7, 9, 10 and Appendix A here.
  expect(within(editor()).getByText('Draft editor · 3 of 7')).toBeInTheDocument()
  expect(within(editor()).getByText(/prompt gn05-v4/)).toBeInTheDocument()
  // Each in an AI draft box: the suggestion waiting to be accepted, and the OFI in the report.
  expect(within(editor()).getAllByText('AI draft')).toHaveLength(2)
  expect(within(editor()).getByText('2026-01')).toBeInTheDocument()
  expect(within(editor()).getByText('Lock Open Sprinkler Control Valve')).toBeInTheDocument()
  // Suggestions are accepted here, not on Generation (GN-07, 12 Oct), and stay out
  // of the report until they are.
  const report = within(editor()).getByRole('region', {
    name: 'Opportunities for Improvement in the report',
  })
  expect(within(report).queryByText('Improve Hot Work Permit')).toBeNull()
  expect(within(editor()).getByText('Improve Hot Work Permit')).toBeInTheDocument()
  expect(
    within(editor()).getByText(/1 suggestion, not in the report until accepted/),
  ).toBeInTheDocument()
  // Next leads into the first section.
  fireEvent.click(within(editor()).getByRole('button', { name: 'Next' }))
  expect(within(editor()).getByRole('heading', { name: '7. Construction' })).toBeVisible()
  expect(within(editor()).getByText('Draft editor · 4 of 7')).toBeInTheDocument()
  // And Previous leads back to it.
  fireEvent.click(within(editor()).getByRole('button', { name: 'Previous' }))
  expect(within(editor()).getByText('Draft editor · 3 of 7')).toBeInTheDocument()
  ofis = { suggestions: [], accepted: [] }
})

it('opens referenced observation photos from Review citations without inline images', () => {
  const photo = {
    id: 'p1',
    name: 'riser.jpg',
    contentType: 'image/jpeg' as const,
    size: 100,
    url: '/riser.jpg',
    added: null,
  }
  const observation = {
    id: 'o1',
    engineer: 'Alex',
    copeDimensions: ['Construction'],
    severity: 'high',
    standard: null,
    location: null,
    note: null,
    recordings: [],
    removedRecordings: [],
    removedPhotos: [],
    interpretation: null,
    edited: null,
    deleted: null,
    recordedAt: '2026-10-10T06:00:00Z',
    photos: [photo],
  }
  const props = {
    section: CONSTRUCTION,
    savedObservations: [observation],
    focus: { citation: null, statement: null },
    describe: () => 'Observation',
    onCite: vi.fn(),
    onShowClaim: vi.fn(),
    style: {},
  }
  const view = render(<SourcePanel {...props} numbers={new Map([['O:o1', 1]])} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  const photoLink = screen.getByRole('button', { name: 'View photo' })
  const observationCard = photoLink.closest('li')!
  expect(within(observationCard).getByText('Riser B, Level 3')).toBeInTheDocument()
  expect(within(observationCard).getByRole('button', { name: 'View photo' })).toBeInTheDocument()
  expect(screen.queryByText('riser.jpg')).not.toBeInTheDocument()
  expect(photoLink.closest('[role="button"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'View photo' }))
  expect(
    within(screen.getByRole('dialog', { name: 'riser.jpg' })).getByText(
      'Observation 1 · Riser B, Level 3',
    ),
  ).toBeInTheDocument()
  expect(props.onCite).not.toHaveBeenCalled()
  expect(
    within(screen.getByRole('dialog', { name: 'riser.jpg' })).getByRole('img'),
  ).toHaveAttribute('src', '/riser.jpg')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(<SourcePanel {...props} numbers={new Map()} />)
  expect(screen.queryByRole('button', { name: 'View photo' })).not.toBeInTheDocument()
})

// Reviewing generated findings (RV-02).

const ALEX = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
// 11 Oct 2026 14:02 in the browser's own time zone, as the screen shows it.
const AT = new Date(2026, 9, 11, 14, 2).toISOString()
const LATER = '2026-10-11T06:05:00.000Z'
const LATEST = '2026-10-11T06:10:00.000Z'
const decided = (state: FindingState): ReviewStatement['review'] => ({ state, at: AT, by: ALEX })
const [RISER, VALVES, ROOF] = CONSTRUCTION.draft!.subsections[0].statements
const EDITED = 'Control valves are locked open and checked weekly.'

// Section 7 with these findings, counted as the gateway counts them.
function seven(statements: ReviewStatement[], extra: Partial<ReviewSection> = {}): ReviewSection {
  const n = (state: FindingState) => statements.filter((s) => s.review.state === state).length
  const [narrative, ...rest] = CONSTRUCTION.draft!.subsections
  return {
    ...CONSTRUCTION,
    // The only unsupported finding is rejected in most of these tests.
    review: {
      ...CONSTRUCTION.review,
      unsupportedStatements: statements.filter((s) => !s.supported && s.review.state !== 'rejected')
        .length,
    },
    draft: { ...CONSTRUCTION.draft!, subsections: [{ ...narrative, statements }, ...rest] },
    findings: counts({
      pending: n('pending'),
      accepted: n('accepted'),
      edited: n('edited'),
      rejected: n('rejected'),
    }),
    ...extra,
  }
}
const entry = (
  fields: Partial<ReviewSection['history'][number]> &
    Pick<ReviewSection['history'][number], 'action'>,
): ReviewSection['history'][number] => ({
  id: `h-${fields.action}-${fields.finding}`,
  draftId: 'd7',
  finding: null,
  heading: 'Construction Narrative',
  before: null,
  after: null,
  citations: [],
  instruction: null,
  bulk: false,
  by: ALEX,
  at: AT,
  ...fields,
})
const REJECTION = entry({
  action: 'reject',
  finding: '0.2',
  before: ROOF.text,
  citations: ['P:rep:9'],
})
const reply =
  (sections: ReviewSection[], asOf = LATER) =>
  () =>
    json(200, workspace(sections, asOf))
const findingOf = (n: number) => within(editor()).getByRole('group', { name: `Finding ${n}` })
const nav = () => screen.getByRole('navigation', { name: 'Report sections' })
const rowOf = (name: RegExp) => within(nav()).getByRole('button', { name })

it('shows each finding’s decision, leaves rejected ones out of the draft and totals the saved decisions (AC3-AC6, AC9)', async () => {
  const reviewed = seven(
    [
      { ...RISER, review: decided('accepted') },
      { ...VALVES, text: EDITED, review: decided('edited') },
      { ...ROOF, review: decided('rejected') },
    ],
    {
      history: [
        REJECTION,
        entry({ action: 'edit', finding: '0.1', before: VALVES.text, after: EDITED }),
        entry({ action: 'accept', finding: '0.0', before: RISER.text }),
      ],
    },
  )
  await openReview(reply([reviewed, FIRE, EXPOSURES]))
  await screen.findByRole('region', { name: 'Draft editor' })

  // The review summary counts the saved decisions across the report (AC9).
  const summary = within(nav()).getByRole('region', { name: 'Review summary' })
  expect(detail(summary, 'Accepted')).toHaveTextContent('1')
  expect(detail(summary, 'Edited')).toHaveTextContent('1')
  expect(detail(summary, 'Rejected')).toHaveTextContent('1')
  expect(detail(summary, 'Pending')).toHaveTextContent('1')
  expect(within(summary).getByText('3 of 4 findings decided')).toBeInTheDocument()
  expect(
    within(editor()).getByText('1 accepted · 1 edited · 1 rejected · 0 pending'),
  ).toBeInTheDocument()

  // A rejected finding is out of the visible draft and its claims (AC5).
  expect(within(editor()).queryByText(ROOF.text)).toBeNull()
  expect(within(editor()).getAllByRole('group', { name: /^Finding \d+$/ })).toHaveLength(2)
  const claims = within(panel()).getByRole('region', { name: 'Claims' })
  expect(within(claims).getAllByRole('listitem')).toHaveLength(2)
  expect(within(claims).queryByText(ROOF.text)).toBeNull()

  // Each finding shows its decision, and who made it when.
  expect(within(findingOf(1)).getByText('Accepted')).toBeInTheDocument()
  expect(within(findingOf(1)).getByText('Alex Rowe · 11 Oct 2026 14:02')).toBeInTheDocument()
  expect(within(findingOf(2)).getByText(EDITED)).toBeInTheDocument()
  expect(within(findingOf(2)).getByText('Edited')).toBeInTheDocument()
  // What the draft said stays one click away.
  expect(within(findingOf(2)).getByText('Drafted text')).toBeInTheDocument()
  expect(within(findingOf(2)).getByText(VALVES.text)).toBeInTheDocument()

  // The history keeps the rejected finding's content (AC6), and an edit's text
  // before and after (AC3), each with who made it and when (AC4).
  const history = within(panel()).getByRole('region', { name: 'Review history' })
  const [rejection, edit, acceptance] = within(history).getAllByRole('listitem')
  expect(within(rejection).getByText('Rejected')).toBeInTheDocument()
  expect(within(rejection).getByText(ROOF.text)).toBeInTheDocument()
  expect(within(rejection).getByRole('button', { name: 'Restore finding' })).toBeInTheDocument()
  expect(within(edit).getByText(VALVES.text)).toBeInTheDocument()
  expect(within(edit).getByText(EDITED)).toBeInTheDocument()
  expect(within(edit).getByText('Alex Rowe · 11 Oct 2026 14:02')).toBeInTheDocument()
  expect(within(acceptance).getByText('Accepted')).toBeInTheDocument()
}, 15_000)

it('accepts a pending finding (AC1)', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })
  expect(within(findingOf(1)).getByText('Pending review')).toBeInTheDocument()
  decide = reply([
    seven([{ ...RISER, review: decided('accepted') }, VALVES, ROOF]),
    FIRE,
    EXPOSURES,
  ])

  fireEvent.click(within(editor()).getByRole('button', { name: 'Accept finding 1' }))

  await waitFor(() => expect(within(findingOf(1)).getByText('Accepted')).toBeInTheDocument())
  expect(sent).toEqual([
    {
      method: 'POST',
      url: `/api/assessments/${REF}/sections/7/findings/0.0/accept`,
      body: { draftId: 'd7' },
    },
  ])
  expect(within(findingOf(1)).queryByRole('button', { name: 'Accept finding 1' })).toBeNull()
  expect(within(findingOf(2)).getByText('Pending review')).toBeInTheDocument()
}, 15_000)

it('saves an edited finding’s text, keeping the dialog open with the reason when refused (AC2)', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })
  fireEvent.click(within(editor()).getByRole('button', { name: 'Edit finding 2' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit finding 2' })
  // What the draft says stays beside the engineer's wording.
  expect(
    within(within(dialog).getByRole('region', { name: 'What the draft says' })).getByText(
      VALVES.text,
    ),
  ).toBeInTheDocument()
  // The label also holds the hint beneath the box, so it is matched by its start.
  fireEvent.change(within(dialog).getByLabelText(/^Your wording/), { target: { value: EDITED } })

  decide = () =>
    json(409, {
      error:
        "This section's saved draft has changed since you opened it. Reload the review workspace and decide again.",
    })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save edit' }))
  expect(await within(dialog).findByText(/has changed since you opened it/)).toBeInTheDocument()

  decide = reply([
    seven([RISER, { ...VALVES, text: EDITED, review: decided('edited') }, ROOF]),
    FIRE,
    EXPOSURES,
  ])
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save edit' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(within(findingOf(2)).getByText(EDITED)).toBeInTheDocument()
  // Edited, it can still be accepted.
  expect(within(findingOf(2)).getByRole('button', { name: 'Accept finding 2' })).toBeEnabled()
  expect(sent.at(-1)).toEqual({
    method: 'PUT',
    url: `/api/assessments/${REF}/sections/7/findings/0.1`,
    body: { draftId: 'd7', text: EDITED },
  })
}, 15_000)

it('accepts an edited finding, keeping the engineer’s wording', async () => {
  const edited = { ...VALVES, text: EDITED, review: decided('edited') }
  await openReview(reply([seven([RISER, edited, ROOF]), FIRE, EXPOSURES]))
  await screen.findByRole('region', { name: 'Draft editor' })
  decide = reply(
    [seven([RISER, { ...edited, review: decided('accepted') }, ROOF]), FIRE, EXPOSURES],
    LATEST,
  )

  fireEvent.click(within(findingOf(2)).getByRole('button', { name: 'Accept finding 2' }))

  await waitFor(() =>
    expect(within(findingOf(2)).getByText('Accepted with edits')).toBeInTheDocument(),
  )
  expect(sent).toEqual([
    {
      method: 'POST',
      url: `/api/assessments/${REF}/sections/7/findings/0.1/accept`,
      body: { draftId: 'd7' },
    },
  ])
  expect(within(findingOf(2)).getByText(EDITED)).toBeInTheDocument()
  // What the draft said stays one click away.
  expect(within(findingOf(2)).getByText('Drafted text')).toBeInTheDocument()
  expect(within(findingOf(2)).queryByRole('button', { name: 'Accept finding 2' })).toBeNull()
}, 15_000)

it('rejects a finding only once confirmed, and restores it from the history (AC5, AC6)', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })

  fireEvent.click(within(editor()).getByRole('button', { name: 'Reject finding 3' }))
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Reject this finding?' })).getByRole('button', {
      name: 'Cancel',
    }),
  )
  expect(sent).toHaveLength(0)
  expect(within(editor()).getByText(ROOF.text)).toBeInTheDocument()

  decide = reply([
    seven([RISER, VALVES, { ...ROOF, review: decided('rejected') }], { history: [REJECTION] }),
    FIRE,
    EXPOSURES,
  ])
  fireEvent.click(within(editor()).getByRole('button', { name: 'Reject finding 3' }))
  const dialog = screen.getByRole('dialog', { name: 'Reject this finding?' })
  expect(within(dialog).getByText(ROOF.text)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reject finding' }))

  await waitFor(() => expect(within(editor()).queryByText(ROOF.text)).toBeNull())
  expect(sent).toEqual([
    {
      method: 'POST',
      url: `/api/assessments/${REF}/sections/7/findings/0.2/reject`,
      body: { draftId: 'd7' },
    },
  ])
  // The unsupported finding is out, so the section no longer says it has one.
  expect(within(editor()).queryByText('Some statements need review')).toBeNull()

  decide = reply([CONSTRUCTION, FIRE, EXPOSURES], LATEST)
  const history = within(panel()).getByRole('region', { name: 'Review history' })
  fireEvent.click(within(history).getByRole('button', { name: 'Restore finding' }))
  await waitFor(() => expect(within(editor()).getByText(ROOF.text)).toBeInTheDocument())
  expect(sent.at(-1)?.url).toBe(`/api/assessments/${REF}/sections/7/findings/0.2/restore`)
}, 15_000)

it('bulk accepts the section’s pending findings and leaves edited and rejected ones (AC7, AC8)', async () => {
  const edited = { ...VALVES, text: EDITED, review: decided('edited') }
  const rejected = { ...ROOF, review: decided('rejected') }
  await openReview(reply([seven([RISER, edited, rejected]), FIRE, EXPOSURES]))
  await screen.findByRole('region', { name: 'Draft editor' })
  decide = reply([
    seven([{ ...RISER, review: decided('accepted') }, edited, rejected]),
    FIRE,
    EXPOSURES,
  ])

  fireEvent.click(within(editor()).getByRole('button', { name: 'Bulk accept 1 pending finding' }))

  await waitFor(() =>
    expect(
      within(editor()).getByText('1 accepted · 1 edited · 1 rejected · 0 pending'),
    ).toBeInTheDocument(),
  )
  expect(sent).toEqual([
    {
      method: 'POST',
      url: `/api/assessments/${REF}/sections/7/bulk-accept`,
      body: { draftId: 'd7' },
    },
  ])
  expect(within(findingOf(1)).getByText('Accepted')).toBeInTheDocument()
  expect(within(findingOf(2)).getByText('Edited')).toBeInTheDocument()
  expect(within(editor()).queryByText(ROOF.text)).toBeNull()
  expect(
    within(editor()).getByRole('button', { name: 'Bulk accept 0 pending findings' }),
  ).toBeDisabled()
}, 15_000)

// A regenerated section 7 waiting beside its saved draft (AC10).
const REPLACEMENT_TEXT = 'Level 3 riser penetrations lack fire stopping.'
const REPLACEMENT_DRAFT = {
  ...CONSTRUCTION.draft!,
  id: 'r7',
  questions: [],
  subsections: [
    {
      heading: 'Construction Narrative',
      kind: 'narrative' as const,
      statements: [finding(REPLACEMENT_TEXT, ['O:o1'])],
    },
  ],
  provenance: {
    ...PROVENANCE,
    prompt_version: 'gn01-v2.4+rv02-v1',
    instruction: 'Name the riser.',
  },
}
const WAITING: ReviewSection = {
  ...CONSTRUCTION,
  replacement: {
    draft: REPLACEMENT_DRAFT,
    sources: {},
    observations: [CONSTRUCTION.observations[0]],
    instruction: 'Name the riser.',
    requestedBy: ALEX,
    requestedAt: AT,
  },
}

it('regenerates one section with an instruction and makes an accepted replacement its content (AC10, AC11)', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })
  let finish: (response: Response) => void = () => {}
  decide = () => new Promise((resolve) => (finish = resolve))

  fireEvent.click(within(editor()).getByRole('button', { name: 'Regenerate' }))
  const dialog = screen.getByRole('dialog', { name: 'Regenerate 7. Construction?' })
  fireEvent.change(within(dialog).getByLabelText(/What should change/), {
    target: { value: ' Name the riser. ' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate section' }))

  // Review goes on while it drafts.
  expect(await within(editor()).findByText('Regenerating section 7')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(within(rowOf(/Construction/)).getByText('Regenerating')).toBeInTheDocument()
  expect(sent).toEqual([
    {
      method: 'POST',
      url: `/api/assessments/${REF}/sections/7/regenerate`,
      body: { instruction: 'Name the riser.' },
    },
  ])
  finish(
    new Response(JSON.stringify(workspace([WAITING, FIRE, EXPOSURES], LATER)), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  // Only that section gets a replacement, and its saved draft still shows.
  expect(await within(editor()).findByText('A replacement draft is ready')).toBeInTheDocument()
  expect(within(editor()).getByText('Name the riser.')).toBeInTheDocument()
  expect(within(editor()).getByText(RISER.text)).toBeInTheDocument()
  expect(within(rowOf(/Construction/)).getByText('Replacement ready')).toBeInTheDocument()
  expect(within(rowOf(/Fire Protection/)).queryByText('Replacement ready')).toBeNull()

  // The replacement can be read, but not decided on, before it is accepted.
  fireEvent.click(within(editor()).getByRole('button', { name: 'Replacement' }))
  expect(within(editor()).getByText(REPLACEMENT_TEXT)).toBeInTheDocument()
  expect(within(editor()).queryByText(RISER.text)).toBeNull()
  expect(within(editor()).getByText(/prompt gn01-v2\.4\+rv02-v1/)).toBeInTheDocument()
  expect(within(editor()).queryByRole('button', { name: /^Accept finding/ })).toBeNull()
  fireEvent.click(within(editor()).getByRole('button', { name: 'Saved draft' }))
  expect(within(editor()).getByText(RISER.text)).toBeInTheDocument()

  const adopted: ReviewSection = {
    ...CONSTRUCTION,
    draft: REPLACEMENT_DRAFT,
    findings: counts({ pending: 1 }),
    sources: {},
    observations: [CONSTRUCTION.observations[0]],
    review: { ...CONSTRUCTION.review, unsupportedStatements: 0, withdrawnSources: 0 },
  }
  decide = reply([adopted, FIRE, EXPOSURES], LATEST)
  fireEvent.click(within(editor()).getByRole('button', { name: 'Accept replacement' }))
  const confirm = screen.getByRole('dialog', { name: 'Accept the replacement draft?' })
  fireEvent.click(within(confirm).getByRole('button', { name: 'Accept replacement' }))

  await waitFor(() =>
    expect(within(editor()).queryByText('A replacement draft is ready')).toBeNull(),
  )
  expect(within(editor()).getByText(REPLACEMENT_TEXT)).toBeInTheDocument()
  expect(within(editor()).queryByText(RISER.text)).toBeNull()
  expect(sent.at(-1)).toEqual({
    method: 'POST',
    url: `/api/assessments/${REF}/sections/7/replacement/accept`,
    body: { draftId: 'r7' },
  })
}, 15_000)

it('keeps the saved section content when the replacement is discarded (AC12)', async () => {
  await openReview(reply([WAITING, FIRE, EXPOSURES]))
  expect(await screen.findByText('A replacement draft is ready')).toBeInTheDocument()
  decide = reply([CONSTRUCTION, FIRE, EXPOSURES])

  fireEvent.click(within(editor()).getByRole('button', { name: 'Discard replacement' }))

  await waitFor(() =>
    expect(within(editor()).queryByText('A replacement draft is ready')).toBeNull(),
  )
  expect(within(editor()).getByText(RISER.text)).toBeInTheDocument()
  expect(within(editor()).queryByText(REPLACEMENT_TEXT)).toBeNull()
  expect(sent).toEqual([
    {
      method: 'POST',
      url: `/api/assessments/${REF}/sections/7/replacement/discard`,
      body: { draftId: 'r7' },
    },
  ])
}, 15_000)

it('says why a regeneration failed, leaving the saved draft', async () => {
  await openReview()
  await screen.findByRole('region', { name: 'Draft editor' })
  decide = () => json(503, { error: 'The model declined to draft this section.' })
  fireEvent.click(within(editor()).getByRole('button', { name: 'Regenerate' }))
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Regenerate 7. Construction?' })).getByRole(
      'button',
      { name: 'Regenerate section' },
    ),
  )
  expect(await within(editor()).findByText('The section was not regenerated')).toBeInTheDocument()
  expect(
    within(editor()).getByText(/The model declined to draft this section\./),
  ).toBeInTheDocument()
  expect(within(editor()).getByText(RISER.text)).toBeInTheDocument()
  expect(sent[0].body).toEqual({ instruction: '' })
}, 15_000)

it('shows decisions without the actions to whoever may not decide', async () => {
  mockGateway(reply([WAITING, FIRE, EXPOSURES]))
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
  await screen.findByRole('region', { name: 'Draft editor' })
  expect(within(findingOf(1)).getByText('Pending review')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^(Accept|Edit|Reject) finding/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Bulk accept/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Accept replacement' })).toBeNull()
  // The replacement can still be read.
  fireEvent.click(screen.getByRole('button', { name: 'Replacement' }))
  expect(within(editor()).getByText(REPLACEMENT_TEXT)).toBeInTheDocument()
})

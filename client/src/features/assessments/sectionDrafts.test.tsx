import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { ReportSection, SavedObservation, SectionDraft } from './api'

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
  status: 'ready_to_generate',
  captureStartedAt: '2026-09-23T09:05:00.000Z',
  createdAt: '2026-09-23T09:00:00.000Z',
  site: {
    code: 'SITE-0001',
    name: 'Jurong Distribution Hub',
    address: null,
    jurisdiction: 'MY',
    facilityType: 'Distribution warehouse',
  },
}
const RISER: SavedObservation = {
  id: 'o1',
  engineer: 'Alex Rowe',
  copeDimension: 'Construction',
  standard: null,
  severity: 'high',
  location: { id: 'l1', name: 'Riser B', floor: 'Level 3' },
  note: 'Riser shaft not fire-stopped at L3.',
  recordings: [],
  recordedAt: '2026-09-23T09:10:00.000Z',
}
const section = (fields: Partial<ReportSection>): ReportSection => ({
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  minObservations: 1,
  usableObservations: 1,
  latestDraft: null,
  changesSinceDraft: 0,
  ...fields,
})
const DRAFT: SectionDraft = {
  id: 'd1',
  sectionId: '7',
  title: 'Construction',
  subsections: [
    {
      heading: 'Construction Narrative',
      kind: 'narrative',
      statements: [
        {
          text: 'Riser shafts were noted to lack fire-stopping at Level 3.',
          citations: ['O:o1', 'C:fm:4'],
          supported: true,
        },
        { text: 'The roof is metal deck.', citations: ['C:missing'], supported: false },
      ],
    },
    { heading: 'Construction Table', kind: 'table', statements: [] },
    { heading: 'Details on Combustible Construction', kind: 'narrative', statements: [] },
  ],
  sources: {
    'C:fm:4': {
      text: 'Fire-stop all penetrations in rated assemblies.',
      doc_id: 'fm',
      headings: ['FM 1-21', 'Fire stopping'],
      page_start: 4,
      page_end: 5,
    },
  },
  questions: ['Is the ceiling void within the FM-200 protected volume?'],
  guardrail: { passed: false, unsupported_count: 1 },
  provenance: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'high',
    prompt_version: 'gn01-v1',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-03T06:00:00.000Z',
  },
  createdAt: '2026-10-03T06:00:00.000Z',
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const EXPOSURES = section({
  id: '10',
  title: 'External Exposures',
  copeDimensions: ['Exposure'],
  usableObservations: 0,
})

function mockGateway(
  draftReply: () => Promise<Response>,
  sections: ReportSection[] = [section({}), EXPOSURES],
) {
  const drafted: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/observations`) return json(200, [RISER])
    if (url === `/api/assessments/${REF}/sections`) return json(200, sections)
    const draft = url.match(/\/sections\/(\w+)\/draft$/)
    if (draft && init?.method === 'POST') {
      drafted.push(draft[1])
      return draftReply()
    }
    return json(200, [])
  })
  return drafted
}

async function openGenerateTab() {
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /Report generation/ }))
  await screen.findByText('Draft sections 7 to 12')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("drafts a section of a saved assessment and shows each statement's evidence (GN-01)", async () => {
  const drafted = mockGateway(() => json(201, DRAFT))
  await openGenerateTab()

  // A section without usable evidence offers no drafting, and says why.
  expect(screen.getByText(/Needs 1 observation filed under Exposure/)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Draft section' })).toHaveLength(1)
  // Nothing to review until a section is drafted.
  expect(screen.getByRole('button', { name: 'Review report' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Draft section' }))
  // The draft opens under its own section, and View/Hide draft toggles it.
  expect(await screen.findByRole('region', { name: '7. Construction draft' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Hide draft' }))
  expect(screen.queryByRole('region', { name: '7. Construction draft' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'View draft' }))
  expect(drafted).toEqual(['7'])

  // The configuration that wrote it is shown (AC7).
  expect(screen.getByText(/claude-opus-5-5 \(high effort\)/)).toBeInTheDocument()
  expect(screen.getByText(/gn01-v1/)).toBeInTheDocument()
  // An unresolved citation is marked, and tables and empty subsections say why they are blank.
  expect(screen.getByText('Some statements need review')).toBeInTheDocument()
  // The draft's questions for the engineer are shown with it.
  expect(screen.getByText('Questions for the engineer')).toBeInTheDocument()
  expect(screen.getByText(/ceiling void within the FM-200 protected volume/)).toBeInTheDocument()
  expect(screen.getByText('Unsupported')).toBeInTheDocument()
  expect(screen.getByText(/completed from measured values/)).toBeInTheDocument()
  expect(screen.getByText(/No evidence covers this subsection/)).toBeInTheDocument()

  // Each citation opens its observation or standard passage (AC4).
  fireEvent.click(screen.getByRole('button', { name: /3 sources/ }))
  const evidence = screen
    .getByText('Riser shaft not fire-stopped at L3.')
    .closest('div')!.parentElement!
  expect(within(evidence).getByText('Riser B, Level 3')).toBeInTheDocument()
  expect(screen.getByText('FM 1-21 › Fire stopping')).toBeInTheDocument()
  expect(screen.getByText('p. 4–5')).toBeInTheDocument()
  expect(screen.getByText('This citation could not be found')).toBeInTheDocument()

  // A drafted section can be drafted again; with nothing else draftable, the
  // whole-report button is gone.
  expect(screen.getByRole('button', { name: 'Redraft section' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Review report' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: /Draft (all|remaining) sections/ })).toBeNull()
  expect(screen.getByText(/1 of 1 section drafted · 1 needs attention/)).toBeInTheDocument()
}, 15_000) // Many role queries over the whole app; slow when every test file runs at once.

it('names the reason when a section could not be drafted', async () => {
  mockGateway(() =>
    json(409, {
      error: 'RPT-2026-0001 is still being captured. Complete the site assessment before drafting.',
    }),
  )
  await openGenerateTab()

  fireEvent.click(screen.getByRole('button', { name: 'Draft section' }))

  expect(await screen.findByText('Generation failed')).toBeInTheDocument()
  expect(screen.getByText(/still being captured/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})

it('drafts every section with enough evidence, one after another', async () => {
  const fire = section({ id: '9', title: 'Fire Protection', copeDimensions: ['Protection'] })
  const drafted = mockGateway(() => json(201, DRAFT), [section({}), fire, EXPOSURES])
  await openGenerateTab()

  fireEvent.click(screen.getByRole('button', { name: 'Draft all sections' }))

  await screen.findByText(/2 of 2 sections drafted · 1 needs attention/)
  // The section without evidence is left out of the run.
  expect(drafted).toEqual(['7', '9'])
  expect(screen.getAllByText('Drafted')).toHaveLength(2)
}, 15_000)

it('says when a draft is missing newer evidence', async () => {
  mockGateway(
    () => json(201, DRAFT),
    [section({ latestDraft: DRAFT, changesSinceDraft: 2 }), EXPOSURES],
  )
  await openGenerateTab()

  expect(screen.getByText(/2 observations added or changed since this draft/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Redraft section' })).toBeEnabled()
})

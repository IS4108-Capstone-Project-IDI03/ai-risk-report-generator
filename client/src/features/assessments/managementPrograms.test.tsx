// Section 6 Management Programs as Generation and Review show it (GN-11 AC1-AC5):
// Table 1 with each rank coloured, Table 2 the maturity scale, then the comments.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReviewSection, SectionDraft } from './api'
import { DraftEditor } from './components/DraftEditor'
import { DraftView } from './screens/SectionDrafts'

const PROVENANCE = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  prompt_version: 'gn01-v2.4',
  template_version: 'global-pre-v2.0-2026-02',
  generated_at: '2026-10-13T06:00:00.000Z',
}
const ROWS = [
  { text: 'Building Maintenance: Embedded. Structural checks every 5 years.', supported: true },
  { text: 'Hot Work Permit System: Formalized. Permits are issued by FM.', supported: true },
  // A rank outside Marsh's five: shown uncoloured and flagged.
  { text: 'Housekeeping: Excellent. Areas were tidy.', supported: false },
  // Not "<Program>: …", so it fits no row: shown below the table, never dropped.
  { text: 'Smoking Controls Formalized, signs posted.', supported: false },
]
const SIX: SectionDraft = {
  id: 'd6',
  sectionId: '6',
  title: 'Management Programs',
  subsections: [
    {
      heading: 'Management Programs',
      kind: 'fields',
      statements: ROWS.map((r) => ({ ...r, citations: ['O:o1'] })),
    },
    {
      heading: 'Management Program Comments',
      kind: 'narrative',
      statements: [
        {
          text: 'Maintenance is well run; hot work is loosely controlled.',
          citations: ['O:o1'],
          supported: true,
        },
      ],
    },
  ],
  sources: {},
  questions: [],
  guardrail: { passed: false, unsupported_count: 1 },
  provenance: PROVENANCE,
  createdAt: '2026-10-13T06:00:00.000Z',
}

afterEach(cleanup)

// Each row of Table 1 by its program: [rank cell, comment cell].
function row(program: string) {
  const table = screen.getByRole('table', { name: 'Management Programs' })
  const header = within(table).getByRole('rowheader', { name: program })
  return [...header.closest('tr')!.querySelectorAll('td')]
}

function expectTables() {
  const table = screen.getByRole('table', { name: 'Management Programs' })
  // AC1: Marsh's 15 programs, in the template's order.
  const programs = within(table)
    .getAllByRole('rowheader')
    .map((h) => h.textContent)
  expect(programs).toHaveLength(15)
  expect(programs[0]).toBe('Building Maintenance')
  expect(programs[9]).toBe('Emergency Response Planning')
  expect(programs[14]).toBe('Environmental, Social & Governance (ESG)')
  // AC4: a rank cell takes its rank's colour from the maturity scale.
  const [rank, comment] = row('Building Maintenance')
  expect(rank).toHaveTextContent('Embedded')
  expect(rank).toHaveClass('rv-rank', 'rv-rank-embedded')
  expect(comment).toHaveTextContent('Structural checks every 5 years.')
  expect(comment).not.toHaveTextContent('Building Maintenance:')
  expect(row('Hot Work Permit System')[0]).toHaveClass('rv-rank-formalized')
  // A rank outside the five is not coloured, and says so.
  const [odd] = row('Housekeeping')
  expect(odd).not.toHaveClass('rv-rank-embedded')
  expect(odd).toHaveTextContent('Not a maturity rank')
  // AC2: a program with no evidence is not rated.
  expect(row('Contractor Management')[1]).toHaveTextContent('Not assessed: no evidence captured')
  expect(row('Contractor Management')[0]).toBeEmptyDOMElement()
  // A row the table can't place is listed under it, with its flag.
  const unplaced = screen.getByRole('region', { name: 'Rows not matched to a program' })
  expect(within(unplaced).getByText(/Smoking Controls Formalized, signs posted\./)).toBeVisible()
  expect(within(unplaced).getByText('Unsupported')).toBeVisible()
  // Table 2, the fixed scale, with each rank in its colour.
  const scale = screen.getByRole('table', { name: 'Maturity scale' })
  const ranks = within(scale).getAllByRole('rowheader')
  expect(ranks.map((r) => r.textContent)).toEqual([
    'Undeveloped',
    'Formalized',
    'Established',
    'Embedded',
    'Optimized',
  ])
  expect(ranks[4]).toHaveClass('rv-rank-optimized')
  expect(within(scale).getByText(/Full ownership with active program maintenance/)).toBeVisible()
  // Then the comments paragraph.
  expect(screen.getByText('Maintenance is well run; hot work is loosely controlled.')).toBeVisible()
}

it("shows Section 6 on Generation as Marsh's two tables, then the comments (AC1, AC2, AC4)", () => {
  render(<DraftView draft={SIX} />)
  expectTables()
  // Generation only generates: no citations or review controls.
  expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
})

it('lets the engineer decide each row in Review, in the same tables (AC3, AC5)', () => {
  const section: ReviewSection = {
    id: '6',
    title: 'Management Programs',
    copeDimensions: ['Construction', 'Occupancy', 'Protection', 'Exposure'],
    completion: { state: 'complete', written: 2, total: 2, tables: 0 },
    review: {
      state: 'needs_review',
      unsupportedStatements: 1,
      withdrawnSources: 0,
      changesSinceDraft: 0,
      changeCounts: { added: 0, changed: 0, removed: 0 },
    },
    draft: {
      ...SIX,
      subsections: SIX.subsections.map((s) => ({
        ...s,
        statements: s.statements.map((st) => ({
          ...st,
          generatedText: st.text,
          review: { state: 'pending' as const, at: null, by: null },
        })),
      })),
    },
    sources: {},
    observations: [],
    findings: { total: 5, pending: 5, accepted: 0, edited: 0, rejected: 0 },
    replacement: null,
    history: [],
  }
  const onAccept = vi.fn()
  render(
    <DraftEditor
      section={section}
      position="2 of 8"
      onGenerate={() => {}}
      actions={{ busy: null, onAccept, onEdit: vi.fn(), onReject: vi.fn() }}
      numbers={new Map([['O:o1', 1]])}
      focus={{ citation: null, statement: null }}
      describe={() => 'Site observation'}
      onCite={() => {}}
    />,
  )
  expectTables()
  // Each row is a finding with its citation and the RV-02 decisions.
  const [, comment] = row('Building Maintenance')
  expect(within(comment).getByRole('button', { name: /Citation 1/ })).toBeInTheDocument()
  fireEvent.click(within(comment).getByRole('button', { name: 'Accept finding 1' }))
  expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ key: '0.0' }))
  // AC3: the row with a rank outside the five is marked Unsupported.
  expect(within(row('Housekeeping')[1]).getByText('Unsupported')).toBeInTheDocument()
  // AC5: an unplaced row is still a finding the engineer can decide on.
  const unplaced = screen.getByRole('region', { name: 'Rows not matched to a program' })
  expect(within(unplaced).getByRole('button', { name: 'Accept finding 4' })).toBeInTheDocument()
})

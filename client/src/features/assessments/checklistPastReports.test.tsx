// CP-37 slice 1: the Fixed badge, the past-report source label and the checklist's note.
// Fetch is mocked; no gateway or paid call.
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
const checklist = (items: ChecklistItem[], notes?: string[]): ChecklistData => ({
  id: 'c1',
  facilityType: 'Distribution warehouse',
  jurisdiction: 'SG',
  standards: [],
  areas: [{ id: '7', title: 'Construction' }],
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
const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
function show(c: ChecklistData) {
  const view: ChecklistView = {
    scope: { facilityType: 'Distribution warehouse', jurisdiction: 'SG' },
    standards: [],
    checklist: c,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => (url.endsWith('/sections') ? json([]) : json(view))),
  )
  render(
    <Checklist reference="R1" canGenerate={false} answering={null} onViewObservation={vi.fn()} />,
  )
}
beforeEach(() => {
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

it('tags a fixed item and names the past reports an item came from (AC1, AC3)', async () => {
  show(
    checklist([
      item({ id: 'f1', text: 'Is the roof fire rated?', fixed: true }),
      item({
        id: 'p1',
        origin: 'past_report',
        text: 'Check the dock door seals.',
        sourceReports: [{ title: 'Jurong DC 2024' }, { title: 'Tuas Hub 2023', docId: 'd2' }],
      }),
    ]),
  )
  const fixed = await screen.findByRole('listitem', { name: /roof fire rated/ })
  expect(within(fixed).getByText('Fixed')).toBeInTheDocument()
  const past = screen.getByRole('listitem', { name: /dock door seals/ })
  expect(
    within(past).getByText('From past report: Jurong DC 2024, Tuas Hub 2023'),
  ).toBeInTheDocument()
  expect(within(past).queryByText('Fixed')).toBeNull()
})

it('shows the checklist notes above the list (AC5)', async () => {
  show(
    checklist(
      [item({ id: 'f1', text: 'Is the roof fire rated?', fixed: true })],
      ['No past Marsh reports match this site type, so only the fixed questions are shown.'],
    ),
  )
  expect(await screen.findByText(/No past Marsh reports match this site type/)).toBeInTheDocument()
})

// Seed data and a fake rag-service for background drafting's tests (GN-13): an
// engineer and an admin, an assessment with observations, the engineer's
// figures, and S4 answering at the same routes as for the old drafting routes.
// Used by generation.test.ts and drafting-run.test.ts.
import { Types } from 'mongoose'
import { vi } from 'vitest'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'

export const REF = 'RPT-2026-0913'
const BAY = new Types.ObjectId()

// Sections 4 to 12 as rag-service generation/sections.json defines their categories.
const ALL = ['Construction', 'Occupancy', 'Protection', 'Exposure']
const TEMPLATE = [
  ['4', ALL],
  ['5', ALL],
  ['6', ALL],
  ['7', ['Construction']],
  ['8', ['Occupancy']],
  ['9', ['Protection']],
  ['10', ['Exposure']],
  ['11', ['Protection']],
  ['12', ['Exposure', 'Occupancy']],
].map(([id, cope]) => ({ id, title: `Title ${id}`, cope_dimensions: cope, min_observations: 1 }))

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const provenance = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  prompt_version: 'test',
  template_version: 'pre-v2.0',
  config_version: 'test',
  generated_at: '2026-11-18T00:00:00+00:00',
}
const sectionDraft = (id: string) => ({
  section_id: id,
  title: `Title ${id}`,
  subsections: [
    {
      heading: 'Narrative',
      kind: 'narrative',
      statements: [{ text: `Section ${id} finding.`, citations: [], supported: true }],
    },
  ],
  sources: {},
  questions: [],
  guardrail: { passed: true, unsupported_count: 0 },
  provenance,
})
export const OFI = {
  title: 'Supervise sprinkler control valves',
  category: 'Physical Protection',
  type: 'Fire Protection System',
  description: 'Lock the valves open.',
  observation: 'A valve was shut.',
  likelihood: 'Likely',
  consequence: 'Major',
  priority: 'Priority 1',
  effort: 'Minor Capital',
  observations: [] as string[],
  standards: [] as string[],
  precedent: null,
}

// Each call S4 received: its route (`/sections/draft`, `/ofis/draft`, `/summary/draft`) and body.
export type S4Call = { route: string; body: Record<string, unknown> }

/**
 * Stubs fetch as S4 and returns the calls it receives. `answer` may replace a
 * reply (return a Response) or hold one back (return a promise); return or
 * resolve to undefined for the usual reply.
 */
export function fakeS4(
  answer: (call: S4Call) => Response | undefined | Promise<Response | undefined> = () => undefined,
) {
  const calls: S4Call[] = []
  const ofis = { list: [OFI] as object[] }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const route = new URL(url).pathname
    if (route === '/sections' && !init?.body) return json({ sections: TEMPLATE })
    const call = { route, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> }
    calls.push(call)
    const own = await answer(call)
    if (own) return own
    if (route === '/sections/draft') return json(sectionDraft(String(call.body.section_id)))
    if (route === '/ofis/draft') return json({ ofis: ofis.list, sources: {}, provenance })
    if (route === '/summary/draft')
      return json({
        statements: [{ text: 'The report in short.', citations: ['S:7'], supported: true }],
        guardrail: { passed: true, unsupported_count: 0 },
        provenance,
      })
    return json({})
  })
  return { calls, ofis }
}

/** Returns S4's section drafts' ids, in the order asked for. */
export const draftedIds = (calls: S4Call[]) =>
  calls.map((c) => (c.route === '/sections/draft' ? String(c.body.section_id) : c.route))

/** Returns the engineer Alex Rowe and the admin Sana Patel, saved (the bell looks them up). */
export async function people() {
  const [engineer, admin] = await UserModel.create([
    { staffId: 'T-1', name: 'Alex Rowe', email: 'alex@example.com', role: 'risk_engineer' },
    { staffId: 'T-2', name: 'Sana Patel', email: 'sana@example.com', role: 'knowledge_admin' },
  ])
  return { engineer, admin }
}

/** Saves the assessment, assigned to `engineer`, with its site and a capture session; returns both ids. */
export async function assessment(engineer: Types.ObjectId) {
  const site = await SiteModel.create({
    code: 'SITE-0913',
    name: 'Jurong Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const created = await AssessmentModel.create({
    reference: REF,
    site: site._id,
    surveyType: 'First survey',
    engineer,
    locations: [{ _id: BAY, name: 'Bay 1', key: 'bay 1' }],
  })
  const session = await CaptureSessionModel.create({
    assessment: created._id,
    status: 'ready_for_generation',
  })
  return { id: created._id, session: session._id }
}

/** Saves an observation under `categories`; `transcribing` gives it an unfinished recording. */
export function observation(
  ids: { id: Types.ObjectId; session: Types.ObjectId },
  categories: CopeDimension[],
  { note = 'A finding.', transcribing = false } = {},
) {
  return ObservationModel.create({
    assessment: ids.id,
    session: ids.session,
    engineer: 'Alex Rowe',
    note,
    recordings: transcribing
      ? [
          {
            name: 'Recording 1',
            key: 'audio/x.webm',
            contentType: 'audio/webm',
            size: 3,
            transcription: { status: 'transcribing', attempts: [{ startedAt: new Date() }] },
          },
        ]
      : [],
    severity: 'high',
    location: BAY,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: categories,
      effective_date: new Date(),
    },
  })
}

/** Saves one observation in each COPE category, so all 8 step 1 parts have one. */
export async function everyCategory(ids: { id: Types.ObjectId; session: Types.ObjectId }) {
  for (const c of ALL) await observation(ids, [c as CopeDimension])
}

/** Does the engineer's three step 2 tasks: accepts the first OFI and enters every figure. */
export async function doTasks(id: Types.ObjectId) {
  await ReportOfiModel.updateOne(
    { assessment: id },
    { $set: { state: 'accepted', acceptedAt: new Date() } },
  )
  await AssessmentModel.updateOne({ _id: id }, { $set: FIGURES })
}

// Sections 4 and 5's figures (GN-03), all entered.
const FIGURES = {
  riskQuality: {
    categories: [
      'External Exposure',
      'Fire Protection',
      'Occupancy Hazards',
      'Construction',
      'Water Supply',
      'Surveillance',
      'Management Programs',
    ].map((category) => ({ category, current: 8, potential: 10 })),
    updatedAt: new Date(),
  },
  lossEstimates: {
    inputs: {
      currency: 'SGD',
      dateOfValues: '2026-01-01',
      indemnityMonths: 12,
      pd: [{ key: 'b', item: 'Buildings', value: 1000 }],
      te: [],
      levels: ['I', 'II', 'III'].map((level) => ({
        level,
        pd: [{ key: 'b', percent: 10 }],
        te: [],
      })),
    },
    updatedAt: new Date(),
  },
}

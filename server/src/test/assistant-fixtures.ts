// Seed data and a fake rag-service for MarshBot's tests (AS-06): an engineer
// and an admin, an assessment with its site, observations, a site walk and a
// checklist, written straight to the database.
import { Types } from 'mongoose'
import { vi } from 'vitest'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ChecklistModel } from '../models/checklist.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { UserModel } from '../models/user.model'

export const REF = 'RPT-2026-0003'
export const LOCATION = new Types.ObjectId()
export const SECTIONS = [
  { id: '9', title: 'Fire Protection', cope_dimensions: ['Protection'], min_observations: 1 },
]

/** Returns the engineer Alex Rowe and the admin Sana Patel, saved. */
export async function people() {
  const [engineer, admin, colleague] = await UserModel.create([
    { staffId: 'T-1', name: 'Alex Rowe', email: 'alex@example.com', role: 'risk_engineer' },
    { staffId: 'T-2', name: 'Sana Patel', email: 'sana@example.com', role: 'knowledge_admin' },
    { staffId: 'T-3', name: 'Jide Okafor', email: 'jide@example.com', role: 'risk_engineer' },
  ])
  return { engineer, admin, colleague }
}

/** Saves the assessment, assigned to `engineer`, surveyed 14 Nov 2026; returns it. */
export async function assessment(engineer: Types.ObjectId, extra: Record<string, unknown> = {}) {
  const site = await SiteModel.create({
    code: 'SITE-0003',
    name: 'Pasir Gudang Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Cold store',
  })
  return AssessmentModel.create({
    reference: REF,
    site: site._id,
    surveyType: 'First survey',
    siteVisitDate: new Date('2026-11-14'),
    reportDueDate: new Date('2026-12-18'),
    engineer,
    locations: [{ _id: LOCATION, name: 'Loading Bay 2', key: 'loading bay 2' }],
    ...extra,
  })
}

/** Starts capture on the assessment; returns the session. */
export const session = (assessment: Types.ObjectId) => CaptureSessionModel.create({ assessment })

/** Saves an observation; `failed` gives it a recording that couldn't be transcribed. */
export function observation(
  assessment: Types.ObjectId,
  sessionId: Types.ObjectId,
  { categories = ['Protection'] as CopeDimension[] | null, failed = false } = {},
) {
  return ObservationModel.create({
    assessment,
    session: sessionId,
    engineer: 'Alex Rowe',
    note: 'The sprinkler valve was shut.',
    recordings: failed
      ? [
          {
            name: 'Recording 1',
            key: 'k',
            contentType: 'audio/webm',
            size: 10,
            transcription: { status: 'failed', attempts: [{ startedAt: new Date() }] },
          },
        ]
      : [],
    severity: 'high',
    location: LOCATION,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Cold store',
      COPE_dimension: categories,
      effective_date: new Date(),
    },
  })
}

/** Saves a site walk ready to review, with two proposed observations. */
export function readyWalk(assessment: Types.ObjectId, engineerId: Types.ObjectId) {
  const proposed = (ref: string) => ({
    ref,
    note: 'Hose reel blocked',
    copeDimension: null,
    severity: null,
    locationRef: null,
    recordingSeq: null,
    start: null,
    end: null,
    photoIds: [],
    check: { severity: true, category: false, location: false },
  })
  return SiteWalkModel.create({
    assessment,
    engineerId,
    status: 'ready',
    name: 'Morning walk',
    proposal: { locations: [], observations: [proposed('o1'), proposed('o2')] },
    metadata: {
      source_type: 'site_walk',
      jurisdiction: 'SG',
      facility_type: 'Cold store',
      COPE_dimension: null,
      effective_date: new Date(),
    },
  })
}

/** Saves a checklist with one Fire Protection item; returns it. */
export function checklist(assessment: Types.ObjectId, createdBy: Types.ObjectId) {
  return ChecklistModel.create({
    assessment,
    facilityType: 'Cold store',
    jurisdiction: 'SG',
    standards: [],
    items: [
      {
        area: '9',
        subsection: null,
        origin: 'template',
        hazard: null,
        text: 'Check the sprinkler valves are open.',
        fields: [],
        COPE_dimension: ['Protection'],
        citations: [],
        flags: [],
        status: 'active',
        prefill: null,
        edited: null,
        removed: null,
        check: null,
        carried: [],
      },
    ],
    areas: [{ id: '9', title: 'Fire Protection' }],
    hazards: [],
    sources: {},
    provenance: {
      provider: 'test',
      model: null,
      effort: 'low',
      prompt_version: 'v',
      checklist_version: 'v',
      template_version: 'v',
      generated_at: new Date(),
    },
    createdBy,
    metadata: {
      source_type: 'checklist',
      jurisdiction: 'SG',
      facility_type: 'Cold store',
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
}

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// What the fake rag-service answers, by route; tests change these.
export const rag = {
  wording: (): Response => json({ programs: {}, usage: [] }),
  coverage: (): Response => json({ detail: 'The model failed.' }, 502),
  sections: (): Response => json({ sections: SECTIONS }),
  calls: [] as { path: string; body: unknown }[],
}

/** Stubs fetch as rag-service: template sections (any other path), wording and coverage. */
export function stubRag() {
  rag.calls = []
  rag.wording = () => json({ programs: {}, usage: [] })
  rag.coverage = () => json({ detail: 'The model failed.' }, 502)
  rag.sections = () => json({ sections: SECTIONS })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    rag.calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (path === '/assistant/wording') return rag.wording()
    if (path === '/assistant/coverage') return rag.coverage()
    return rag.sections()
  })
}

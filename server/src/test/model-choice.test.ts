// S-01 AC5/AC6: an admin's model choice for drafting, photo reading and handwriting applies on
// the very next call (no restart), and a missing key stops the call with a message. The AI
// services are a stubbed fetch, so no paid call is made.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { describeChatPhoto, interpret, transcribeHandwriting } from '../services/speech.service'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const REPLY = {
  statements: [{ text: 'Concrete tower.', citations: ['S:7'], supported: true }],
  guardrail: { passed: true, unsupported_count: 0 },
  provenance: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    prompt_version: 'gn07-v1',
    template_version: 'pre-v2.0',
    generated_at: '2026-10-10T00:00:00+00:00',
  },
}

const engineer = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, engineer)
const REFERENCE = 'RPT-2026-0907'

async function assessment(
  details: Record<string, unknown> = {},
  site: Record<string, unknown> = {},
) {
  const created = await SiteModel.create({
    code: 'SITE-0907',
    name: 'Marina Bay Office Tower',
    address: '10 Marina Boulevard, Singapore 018983',
    jurisdiction: 'SG',
    facilityType: 'Office',
    ...site,
  })
  return AssessmentModel.create({
    reference: REFERENCE,
    site: created._id,
    client: 'Acme Holdings',
    surveyType: 'Property risk survey',
    siteVisitDate: new Date('2026-09-28'),
    engineer: engineer._id,
    ...details,
  })
}

const metadata = {
  source_type: 'report_section' as const,
  jurisdiction: 'SG',
  facility_type: 'Office',
  COPE_dimension: 'all' as const,
  effective_date: new Date(),
}
const provenance = { ...REPLY.provenance, generated_at: new Date() }

function section(
  assessment: Types.ObjectId,
  sectionId: string,
  text = `Section ${sectionId} text.`,
) {
  return ReportSectionModel.create({
    assessment,
    sectionId,
    title: `Title ${sectionId}`,
    subsections: [
      {
        heading: 'Narrative',
        kind: 'narrative',
        statements: [{ text, citations: [], supported: true }],
      },
      { heading: 'Table', kind: 'table', statements: [] },
    ],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance,
    createdBy: engineer._id,
    metadata,
  })
}

function acceptedOfi(assessment: Types.ObjectId, title = 'Supervise control valves') {
  return ReportOfiModel.create({
    assessment,
    state: 'accepted',
    acceptedAt: new Date(),
    acceptedBy: engineer._id,
    title,
    category: 'Physical Protection',
    type: 'Fire Protection System',
    description: 'Lock valves open.',
    observation: 'A valve was shut.',
    likelihood: 'Likely',
    consequence: 'Major',
    effort: 'Minor Capital',
    priority: 'Priority 1',
    observations: [],
    standards: [],
    precedent: null,
    provenance: { ...provenance, config_version: 'c1' },
    createdBy: engineer._id,
    metadata: { ...metadata, source_type: 'ofi' },
  })
}

// Sections 4 and 5's figures (GN-03), all entered: every category 8 out of 10,
// and one value with each level's % and months.
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

// Every section the Executive Summary needs: an accepted OFI, Sections 4 and
// 5's figures, and drafts of 4-12.
async function completeReport(id: Types.ObjectId) {
  await acceptedOfi(id)
  await AssessmentModel.updateOne({ _id: id }, { $set: FIGURES })
  for (const n of ['4', '5', '6', '7', '8', '9', '10', '11', '12']) await section(id, n)
}

const admin = signedInAsRole(app, 'knowledge_admin', 'Sana')
const draftUrl = `/api/assessments/${REFERENCE}/summary/draft`

// Every call the stubbed services got: the path and the X-Model header.
const calls: { path: string; model: string | null }[] = []
const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'LLM_MODEL', 'VISION_MODEL']
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  calls.length = 0
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.ANTHROPIC_API_KEY = 'sk-ant-fake'
  process.env.GEMINI_API_KEY = 'AIza-fake'
  delete process.env.LLM_MODEL
  delete process.env.VISION_MODEL
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      path: new URL(url).pathname,
      model: new Headers(init.headers).get('x-model'),
    })
    const path = new URL(url).pathname
    const json = (b: object) => Response.json(b)
    if (path === '/summary/draft') return json(REPLY)
    if (path === '/sections') return json({ sections: [] })
    if (path === '/chat-photo/describe') return json({ description: 'A valve.', usage: [] })
    if (path === '/interpret') return json({ categories: [], description: 'A valve.' })
    return json({
      transcript: 'Note.',
      uncertain: [],
      provider: 'g',
      model: 'm',
      promptVersion: 'v',
    })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const seedReport = async () => {
  const a = await assessment()
  await completeReport(a._id)
}
const choose = (task: string, option: string) =>
  admin.put(`/api/settings/models/${task}`).send({ option })
const summaryCalls = () => calls.filter((c) => c.path === '/summary/draft')

describe('drafting uses the saved model on the next call (S-01 AC5)', () => {
  it('sends nothing until an admin saves a choice, then the new model right away', async () => {
    await seedReport()
    expect((await api.post(draftUrl)).status).toBe(201)
    // Nothing saved yet: the service keeps its own .env model.
    expect(summaryCalls()[0].model).toBeNull()

    expect((await choose('drafting', 'anthropic:claude-sonnet-5-5')).status).toBe(200)
    expect((await api.post(draftUrl)).status).toBe(201)
    expect(summaryCalls()[1].model).toBe('claude-sonnet-5-5')
  })
})

describe('a missing key stops the call (S-01 AC6)', () => {
  it('answers 503 with the reason and never calls the drafting service', async () => {
    await seedReport()
    delete process.env.ANTHROPIC_API_KEY

    const res = await api.post(draftUrl)

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/Report drafting.*unavailable.*API key is not set/)
    expect(summaryCalls()).toHaveLength(0)
  })
})

describe('photo reading and handwriting use the saved model (S-01 AC5, AC6)', () => {
  it('sends nothing until a choice is saved, then the photo and handwriting models', async () => {
    await describeChatPhoto('k.jpg')
    expect(calls.map((c) => c.model)).toEqual([null])
    calls.length = 0
    await choose('photo', 'gemini:gemini-3.8-flash')
    await choose('handwriting', 'gemini:gemini-3.8-flash')
    await describeChatPhoto('k.jpg')
    await interpret({
      photos: [],
      texts: [],
      location: null,
      parts: ['description'],
      privacy: { enabled: false } as never,
    })
    await transcribeHandwriting('k.jpg')
    expect(calls.map((c) => c.model)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
    ])
  })

  it('refuses without the key and never calls the service', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(describeChatPhoto('k.jpg')).rejects.toThrow(/Photo reading.*unavailable/)
    await expect(transcribeHandwriting('k.jpg')).rejects.toThrow(/Handwriting.*unavailable/)
    expect(calls).toHaveLength(0)
  })
})

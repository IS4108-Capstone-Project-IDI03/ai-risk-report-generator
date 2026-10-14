// Sections 1 and 2 (GN-07 AC1-AC4). S4 is a stubbed fetch, so no paid call is made.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

useMemoryMongo()

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
const url = `/api/assessments/${REFERENCE}/summary`

const summaries = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const REPLY = {
  statements: [
    { text: 'The tower is of concrete construction.', citations: ['S:7'], supported: true },
  ],
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

const TEMPLATE = ['7', '8', '9', '10', '11', '12'].map((id) => ({
  id,
  title: `Title ${id}`,
  cope_dimensions: ['Protection'],
  min_observations: 1,
}))

beforeEach(() => {
  summaries.mockImplementation(() => json(REPLY))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/summary/draft')
      ? summaries(JSON.parse(String(init!.body)))
      : // The template, for review decisions (RV-02), which check the section exists.
        url.endsWith('/sections')
        ? json({ sections: TEMPLATE })
        : json({}),
  )
})
afterEach(() => {
  summaries.mockReset()
  vi.unstubAllGlobals()
})

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

// Every section the Executive Summary needs: an accepted OFI and drafts of 4-12.
async function completeReport(id: Types.ObjectId) {
  await acceptedOfi(id)
  for (const n of ['4', '5', '6', '7', '8', '9', '10', '11', '12']) await section(id, n)
}

describe('Section 1 Purpose and Scope (GN-07 AC1)', () => {
  // Marsh's own Section 1, the same in every past report in the knowledge base
  // (mixed-use and mall reports, 11 Oct), with this assessment's details in it.
  it("is Marsh's Purpose and Scope with the client, site and inspected areas filled in", async () => {
    await assessment({
      locations: [
        { name: 'Fire pump room', floor: 'B1', key: 'fire pump room|b1' },
        { name: 'Level 5 server room', key: 'level 5 server room|' },
      ],
    })

    const response = await api.get(url)

    expect(response.status).toBe(200)
    expect(response.body.purposeAndScope).toEqual([
      'The purpose of this PRE report is to assist Acme Holdings with the implementation of a ' +
        'Risk Management Strategy to prioritize risk improvements and mitigation strategies for ' +
        'their property, Marina Bay Office Tower. It is made on request by Marsh Broking Office. ' +
        'The analysis carried out is based on data provided by a physical review of the ' +
        'location. The report will inform existing and/or prospective insurance markets of ' +
        'physical conditions at this location. This report is based upon conditions and ' +
        'practices observed and information made available to Marsh Risk Consulting at the ' +
        'time of our survey. The report should be used for risk management and insurance ' +
        'placement purposes only.',
      'The visit comprised an inspection of the main areas of the site, including the Fire ' +
        'pump room (B1) and the Level 5 server room.',
      'Our visits used National Fire Protection Association (NFPA), FM Global and local ' +
        'guidelines as technical references. Each site visit included the following activities:',
      [
        'Physical tours of occupied spaces to observe storage practices, related property ' +
          'hazards and identify areas not in accordance with the above guidelines.',
        'A review of existing loss prevention programs, procedures, reports and documentation ' +
          'to verify status in accordance with corporate standards and practices.',
        'Interview relevant staff to gain a perspective on loss prevention programs and ' +
          'implementation to understand issues facing local management.',
        'An exit meeting with management to achieve agreement with our conclusions and to ' +
          'develop a recommended action plan.',
      ],
      'This survey also included a review of administrative controls such as inspection, ' +
        'testing, and maintenance of fire protection systems and equipment; impairments to ' +
        'these systems; and fire emergency planning.',
    ])
  })

  it('names the buildings, then the places elsewhere on site (CP-16)', async () => {
    await assessment({
      locations: [
        { name: 'Guardhouse', key: 'guardhouse|' },
        { building: 'Block B', floor: 'Level 1', name: 'Lobby', key: 'lobby|level 1|block b' },
        { building: 'Block A', floor: 'B1', name: 'Pump room', key: 'pump room|b1|block a' },
        { building: 'block a', name: 'Facade', key: 'facade||block a' },
        { name: 'Fire access route', key: 'fire access route|' },
      ],
    })

    const paragraphs = (await api.get(url)).body.purposeAndScope as (string | string[])[]

    expect(paragraphs[1]).toBe(
      'The visit comprised an inspection of the main areas of the site, including Block A, ' +
        'Block B, the Guardhouse and the Fire access route.',
    )
  })

  it('names the usual areas when no location is recorded, and claims no tests', async () => {
    await assessment({ locations: [] })

    const paragraphs = (await api.get(url)).body.purposeAndScope as (string | string[])[]

    expect(paragraphs[1]).toBe(
      'The visit comprised an inspection of the main areas of the site, including the ' +
        'electrical rooms, fire pump room and common areas.',
    )
    // The app does not record whether tests were witnessed, so it says nothing of them.
    expect(JSON.stringify(paragraphs)).not.toMatch(/physical tests|undefined/)
  })
})

describe('Section 2 Executive Summary (GN-07 AC2-AC4)', () => {
  it('lists the sections still to complete, in report order, and does not draft', async () => {
    const a = await assessment()
    await section(a._id, '9')

    const read = await api.get(url)
    const draft = await api.post(`${url}/draft`)

    const missing = read.body.executiveSummary.missing.map((s: { id: string }) => s.id)
    expect(missing).toEqual(['3', '4', '5', '6', '7', '8', '10', '11', '12'])
    expect(read.body.executiveSummary.missing[0].title).toBe('Opportunities for Improvement')
    expect(draft.status).toBe(422)
    expect(draft.body.missing).toEqual(read.body.executiveSummary.missing)
    expect(summaries).not.toHaveBeenCalled()
  })

  it('is drafted from the text of every complete section and saved as Section 2', async () => {
    const a = await assessment()
    await completeReport(a._id)

    const response = await api.post(`${url}/draft`)

    expect(response.status).toBe(201)
    const sent = summaries.mock.calls[0][0] as { sections: { id: string; text: string }[] }
    expect(sent.sections.map((s) => s.id)).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ])
    expect(sent.sections[0].text).toBe('Priority 1 — Supervise control valves: Lock valves open.')
    // A table the draft never writes is left out of the text.
    expect(sent.sections[4].text).toBe('Narrative\nSection 7 text.')
    expect(response.body.subsections).toEqual([
      { heading: 'Executive Summary', kind: 'narrative', statements: REPLY.statements },
      { heading: 'Changes Since Previous Survey', kind: 'narrative', statements: [] },
      { heading: 'Planned Changes / Projects', kind: 'narrative', statements: [] },
    ])
    const saved = await ReportSectionModel.findOne({ assessment: a._id, sectionId: '2' }).lean()
    expect(saved?.summarised).toHaveLength(10)
    const read = (await api.get(url)).body.executiveSummary
    expect(read.draft.id).toBe(response.body.id)
    expect(read.missing).toEqual([])
    expect(read.staleSections).toEqual([])
  })

  it('records its paid call as Section 2 of the assessment (EV-03)', async () => {
    summaries.mockImplementation(() =>
      json({
        ...REPLY,
        usage: [
          {
            feature: 'draft-section',
            billed_service: 'anthropic',
            model: 'claude-sonnet-5-5',
            duration_ms: 9000,
            input_tokens: 4000,
            output_tokens: 600,
            cache_read_tokens: null,
            search_units: null,
            audio_seconds: null,
            usage_status: 'recorded',
          },
        ],
      }),
    )
    const a = await assessment()
    await completeReport(a._id)

    const response = await api.post(`${url}/draft`)

    expect(response.status).toBe(201)
    const rows = await AiCallModel.find().lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ reportId: a.reference, section: '2' })
  })

  it('is out of date once a section it summarised gets a newer draft or OFI', async () => {
    const a = await assessment()
    await completeReport(a._id)
    await api.post(`${url}/draft`)

    await section(a._id, '9', 'Redrafted.')
    await acceptedOfi(a._id, 'Fit fire-stopping')

    const stale = (await api.get(url)).body.executiveSummary.staleSections
    expect(stale).toEqual([
      { id: '3', title: 'Opportunities for Improvement' },
      { id: '9', title: 'Fire Protection' },
    ])
  })

  // RV-02: a section's content is its saved draft with the engineer's decisions.
  it('summarises the saved draft, not a replacement still waiting to be accepted', async () => {
    const a = await assessment()
    await completeReport(a._id)
    await api.post(`${url}/draft`)
    const saved = await ReportSectionModel.findOne({ assessment: a._id, sectionId: '9' }).lean()

    // A replacement draft is the section's content only once the engineer accepts it.
    await section(a._id, '9', 'A replacement not yet accepted.').then((r) =>
      ReportSectionModel.updateOne({ _id: r._id }, { replacementFor: saved!._id }),
    )

    expect((await api.get(url)).body.executiveSummary.staleSections).toEqual([])
    await api.post(`${url}/draft`)
    const sent = summaries.mock.calls[1][0] as { sections: { id: string; text: string }[] }
    expect(sent.sections.find((s) => s.id === '9')!.text).toBe('Narrative\nSection 9 text.')
  })

  it("sends the engineer's edits, leaves out rejected findings, and goes out of date on either", async () => {
    const a = await assessment()
    await completeReport(a._id)
    const nine = await ReportSectionModel.findOne({ assessment: a._id, sectionId: '9' }).lean()
    const eight = await ReportSectionModel.findOne({ assessment: a._id, sectionId: '8' }).lean()
    await api.post(`${url}/draft`)
    const decide = `/api/assessments/${REFERENCE}/sections`

    expect(
      (
        await api
          .put(`${decide}/9/findings/0.0`)
          .send({ draftId: String(nine!._id), text: 'Sprinklers cover the whole tower.' })
      ).status,
    ).toBe(200)
    expect(
      (await api.post(`${decide}/8/findings/0.0/reject`).send({ draftId: String(eight!._id) }))
        .status,
    ).toBe(200)

    // AC4: a decision changes what the section says, so the summary is out of date.
    const stale = (await api.get(url)).body.executiveSummary.staleSections
    expect(stale.map((s: { id: string }) => s.id)).toEqual(['8', '9'])
    await api.post(`${url}/draft`)
    const sent = summaries.mock.calls[1][0] as { sections: { id: string; text: string }[] }
    expect(sent.sections.find((s) => s.id === '9')!.text).toBe(
      'Narrative\nSprinklers cover the whole tower.',
    )
    expect(sent.sections.find((s) => s.id === '8')!.text).toBe('')
    expect((await api.get(url)).body.executiveSummary.staleSections).toEqual([])
  })

  it('can be drafted only by the assigned engineer', async () => {
    const a = await assessment()
    await completeReport(a._id)
    const other = signedInAs(app, { ...engineer, _id: new Types.ObjectId(), staffId: 'TEST-2' })

    expect((await other.post(`${url}/draft`)).status).toBe(403)
    expect(summaries).not.toHaveBeenCalled()
  })
})

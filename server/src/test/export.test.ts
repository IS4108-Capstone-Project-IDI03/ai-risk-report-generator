// Exporting the finished report (EX-01): who may, what keeps an unfinished
// report from going, the file's name, and the placeholder check. Chromium stands in here (export-render.test.ts
// prints real pages); the Word file is built for real.
import JSZip from 'jszip'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import type { ExportModel } from '../services/export-model'
import { exportDay, exportFileName, findPlaceholder } from '../services/export.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

const render = vi.hoisted(() => ({
  texts: [] as { part: string; text: string }[],
  model: null as unknown,
  failure: null as Error | null,
}))
vi.mock('../services/export-render.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/export-render.service')>()
  return {
    ...actual,
    withExportPage: vi.fn(async (_html: string, work: (page: unknown) => Promise<unknown>) => {
      if (render.failure) throw render.failure
      return await work({})
    }),
    textsOf: vi.fn(async () => render.texts),
    printPdf: vi.fn(async () => Buffer.from('%PDF-1.4 the pages')),
    readReport: vi.fn(async () => ({ model: render.model, pictures: [] })),
  }
})

useMemoryMongo()

const person = (name: string, staffId: string) => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId}@example.com`,
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const engineer = person('Alex Rowe', 'TEST-1')
const api = signedInAs(app, engineer)
const colleague = signedInAs(app, person('Jide Okafor', 'TEST-2'))
const REFERENCE = 'RPT-2026-0411'
const url = `/api/assessments/${REFERENCE}/export`
const PAGES =
  '<!doctype html><html><head></head><body><section data-export-page="body"></section></body></html>'

const SECTIONS = [
  { id: '7', title: 'Construction', cope_dimensions: ['Construction'], min_observations: 1 },
]
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  render.texts = [{ part: 'Section 7. Construction', text: 'The roof is steel deck.' }]
  render.model = null
  render.failure = null
  vi.stubGlobal('fetch', async () =>
    json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS }),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function assessment() {
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    address: '1 Tilbury Road',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const created = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    siteVisitDate: new Date('2026-04-11'),
    engineer: engineer._id,
  })
  await CaptureSessionModel.create({ assessment: created._id })
  return created
}

type Statement = IReportSection['subsections'][number]['statements'][number]
const ROOF: Statement = { text: 'The roof is steel deck.', citations: [], supported: true }
const WALLS: Statement = { text: 'The walls are fire-rated.', citations: [], supported: false }

// A saved draft of a section; by default Section 7 with a supported and an
// unsupported finding.
async function draft(
  assessmentId: Types.ObjectId,
  {
    sectionId = '7',
    title = 'Construction',
    heading = 'Construction Narrative',
    statements = [ROOF, WALLS],
    summarised,
  }: {
    sectionId?: string
    title?: string
    heading?: string
    statements?: Statement[]
    summarised?: { sectionId: string; version: string }[]
  } = {},
) {
  const subsections: IReportSection['subsections'] = [{ heading, kind: 'narrative', statements }]
  return ReportSectionModel.create({
    assessment: assessmentId,
    sectionId,
    title,
    subsections,
    ...(summarised && { summarised }),
    sources: {},
    evidence: [],
    questions: [],
    guardrail: { passed: false, unsupported_count: 1 },
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v2.3',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: new Date(),
    },
    createdBy: engineer._id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Construction',
      effective_date: new Date(),
    },
  })
}

// An accepted Opportunity for Improvement (GN-05), for Section 3.
async function acceptedOfi(assessmentId: Types.ObjectId) {
  return ReportOfiModel.create({
    assessment: assessmentId,
    state: 'accepted',
    acceptedAt: new Date(),
    acceptedBy: engineer._id,
    title: 'Lock Sprinkler Control Valves Open',
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
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn05-v1',
      config_version: 'c1',
      generated_at: new Date(),
    },
    createdBy: engineer._id,
    metadata: {
      source_type: 'ofi',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
}

// A report the export lets go (AC1): Section 7 (the template's one section
// here) drafted with its finding accepted, an accepted OFI, and an Executive
// Summary drafted from the sections as they stand.
async function completeReport() {
  const a = await assessment()
  const seven = await draft(a._id, { statements: [ROOF] })
  const decided = await api
    .post(`/api/assessments/${REFERENCE}/sections/7/findings/0.0/accept`)
    .send({ draftId: String(seven._id) })
  expect(decided.status).toBe(200)
  await acceptedOfi(a._id)
  await draft(a._id, {
    sectionId: '2',
    title: 'Executive Summary',
    heading: 'Executive Summary',
    statements: [{ text: 'The site is well protected.', citations: ['S:7'], supported: true }],
    summarised: [],
  })
  return a
}

// The file in the answer, as bytes.
const fileOf = (request: ReturnType<typeof api.post>) =>
  request.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => done(null, Buffer.concat(chunks)))
  })

const exportBody = (format: 'pdf' | 'docx' = 'pdf') => ({
  format,
  citations: true,
  photos: true,
  html: PAGES,
})

describe('the export check: only a complete report goes (AC1)', () => {
  const NOT_SUMMARISED = {
    sectionId: '2',
    title: '2. Executive Summary',
    where: 'generation',
    reason: 'It is not drafted yet. Draft it on Generation once Sections 3 to 12 are complete.',
  }
  const NO_OFIS = {
    sectionId: '3',
    title: '3. Opportunities for Improvement',
    where: 'generation',
    reason:
      'No Opportunity for Improvement is accepted yet. Draft them on Generation, then accept at least one in the review workspace.',
  }

  it('lists what is left to finish, section by section, until the report is complete', async () => {
    const a = await assessment()
    const seven = String((await draft(a._id))._id)
    const before = await api.get(url)
    expect(before.status).toBe(200)
    expect(before.body.blockers).toEqual([
      NOT_SUMMARISED,
      NO_OFIS,
      {
        sectionId: '7',
        title: '7. Construction',
        where: 'review',
        reason: '2 findings are waiting for your decision.',
      },
      {
        sectionId: '7',
        title: '7. Construction',
        where: 'review',
        reason: '1 finding is unsupported by evidence.',
      },
    ])

    // Reviewed: Section 7 is done, Sections 2 and 3 are still to write.
    const decide = (finding: string, action: string) =>
      api
        .post(`/api/assessments/${REFERENCE}/sections/7/findings/${finding}/${action}`)
        .send({ draftId: seven })
    expect((await decide('0.0', 'accept')).status).toBe(200)
    expect((await decide('0.1', 'reject')).status).toBe(200)
    expect((await api.get(url)).body.blockers).toEqual([NOT_SUMMARISED, NO_OFIS])

    // Written: an accepted OFI and the Executive Summary.
    await acceptedOfi(a._id)
    await draft(a._id, {
      sectionId: '2',
      title: 'Executive Summary',
      heading: 'Executive Summary',
      statements: [{ text: 'The site is well protected.', citations: ['S:7'], supported: true }],
      summarised: [],
    })
    expect((await api.get(url)).body.blockers).toEqual([])
  })

  it('lists a section that is not written yet', async () => {
    await assessment()
    expect((await api.get(url)).body.blockers).toContainEqual({
      sectionId: '7',
      title: '7. Construction',
      where: 'generation',
      reason: 'It is not written yet. Draft it on Generation, or write it in the document editor.',
    })
  })

  it('refuses to export an unfinished report, naming what is left (409)', async () => {
    const a = await assessment()
    await draft(a._id)
    const response = await api.post(url).send(exportBody())
    expect(response.status).toBe(409)
    expect(response.body.blockers).toHaveLength(4)
  })
})

describe('the export (EX-01)', () => {
  it('answers with the PDF, named with the report reference and the export date (AC1)', async () => {
    await completeReport()
    const response = await fileOf(api.post(url).send(exportBody()))
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    const name = `${REFERENCE} ${exportDay(new Date())}.pdf`
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
    expect(response.headers['cache-control']).toBe('no-store')
    expect((response.body as Buffer).toString()).toBe('%PDF-1.4 the pages')
  })

  it('answers with a Word file built from the pages (AC5)', async () => {
    await completeReport()
    const model: ExportModel = {
      blocks: [
        {
          kind: 'section',
          anchor: 'x-s-7',
          kicker: 'Section 7',
          number: '7.',
          title: 'Construction',
        },
        { kind: 'paragraph', paragraph: { runs: [{ text: 'The roof is steel deck.' }] } },
      ],
      images: [],
      contents: [{ level: 1, number: '7.', title: 'Construction', page: 1, anchor: 'x-s-7' }],
    }
    render.model = model
    const response = await fileOf(api.post(url).send(exportBody('docx')))
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(response.headers['content-disposition']).toContain(`${REFERENCE} `)
    expect(response.headers['content-disposition']).toContain('.docx')
    const zip = await JSZip.loadAsync(response.body as Buffer)
    const document = await zip.file('word/document.xml')!.async('string')
    expect(document).toContain('The roof is steel deck.')
    // The details page comes from the assessment's own records.
    expect(document).toContain('Northgate Logistics')
    expect(document).toContain('11 April 2026')
  })

  it('is offered only to the assigned engineer (AC2)', async () => {
    await assessment()
    const response = await colleague.post(url).send(exportBody())
    expect(response.status).toBe(403)
    expect(response.body.error).toBe('Only the assigned engineer can export this report.')
  })

  it('refuses a body that is not an export (400), and an unknown report (404)', async () => {
    await assessment()
    expect((await api.post(url).send({ format: 'rtf', html: PAGES })).status).toBe(400)
    expect((await api.post(url).send({ ...exportBody(), html: '' })).status).toBe(400)
    expect(
      (await api.post('/api/assessments/RPT-2026-9999/export').send(exportBody())).status,
    ).toBe(404)
  })

  it('makes no file while a masking placeholder is left in the report (AC9, 422)', async () => {
    await completeReport()
    render.texts = [{ part: 'Section 7. Construction', text: 'Met with [PERSON_2] on site.' }]
    const response = await api.post(url).send(exportBody())
    expect(response.status).toBe(422)
    expect(response.body.error).toContain('Section 7. Construction still shows [PERSON_2]')
  })

  it('says why when the file cannot be made, to try again (AC11, 503)', async () => {
    await completeReport()
    const { RendererUnavailableError } = await import('../services/export-render.service')
    render.failure = new RendererUnavailableError()
    const response = await api.post(url).send(exportBody())
    expect(response.status).toBe(503)
    expect(response.body.error).toContain('Chromium')
  })
})

describe('the export rules', () => {
  it('finds the placeholders privacy-service writes, in any case or bracketing (AC9)', () => {
    expect(findPlaceholder('Met [PERSON_1] there.')).toBe('[PERSON_1]')
    expect(findPlaceholder('client_2 owns it')).toBe('client_2')
    expect(findPlaceholder('Call [PHONE 3].')).toBe('[PHONE 3]')
    expect(findPlaceholder('Level 1 and Person 1 and Section 7.')).toBeNull()
    expect(findPlaceholder('A 2-storey building.')).toBeNull()
  })

  it("names the file by the team's day, not the server's (AC1)", () => {
    // 1 am on 5 November in Singapore is still 4 November in UTC.
    const at = new Date('2026-11-04T17:00:00Z')
    expect(exportFileName('RPT-2026-0411', 'pdf', at)).toBe('RPT-2026-0411 2026-11-05.pdf')
    expect(exportFileName('RPT/2026 "x"', 'docx', at)).toBe('RPT-2026-x- 2026-11-05.docx')
  })
})

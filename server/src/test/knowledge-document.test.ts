import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { IngestionJobModel } from '../models/ingestion-job.model'
import {
  KnowledgeDocumentNotFoundError,
  KnowledgeDocumentWrongStateError,
  retryIngestion,
} from '../services/knowledge-document.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

// S3 stands in as a map, the queue as a spy, and the ingestion service's PDF
// check and /label as one stubbed fetch, routed by URL.
const s3 = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => void s3.set(key, body),
  getObjectStream: async (key: string) => {
    const body = s3.get(key) as Buffer & { failMidStream?: boolean }
    if (!body.failMidStream) return Readable.from([body])
    return new Readable({
      read() {
        this.push(Buffer.from('%PDF-partial'))
        this.destroy(new Error('S3 connection reset'))
      },
    })
  },
  deleteObject: async (key: string) => void s3.delete(key),
}))
const queued = vi.hoisted(() => vi.fn<(documentId: string) => Promise<void>>())
const requeued = vi.hoisted(() => vi.fn<(documentId: string) => Promise<void>>())
vi.mock('../services/ingestion-queue.service', () => ({
  enqueueIngestion: queued,
  requeueIngestion: requeued,
}))
const inspect = vi.fn<(url?: string, init?: RequestInit) => Promise<Response>>()
const labelling = vi.fn<() => Promise<Response>>()

useMemoryMongo()

// A knowledge admin is allowed everything below (F-05); role limits are in permissions.test.ts.
const api = signedInAsRole(app, 'knowledge_admin')

// 20:00 UTC on 6 Oct is 04:00 on 7 Oct in Singapore: the upload date a
// document gets when /label finds no effective date (IN-05).
const UPLOAD_DAY = '2026-10-07'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T20:00:00Z'))
  queued.mockResolvedValue(undefined)
  requeued.mockResolvedValue(undefined)
  inspect.mockResolvedValue(Response.json({ pages: 3 }))
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    String(url).endsWith('/label') ? labelling() : inspect(url, init),
  )
})
afterEach(() => {
  s3.clear()
  queued.mockReset()
  requeued.mockReset()
  inspect.mockReset()
  labelling.mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const PDF = Buffer.from('%PDF-1.7\nfake but well-formed enough\n%%EOF')
const DETAILS = {
  fileName: 'NFPA 13 – 2022.pdf',
  title: 'NFPA 13: Standard for the Installation of Sprinkler Systems',
  edition: '2022',
  effectiveDate: '2022-01-01',
  sourceType: 'nfpa_standard',
  jurisdiction: 'SG',
  // A standard's /label answer defaults to all facility types.
  facilityType: 'all',
}
// An edition can be published ahead of the year it is named for.
const NEXT_YEAR = new Date().getFullYear() + 1
const REPORT = {
  fileName: 'Cold store survey.pdf',
  title: 'Cold store risk survey',
  effectiveDate: '2024-03-12',
  sourceType: 'marsh_report',
  jurisdiction: 'MY',
  facilityType: 'Cold store',
}

// What the ingestion service's /label would answer for these details
// (camelCase, as above): every detail given is confident, the rest are null.
function labelAnswer(details: Record<string, string>) {
  const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  const names = ['sourceType', 'title', 'edition', 'effectiveDate', 'jurisdiction', 'facilityType']
  return {
    details: Object.fromEntries(
      names.map((name) => [
        snake(name),
        {
          value: details[name] ?? null,
          confidence: details[name] ? 0.95 : 0,
          evidence: details[name] ? { page: 1, quote: details[name] } : null,
          model: 'test-model',
        },
      ]),
    ),
  }
}

// Uploads with only the file name; /label answers with `details`.
function upload(body = PDF, details: Record<string, string> = DETAILS, type = 'application/pdf') {
  labelling.mockResolvedValue(Response.json(labelAnswer(details)))
  return api
    .post('/api/knowledge-documents')
    .query({ fileName: details.fileName ?? 'file.pdf' })
    .set('Content-Type', type)
    .send(body)
}

describe('POST /api/knowledge-documents', () => {
  it("saves a standard's details, with the issuing body set from its source type", async () => {
    const response = await upload()

    expect(response.status).toBe(201)
    const list = await api.get('/api/knowledge-documents')
    expect(list.body).toEqual([
      expect.objectContaining({
        id: response.body.id,
        title: 'NFPA 13: Standard for the Installation of Sprinkler Systems',
        issuingBody: 'NFPA',
        edition: '2022',
        jurisdiction: 'SG',
        facilityType: 'all',
        fileName: 'NFPA 13 – 2022.pdf',
      }),
    ])
  })

  it('saves a standard that applies in all countries', async () => {
    const response = await upload(PDF, {
      ...DETAILS,
      sourceType: 'fm_standard',
      jurisdiction: 'all',
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ issuingBody: 'FM Global', jurisdiction: 'all' })
  })

  it("saves a Marsh report's details, with no edition", async () => {
    const response = await upload(PDF, REPORT)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      title: 'Cold store risk survey',
      issuingBody: 'Marsh',
      edition: null,
      effectiveDate: '2024-03-12',
      jurisdiction: 'MY',
      facilityType: 'Cold store',
    })
  })

  it('stores the unaltered original under the document ID and queues one ingestion job', async () => {
    const response = await upload()

    expect(s3.get(`knowledge/${response.body.id}.pdf`)).toEqual(PDF)
    expect(queued).toHaveBeenCalledExactlyOnceWith(response.body.id)
    expect(response.body.status).toBe('queued')
  })

  // Nothing is stored or queued for a rejected file.
  async function expectNothingKept() {
    expect(s3.size).toBe(0)
    expect(queued).not.toHaveBeenCalled()
    expect((await api.get('/api/knowledge-documents')).body).toEqual([])
  }

  it.each([
    [
      'a Word file',
      Buffer.from('PK\x03\x04 docx bytes'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['a file named .pdf that is not a PDF', Buffer.from('just some text'), 'application/pdf'],
  ])('rejects %s with a reason', async (_name, body, type) => {
    const response = await upload(body, DETAILS, type)

    expect(response.status).toBe(415)
    expect(response.body.error).toBe('Only PDF files can be uploaded.')
    await expectNothingKept()
  })

  it('rejects an empty file as not a PDF', async () => {
    const response = await api
      .post('/api/knowledge-documents')
      .query({ fileName: DETAILS.fileName })
      .set('Content-Type', 'application/pdf')

    expect(response.status).toBe(415)
    await expectNothingKept()
  })

  it('rejects a PDF that cannot be opened with the reason the ingestion service gives', async () => {
    inspect.mockResolvedValue(
      Response.json({ detail: 'The PDF is password-protected.' }, { status: 422 }),
    )

    const response = await upload()

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('The PDF is password-protected.')
    await expectNothingKept()
  })

  it('asks for nothing but the file name', async () => {
    const response = await api
      .post('/api/knowledge-documents')
      .query({ fileName: ' ' })
      .set('Content-Type', 'application/pdf')
      .send(PDF)

    expect(response.status).toBe(400)
    expect(response.body.fields).toEqual({ fileName: 'File name is required.' })
    await expectNothingKept()
  })

  it('reads the details with /label, and stores them with the evidence, Unconfirmed nulls and the upload date', async () => {
    const response = await upload(PDF, { fileName: 'scan.pdf', sourceType: 'fm_standard' })

    expect(response.status).toBe(201)
    expect(labelling).toHaveBeenCalledOnce()
    expect(response.body).toMatchObject({
      sourceType: 'fm_standard',
      issuingBody: 'FM Global',
      title: 'scan.pdf',
      edition: null,
      effectiveDate: UPLOAD_DAY,
      jurisdiction: null,
      facilityType: null,
      unconfirmed: ['title', 'edition', 'jurisdiction', 'facilityType'],
    })
    const saved = await KnowledgeDocumentModel.findById(response.body.id).lean()
    expect(saved?.metadata).toMatchObject({
      source_type: 'fm_standard',
      effective_date: new Date(UPLOAD_DAY),
    })
    expect(saved?.unconfirmed).toEqual(['title', 'edition', 'jurisdiction', 'facility_type'])
    expect(saved?.labelling?.details.source_type).toEqual({
      value: 'fm_standard',
      confidence: 0.95,
      evidence: { page: 1, quote: 'fm_standard' },
      model: 'test-model',
      source: 'auto',
    })
  })

  it('maps a fully labelled Marsh report with no Unconfirmed details and no edition', async () => {
    const response = await upload(PDF, REPORT)

    expect(response.body).toMatchObject({ edition: null, unconfirmed: [] })
  })

  it.each([
    ['a report for all facility types', { ...REPORT, facilityType: 'all' }, 'facilityType'],
    ['a report for all countries', { ...REPORT, jurisdiction: 'all' }, 'jurisdiction'],
    ['a facility type not on the list', { ...REPORT, facilityType: 'Spaceport' }, 'facilityType'],
    ['a country that is not a code', { ...DETAILS, jurisdiction: 'Singapore' }, 'jurisdiction'],
    ['an edition that is not a year', { ...DETAILS, edition: '2022 Edition' }, 'edition'],
    ['an edition after next year', { ...DETAILS, edition: String(NEXT_YEAR + 1) }, 'edition'],
    ['an edition before 1900', { ...DETAILS, edition: '1899' }, 'edition'],
    ['a source type not on the list', { ...DETAILS, sourceType: 'ISO' }, 'sourceType'],
  ])('stores %s as Unconfirmed instead of trusting the model', async (_name, details, field) => {
    const response = await upload(PDF, details)

    expect(response.status).toBe(201)
    expect(response.body[field]).toBeNull()
    expect(response.body.unconfirmed).toContain(field)
  })

  it('stores the upload date instead of a date that is not a date', async () => {
    const response = await upload(PDF, { ...DETAILS, effectiveDate: 'last spring' })

    expect(response.body.effectiveDate).toBe(UPLOAD_DAY)
    expect(response.body.unconfirmed).not.toContain('effectiveDate')
  })

  it.each([
    ['cannot be reached', () => labelling.mockRejectedValue(new TypeError('fetch failed'))],
    ['times out', () => labelling.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))],
    [
      'answers with an error',
      () => labelling.mockResolvedValue(Response.json({ detail: 'boom' }, { status: 500 })),
    ],
    ['answers with bad JSON', () => labelling.mockResolvedValue(new Response('not json'))],
  ])(
    'still uploads, with every detail but the date Unconfirmed, when /label %s',
    async (_name, fail) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const upload = api
        .post('/api/knowledge-documents')
        .query({ fileName: 'Scan.pdf' })
        .set('Content-Type', 'application/pdf')
      fail()

      const response = await upload.send(PDF)

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        title: 'Scan.pdf',
        issuingBody: null,
        sourceType: null,
        effectiveDate: UPLOAD_DAY,
        unconfirmed: ['sourceType', 'title', 'edition', 'jurisdiction', 'facilityType'],
      })
      expect(queued).toHaveBeenCalledOnce()
    },
  )

  it('never calls /label for a file that is rejected', async () => {
    await upload(Buffer.from('just some text'))
    inspect.mockResolvedValue(Response.json({ detail: 'Password.' }, { status: 422 }))
    await upload()

    expect(labelling).not.toHaveBeenCalled()
  })

  it('rejects a file larger than 100 MB with a reason', async () => {
    const response = await upload(Buffer.alloc(100 * 1024 * 1024 + 1))

    expect(response.status).toBe(413)
    expect(response.body.error).toBe('The file is larger than 100 MB.')
    await expectNothingKept()
  })

  it('answers 503 and keeps nothing when the ingestion service cannot be reached', async () => {
    inspect.mockRejectedValue(new TypeError('fetch failed'))

    const response = await upload()

    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/could not check the file/)
    await expectNothingKept()
  })

  it('answers 503 and removes the stored file when the queue cannot be reached', async () => {
    queued.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'))

    const response = await upload()

    expect(response.status).toBe(503)
    expect(response.body.error).toBe('Ingestion could not be queued. Try uploading again shortly.')
    expect(s3.size).toBe(0)
    expect((await api.get('/api/knowledge-documents')).body).toEqual([])
  })
})

describe('GET /api/knowledge-documents', () => {
  it('lists recent uploads: in progress, complete for 24 hours, failed for 7 days', async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000)
    // The ingestion worker writes status and finishedAt; set them as it would.
    const cases = [
      ['queued', { status: 'queued' }],
      ['processing', { status: 'processing' }],
      ['complete 23 h ago', { status: 'complete', finishedAt: hoursAgo(23) }],
      ['complete 25 h ago', { status: 'complete', finishedAt: hoursAgo(25) }],
      ['failed 6 days ago', { status: 'failed', finishedAt: hoursAgo(6 * 24) }],
      ['failed 8 days ago', { status: 'failed', finishedAt: hoursAgo(8 * 24) }],
    ] as const
    for (const [title, state] of cases) {
      const { body } = await upload(PDF, { ...DETAILS, title })
      await KnowledgeDocumentModel.updateOne({ _id: body.id }, state)
    }

    const { body } = await api.get('/api/knowledge-documents')

    expect(body.map((d: { title: string }) => d.title).sort()).toEqual([
      'complete 23 h ago',
      'failed 6 days ago',
      'processing',
      'queued',
    ])
  })

  // Seeds an ingestion_jobs row for a document, as the worker's reporter would.
  async function seedJob(documentId: string, overrides: Record<string, unknown> = {}) {
    await IngestionJobModel.create({
      documentId,
      currentStage: 'chunking',
      pageCurrent: 12,
      pageTotal: 45,
      stageLog: [{ stage: 'parsing', startedAt: new Date(Date.now() - 5000), durationMs: 2000 }],
      currentStageStartedAt: new Date(Date.now() - 1000),
      startedAt: new Date(Date.now() - 5000),
      updatedAt: new Date(),
      ...overrides,
    })
  }

  // Finds one listed document by title.
  type Listed = { title: string; progress?: Record<string, unknown> }
  const find = (body: Listed[], title: string): Listed =>
    body.find((d) => d.title === title) as Listed

  it('includes progress for a processing document with a seeded ingestion job', async () => {
    const { body: doc } = await upload(PDF, { ...DETAILS, title: 'With progress' })
    await KnowledgeDocumentModel.updateOne({ _id: doc.id }, { status: 'processing' })
    await seedJob(doc.id)

    const { body } = await api.get('/api/knowledge-documents')
    const progress = find(body, 'With progress').progress as {
      currentStage: string
      pageCurrent: number
      pageTotal: number
      elapsedMs: number
      currentStageElapsedMs: number
      stageLog: { stage: string; startedAt: string; durationMs: number }[]
    }

    expect(progress).toMatchObject({
      currentStage: 'chunking',
      pageCurrent: 12,
      pageTotal: 45,
    })
    expect(progress.elapsedMs).toBeGreaterThan(0)
    expect(progress.currentStageElapsedMs).toBeGreaterThan(0)
    expect(progress.stageLog[0]).toMatchObject({ stage: 'parsing', durationMs: 2000 })
    // stageLog dates are serialised as ISO strings.
    expect(typeof progress.stageLog[0].startedAt).toBe('string')
  })

  it('gives a queued document no progress field', async () => {
    const { body: doc } = await upload(PDF, { ...DETAILS, title: 'Queued doc' })
    // Left as 'queued'; a job could exist, but progress is only read for processing.
    await seedJob(doc.id)

    const { body } = await api.get('/api/knowledge-documents')
    expect(find(body, 'Queued doc').progress).toBeUndefined()
  })

  it('gives a complete document no progress field', async () => {
    const { body: doc } = await upload(PDF, { ...DETAILS, title: 'Complete doc' })
    await KnowledgeDocumentModel.updateOne(
      { _id: doc.id },
      { status: 'complete', finishedAt: new Date() },
    )
    await seedJob(doc.id, { currentStage: 'complete' })

    const { body } = await api.get('/api/knowledge-documents')
    expect(find(body, 'Complete doc').progress).toBeUndefined()
  })

  it('gives a processing document with no matching job no progress field', async () => {
    const { body: doc } = await upload(PDF, { ...DETAILS, title: 'No job yet' })
    await KnowledgeDocumentModel.updateOne({ _id: doc.id }, { status: 'processing' })
    // No seedJob: the worker has not written its first stage yet.

    const { body } = await api.get('/api/knowledge-documents')
    expect(find(body, 'No job yet').progress).toBeUndefined()
  })
})

// Uploads a document and marks it as the ingestion worker would.
async function stored(details: Record<string, string>, state: object = { status: 'complete' }) {
  const { body } = await upload(PDF, details)
  await KnowledgeDocumentModel.updateOne({ _id: body.id }, { finishedAt: new Date(), ...state })
  return body.id as string
}

describe('GET /api/knowledge-documents/ingested', () => {
  it('lists every active document, however old, by title, and nothing still ingesting or failed', async () => {
    const longAgo = new Date('2025-01-01')
    await stored({ ...DETAILS, title: 'Zinc storage' })
    await stored(
      { ...REPORT, title: 'Apple cold store' },
      { status: 'complete', finishedAt: longAgo },
    )
    await stored({ ...DETAILS, title: 'Still queued' }, { status: 'queued' })
    await stored({ ...DETAILS, title: 'Mid processing' }, { status: 'processing' })
    await stored({ ...DETAILS, title: 'Broken' }, { status: 'failed' })

    const { body } = await api.get('/api/knowledge-documents/ingested')

    expect(body.map((d: { title: string }) => d.title)).toEqual([
      'Apple cold store',
      'Zinc storage',
    ])
  })

  it('gives an uncorrected document an empty history', async () => {
    await stored(DETAILS)

    const [document] = (await api.get('/api/knowledge-documents/ingested')).body

    expect(document.history).toEqual([])
  })
})

describe('PUT /api/knowledge-documents/:id', () => {
  // REPORT's details without the file name (a correction can't rename the PDF).
  const CORRECTED = {
    title: REPORT.title,
    effectiveDate: REPORT.effectiveDate,
    sourceType: REPORT.sourceType,
    jurisdiction: 'SG',
    facilityType: 'Data centre',
  }
  const correct = (id: string, details: Record<string, string> = CORRECTED) =>
    api.put(`/api/knowledge-documents/${id}`).send(details)

  it('saves the corrected details and puts the new labels on its passages', async () => {
    const id = await stored(REPORT)
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))

    const response = await correct(id)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id, jurisdiction: 'SG', facilityType: 'Data centre' })
    const [url, init] = inspect.mock.lastCall as unknown as [string, RequestInit]
    expect(url).toBe(`${process.env.INGESTION_SERVICE_URL}/documents/${id}/labels`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      source_type: 'marsh_report',
      jurisdiction: 'SG',
      facility_type: 'Data centre',
      effective_date: '2024-03-12',
      status: 'active',
    })
    const [listed] = (await api.get('/api/knowledge-documents/ingested')).body
    expect(listed).toMatchObject({ jurisdiction: 'SG', facilityType: 'Data centre' })
  })

  // IN-05: a document uploaded with some details Unconfirmed, then completed.
  const needsReview = async () => {
    const id = await stored({ fileName: 'scan.pdf', sourceType: 'marsh_report', title: 'Survey' })
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    return id
  }
  const sentBody = () =>
    JSON.parse(String((inspect.mock.lastCall as [string, RequestInit])[1].body))

  it('completes a needs-review document: no Unconfirmed left, details marked admin, passages active', async () => {
    const id = await needsReview()

    const response = await correct(id)

    expect(response.body.unconfirmed).toEqual([])
    const saved = await KnowledgeDocumentModel.findById(id).lean()
    expect(saved?.unconfirmed).toEqual([])
    expect(saved?.labelling?.details.facility_type).toMatchObject({
      value: 'Data centre',
      source: 'admin',
      model: 'test-model',
    })
    expect(Object.values(saved?.labelling?.details ?? {}).map((d) => d.source)).toEqual(
      Array(6).fill('admin'),
    )
    expect(sentBody().status).toBe('active')
    expect(sentBody()).not.toHaveProperty('COPE_dimension')
  })

  it('brings back the Unconfirmed list and labelling when search could not be updated', async () => {
    const id = await needsReview()
    inspect.mockRejectedValue(new TypeError('fetch failed'))

    expect((await correct(id)).status).toBe(503)

    const saved = await KnowledgeDocumentModel.findById(id).lean()
    expect(saved?.unconfirmed).toEqual(['jurisdiction', 'facility_type'])
    expect(saved?.labelling?.details.facility_type?.source).toBe('auto')
  })

  it('corrects the source type, which changes the issuing body and edition', async () => {
    const id = await stored(DETAILS)

    const response = await correct(id, CORRECTED)

    expect(response.body).toMatchObject({
      sourceType: 'marsh_report',
      issuingBody: 'Marsh',
      edition: null,
      title: 'Cold store risk survey',
      effectiveDate: '2024-03-12',
    })
  })

  // The document as the knowledge base lists it, to show nothing changed.
  const listed = async () => (await api.get('/api/knowledge-documents/ingested')).body[0]

  it('refuses a value that is not allowed, with the reason, and keeps the old value', async () => {
    const id = await stored(REPORT)
    const before = await listed()

    const response = await correct(id, { ...CORRECTED, facilityType: 'Spaceport' })

    expect(response.status).toBe(400)
    expect(response.body.fields).toEqual({ facilityType: 'Choose a facility type from the list.' })
    expect(await listed()).toEqual(before)
  })

  it('returns 404 for an unknown or malformed ID', async () => {
    expect((await correct('6abb28ae16068a0793e9962a')).status).toBe(404)
    expect((await correct('not-an-id')).status).toBe(404)
  })

  it('refuses to correct a document that has not finished ingesting', async () => {
    const id = await stored(REPORT, { status: 'processing' })

    const response = await correct(id)

    expect(response.status).toBe(409)
    expect(response.body.error).toBe(
      'Only a document that has finished ingesting can be corrected.',
    )
  })

  it('keeps the old details when search could not be updated', async () => {
    const id = await stored(REPORT)
    const before = await listed()
    inspect.mockRejectedValue(new TypeError('fetch failed'))

    const response = await correct(id)

    expect(response.status).toBe(503)
    expect(response.body.error).toBe(
      'Search could not be updated, so the correction was not saved. Try again shortly.',
    )
    expect(await listed()).toEqual(before)
  })

  it("keeps a standard's edition when a failed correction would have removed it", async () => {
    const id = await stored(DETAILS)
    inspect.mockResolvedValue(Response.json({ detail: 'Chroma is down' }, { status: 500 }))

    expect((await correct(id)).status).toBe(503)
    expect(await listed()).toMatchObject({ sourceType: 'nfpa_standard', edition: '2022' })
  })

  // KB-01 AC9–AC10: the details a correction replaces are kept as a previous version.
  it('records the replaced details as a previous version, with who and when, newest first', async () => {
    const id = await stored(REPORT)
    const before = Date.now()

    await correct(id)
    const { body } = await correct(id, { ...CORRECTED, title: 'Cold store survey 2' })

    expect(body.title).toBe('Cold store survey 2')
    expect(body.history).toHaveLength(2)
    expect(body.history[0]).toMatchObject({
      title: 'Cold store risk survey',
      sourceType: 'marsh_report',
      edition: null,
      effectiveDate: '2024-03-12',
      jurisdiction: 'SG',
      facilityType: 'Data centre',
      replacedBy: { name: 'Test User' },
    })
    expect(body.history[1]).toMatchObject({ jurisdiction: 'MY', facilityType: 'Cold store' })
    expect(typeof body.history[0].replacedBy.id).toBe('string')
    expect(new Date(body.history[0].replacedAt).getTime()).toBeGreaterThanOrEqual(before)
    expect(new Date(body.history[0].replacedAt) >= new Date(body.history[1].replacedAt)).toBe(true)
  })

  it('restores a previous version by saving its details, which becomes a previous version itself', async () => {
    const id = await stored(REPORT)
    await correct(id)

    const { body } = await correct(id, {
      title: REPORT.title,
      effectiveDate: REPORT.effectiveDate,
      sourceType: REPORT.sourceType,
      jurisdiction: REPORT.jurisdiction,
      facilityType: REPORT.facilityType,
    })

    expect(body).toMatchObject({ jurisdiction: 'MY', facilityType: 'Cold store' })
    expect(body.history[0]).toMatchObject({ jurisdiction: 'SG', facilityType: 'Data centre' })
    expect(body.history).toHaveLength(2)
  })

  it('records no version when a save changes nothing', async () => {
    const id = await stored(REPORT)
    const same = {
      title: REPORT.title,
      effectiveDate: REPORT.effectiveDate,
      sourceType: REPORT.sourceType,
      jurisdiction: REPORT.jurisdiction,
      facilityType: REPORT.facilityType,
    }

    const { body } = await correct(id, same)

    expect(body.history).toEqual([])
  })

  it('records no version when search could not be updated', async () => {
    const id = await stored(REPORT)
    await correct(id)
    const before = await listed()
    inspect.mockRejectedValue(new TypeError('fetch failed'))

    const response = await correct(id, { ...CORRECTED, title: 'Never saved' })

    expect(response.status).toBe(503)
    expect(await listed()).toEqual(before)
    expect(before.history).toHaveLength(1)
  })
})

// KB-01 AC12–16: withdraw a document from use, and reinstate it.
describe('POST /api/knowledge-documents/:id/withdraw and /reinstate', () => {
  const withdraw = (id: string) => api.post(`/api/knowledge-documents/${id}/withdraw`)
  const reinstate = (id: string) => api.post(`/api/knowledge-documents/${id}/reinstate`)
  const sentLabels = () => {
    const [url, init] = inspect.mock.lastCall as unknown as [string, RequestInit]
    return { url, body: JSON.parse(String(init.body)) }
  }
  const STILL_ACTIVE =
    "The knowledge base couldn't be updated, so nothing changed. Try again shortly."
  const STILL_WITHDRAWN =
    "The knowledge base couldn't be updated, so nothing changed. Try again shortly."

  it('withdraws an active document, recording who and when, and labels its passages withdrawn', async () => {
    const id = await stored(REPORT)
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    const before = Date.now()

    const response = await withdraw(id)

    expect(response.status).toBe(200)
    expect(response.body.withdrawn).toMatchObject({ by: { name: 'Test User' } })
    expect(typeof response.body.withdrawn.by.id).toBe('string')
    expect(new Date(response.body.withdrawn.at).getTime()).toBeGreaterThanOrEqual(before)
    expect(sentLabels().url).toBe(`${process.env.INGESTION_SERVICE_URL}/documents/${id}/labels`)
    expect(sentLabels().body).toMatchObject({ source_type: 'marsh_report', status: 'withdrawn' })
    expect((await api.get('/api/knowledge-documents/ingested')).body[0].withdrawn).toMatchObject({
      by: { name: 'Test User' },
    })
  })

  it('gives an active document no withdrawal', async () => {
    await stored(REPORT)
    expect((await api.get('/api/knowledge-documents/ingested')).body[0].withdrawn).toBeNull()
  })

  it('refuses to withdraw a document that is not complete, or is already withdrawn', async () => {
    const processing = await stored(REPORT, { status: 'processing' })
    const id = await stored(REPORT)
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    await withdraw(id)

    for (const target of [processing, id]) {
      const response = await withdraw(target)
      expect(response.status).toBe(409)
      expect(response.body.error).toBe(
        'This document is no longer active. Someone may have withdrawn it already. Refresh the page to see its current status.',
      )
    }
  })

  it('keeps the document active when search could not be updated', async () => {
    const id = await stored(REPORT)
    inspect.mockRejectedValue(new TypeError('fetch failed'))

    const response = await withdraw(id)

    expect(response.status).toBe(503)
    expect(response.body.error).toBe(STILL_ACTIVE)
    expect((await api.get('/api/knowledge-documents/ingested')).body[0].withdrawn).toBeNull()
  })

  it('reinstates a withdrawn document and labels its passages active', async () => {
    const id = await stored(REPORT)
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    await withdraw(id)

    const response = await reinstate(id)

    expect(response.status).toBe(200)
    expect(response.body.withdrawn).toBeNull()
    expect(sentLabels().body).toMatchObject({ status: 'active' })
  })

  it('leaves null details out of the labels, and reinstates a document with Unconfirmed details as needs_review', async () => {
    const id = await stored({ fileName: 'scan.pdf', sourceType: 'nfpa_standard' })
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    await withdraw(id)
    expect(sentLabels().body).toEqual({
      source_type: 'nfpa_standard',
      effective_date: UPLOAD_DAY,
      status: 'withdrawn',
    })

    await reinstate(id)

    expect(sentLabels().body).toEqual({
      source_type: 'nfpa_standard',
      effective_date: UPLOAD_DAY,
      status: 'needs_review',
    })
  })

  it('refuses to reinstate a document that is not withdrawn', async () => {
    const response = await reinstate(await stored(REPORT))

    expect(response.status).toBe(409)
    expect(response.body.error).toBe(
      'This document is no longer withdrawn. Someone may have reinstated it already. Refresh the page to see its current status.',
    )
  })

  it('keeps the document withdrawn, with who and when, when search could not be updated', async () => {
    const id = await stored(REPORT)
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    const { body: withdrawn } = await withdraw(id)
    inspect.mockRejectedValue(new TypeError('fetch failed'))

    const response = await reinstate(id)

    expect(response.status).toBe(503)
    expect(response.body.error).toBe(STILL_WITHDRAWN)
    const [after] = (await api.get('/api/knowledge-documents/ingested')).body
    expect(after.withdrawn).toEqual(withdrawn.withdrawn)
  })

  it('refuses to correct a withdrawn document (KB-01 AC15)', async () => {
    const id = await stored(REPORT)
    inspect.mockResolvedValue(Response.json({ passagesUpdated: 4 }))
    await withdraw(id)
    inspect.mockClear()

    const response = await api.put(`/api/knowledge-documents/${id}`).send({
      title: REPORT.title,
      effectiveDate: REPORT.effectiveDate,
      sourceType: REPORT.sourceType,
      jurisdiction: 'SG',
      facilityType: 'Data centre',
    })

    expect(response.status).toBe(409)
    expect(response.body.error).toBe("A withdrawn document can't be edited. Reinstate it first.")
    expect(inspect).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown or malformed ID', async () => {
    for (const action of [withdraw, reinstate]) {
      expect((await action('6abb28ae16068a0793e9962a')).status).toBe(404)
      expect((await action('not-an-id')).status).toBe(404)
    }
  })
})

describe('GET /api/knowledge-documents/:id/file', () => {
  it('returns the original exactly as uploaded', async () => {
    const { body } = await upload()

    const response = await api.get(body.fileUrl).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(Buffer.from(response.body)).toEqual(PDF)
  })

  it('ends the response without crashing the gateway when S3 fails mid-stream', async () => {
    const { body } = await upload()
    s3.set(`knowledge/${body.id}.pdf`, Object.assign(Buffer.alloc(0), { failMidStream: true }))

    await expect(api.get(body.fileUrl)).rejects.toThrow()
    expect((await api.get('/api/knowledge-documents')).status).toBe(200)
  })

  it('returns 404 for an unknown or malformed ID', async () => {
    expect((await api.get('/api/knowledge-documents/6abb28ae16068a0793e9962a/file')).status).toBe(
      404,
    )
    expect((await api.get('/api/knowledge-documents/not-an-id/file')).status).toBe(404)
  })
})

// retryIngestion is the service seam (the route is tested separately). Seeds a
// document directly so each test starts from a known status.
describe('retryIngestion', () => {
  const DOC_ID = '6abb28ae16068a0793e99620'

  async function seed(overrides: Record<string, unknown> = {}) {
    await KnowledgeDocumentModel.create({
      _id: DOC_ID,
      title: 'NFPA 13 sprinkler standard',
      issuingBody: 'NFPA',
      edition: '2022',
      fileName: 'nfpa-13.pdf',
      file: {
        key: `knowledge/${DOC_ID}.pdf`,
        contentType: 'application/pdf',
        size: 2048,
        sha256: 'abc',
      },
      status: 'failed',
      error: 'Processing stopped on a system error, not a fault in the file. Upload it again.',
      finishedAt: new Date(),
      metadata: {
        source_type: 'nfpa_standard',
        jurisdiction: 'SG',
        facility_type: 'all',
        COPE_dimension: 'all',
        effective_date: new Date('2022-01-01'),
      },
      ...overrides,
    })
  }

  const stored = () => KnowledgeDocumentModel.findById(DOC_ID).lean()

  it('flips a failed document back to queued, clearing the failure fields', async () => {
    await seed()

    await retryIngestion(DOC_ID)

    const doc = await stored()
    expect(doc!.status).toBe('queued')
    expect(doc!.error).toBeUndefined()
    expect(doc!.finishedAt).toBeUndefined()
    expect(doc!.result).toBeUndefined()
  })

  it('increments the retry counter on each retry', async () => {
    await seed()

    await retryIngestion(DOC_ID)
    expect((await stored())!.retryCount).toBe(1)

    // Fail it again, then retry a second time: the counter keeps climbing.
    await KnowledgeDocumentModel.updateOne(
      { _id: DOC_ID },
      { $set: { status: 'failed', error: 'again', finishedAt: new Date() } },
    )
    await retryIngestion(DOC_ID)
    expect((await stored())!.retryCount).toBe(2)
  })

  it('re-queues the document', async () => {
    await seed()

    await retryIngestion(DOC_ID)

    expect(requeued).toHaveBeenCalledWith(DOC_ID)
  })

  it('refuses a document that is not failed, leaving it and its counter untouched', async () => {
    await seed({ status: 'complete', error: undefined, finishedAt: undefined })

    await expect(retryIngestion(DOC_ID)).rejects.toBeInstanceOf(KnowledgeDocumentWrongStateError)

    const doc = await stored()
    expect(doc!.status).toBe('complete')
    expect(doc!.retryCount ?? 0).toBe(0)
    expect(requeued).not.toHaveBeenCalled()
  })

  it('rejects an unknown id', async () => {
    await expect(retryIngestion('6abb28ae16068a0793e99999')).rejects.toBeInstanceOf(
      KnowledgeDocumentNotFoundError,
    )
  })

  it('rejects a malformed id without reaching the database', async () => {
    await expect(retryIngestion('not-an-id')).rejects.toBeInstanceOf(KnowledgeDocumentNotFoundError)
  })

  it('rolls status and counter back if re-queueing fails', async () => {
    await seed()
    requeued.mockRejectedValueOnce(new Error('queue down'))

    await expect(retryIngestion(DOC_ID)).rejects.toThrow()

    const doc = await stored()
    // Back to failed, with a re-queue-specific reason, and the counter undone.
    expect(doc!.status).toBe('failed')
    expect(doc!.error).toMatch(/re-queue/i)
    expect(doc!.retryCount).toBe(0)
  })
})

// The retry route (service behaviour is covered above in `retryIngestion`).
describe('POST /api/knowledge-documents/:id/retry', () => {
  const RETRY_ID = '6abb28ae16068a0793e99630'

  async function seedFailed(overrides: Record<string, unknown> = {}) {
    await KnowledgeDocumentModel.create({
      _id: RETRY_ID,
      title: 'NFPA 13 sprinkler standard',
      issuingBody: 'NFPA',
      edition: '2022',
      fileName: 'nfpa-13.pdf',
      file: {
        key: `knowledge/${RETRY_ID}.pdf`,
        contentType: 'application/pdf',
        size: 2048,
        sha256: 'abc',
      },
      status: 'failed',
      error: 'Processing stopped on a system error, not a fault in the file. Upload it again.',
      finishedAt: new Date(),
      metadata: {
        source_type: 'nfpa_standard',
        jurisdiction: 'SG',
        facility_type: 'all',
        COPE_dimension: 'all',
        effective_date: new Date('2022-01-01'),
      },
      ...overrides,
    })
  }

  // 401 (no session) and 403 (wrong role) are covered by the ROUTES table in
  // permissions.test.ts, alongside every other protected route.

  it('accepts a retry of a failed document with 202 and re-queues it', async () => {
    await seedFailed()

    await api.post(`/api/knowledge-documents/${RETRY_ID}/retry`).expect(202)

    const doc = await KnowledgeDocumentModel.findById(RETRY_ID).lean()
    expect(doc!.status).toBe('queued')
    expect(doc!.retryCount).toBe(1)
    expect(requeued).toHaveBeenCalledWith(RETRY_ID)
  })

  it('409s a document that is not failed', async () => {
    await seedFailed({ status: 'complete', error: undefined, finishedAt: undefined })

    await api.post(`/api/knowledge-documents/${RETRY_ID}/retry`).expect(409)
  })

  it('404s an unknown id', async () => {
    await api.post('/api/knowledge-documents/6abb28ae16068a0793e99999/retry').expect(404)
  })

  it('404s a malformed id', async () => {
    await api.post('/api/knowledge-documents/not-an-id/retry').expect(404)
  })

  it('503s when the ingestion queue cannot be reached, leaving the document failed', async () => {
    await seedFailed()
    requeued.mockRejectedValueOnce(new Error('queue down'))

    await api.post(`/api/knowledge-documents/${RETRY_ID}/retry`).expect(503)

    const doc = await KnowledgeDocumentModel.findById(RETRY_ID).lean()
    expect(doc!.status).toBe('failed')
    expect(doc!.retryCount).toBe(0)
  })
})

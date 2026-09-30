import { Readable } from 'stream'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { useMemoryMongo } from './memory-mongo'

// S3 stands in as a map, the queue as a spy, and the ingestion service's PDF
// check as a stubbed fetch.
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
vi.mock('../services/ingestion-queue.service', () => ({ enqueueIngestion: queued }))
const inspect = vi.fn<() => Promise<Response>>()

useMemoryMongo()

beforeEach(() => {
  queued.mockResolvedValue(undefined)
  inspect.mockResolvedValue(Response.json({ pages: 3 }))
  vi.stubGlobal('fetch', inspect)
})
afterEach(() => {
  s3.clear()
  queued.mockReset()
  inspect.mockReset()
  vi.unstubAllGlobals()
})

const PDF = Buffer.from('%PDF-1.7\nfake but well-formed enough\n%%EOF')
const DETAILS = {
  fileName: 'NFPA 13 – 2022.pdf',
  title: 'NFPA 13: Standard for the Installation of Sprinkler Systems',
  edition: '2022',
  effectiveDate: '2022-01-01',
  sourceType: 'nfpa_standard',
  jurisdiction: 'SG',
}
const REPORT = {
  fileName: 'Cold store survey.pdf',
  title: 'Cold store risk survey',
  effectiveDate: '2024-03-12',
  sourceType: 'marsh_report',
  jurisdiction: 'MY',
  facilityType: 'Cold store',
}

function upload(body = PDF, details: Record<string, string> = DETAILS, type = 'application/pdf') {
  return request(app)
    .post('/api/knowledge-documents')
    .query(details)
    .set('Content-Type', type)
    .send(body)
}

describe('POST /api/knowledge-documents', () => {
  it("saves a standard's details, with the issuing body set from its source type", async () => {
    const response = await upload(PDF, { ...DETAILS, issuingBody: 'Typed by hand' })

    expect(response.status).toBe(201)
    const list = await request(app).get('/api/knowledge-documents')
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
    expect((await request(app).get('/api/knowledge-documents')).body).toEqual([])
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
    const response = await request(app)
      .post('/api/knowledge-documents')
      .query(DETAILS)
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

  it('refuses missing or invalid details, naming each field to fix', async () => {
    const response = await upload(PDF, { ...DETAILS, title: ' ', jurisdiction: 'Singapore' })

    expect(response.status).toBe(400)
    expect(response.body.fields).toEqual({
      title: 'Title is required.',
      jurisdiction: 'Country must be a two-letter code, e.g. SG.',
    })
    await expectNothingKept()
  })

  it.each([
    [
      'no source type',
      { ...DETAILS, sourceType: '' },
      { sourceType: 'Choose a source type: FM standard, NFPA standard or Marsh report.' },
    ],
    [
      "a standard's edition that is not a year",
      { ...DETAILS, edition: '2022 Edition' },
      { edition: 'Edition must be a year, e.g. 2022.' },
    ],
    [
      'a Marsh report without a facility type',
      { ...REPORT, facilityType: '' },
      { facilityType: 'Facility type is required.' },
    ],
    [
      'a Marsh report for all countries',
      { ...REPORT, jurisdiction: 'all' },
      { jurisdiction: 'Country must be a two-letter code, e.g. SG.' },
    ],
  ])('refuses %s, naming the field to fix', async (_name, details, fields) => {
    const response = await upload(PDF, details)

    expect(response.status).toBe(400)
    expect(response.body.fields).toEqual(fields)
    await expectNothingKept()
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
    expect((await request(app).get('/api/knowledge-documents')).body).toEqual([])
  })
})

describe('GET /api/knowledge-documents/:id/file', () => {
  it('returns the original exactly as uploaded', async () => {
    const { body } = await upload()

    const response = await request(app).get(body.fileUrl).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(Buffer.from(response.body)).toEqual(PDF)
  })

  it('ends the response without crashing the gateway when S3 fails mid-stream', async () => {
    const { body } = await upload()
    s3.set(`knowledge/${body.id}.pdf`, Object.assign(Buffer.alloc(0), { failMidStream: true }))

    await expect(request(app).get(body.fileUrl)).rejects.toThrow()
    expect((await request(app).get('/api/knowledge-documents')).status).toBe(200)
  })

  it('returns 404 for an unknown or malformed ID', async () => {
    expect(
      (await request(app).get('/api/knowledge-documents/6abb28ae16068a0793e9962a/file')).status,
    ).toBe(404)
    expect((await request(app).get('/api/knowledge-documents/not-an-id/file')).status).toBe(404)
  })
})

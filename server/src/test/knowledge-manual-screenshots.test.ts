// IN-18: a manual clause's screenshots. Each is read by OCR (ingestion's /recognise)
// for the admin to correct, and kept in S3 to show beside the clause.
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ManualSectionModel } from '../models/manual-section.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

const s3 = vi.hoisted(() => new Map<string, { body: Buffer; type: string }>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer, type: string) => void s3.set(key, { body, type }),
  getObjectStream: async (key: string) => Readable.from([s3.get(key)!.body]),
  deleteObject: async (key: string) => void s3.delete(key),
}))

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')
const engineer = signedInAsRole(app, 'risk_engineer')

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('rest of a png')])
const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.from('rest of a jpg')])
const OCR_USAGE = {
  feature: 'ocr',
  billed_service: 'anthropic',
  model: 'claude-haiku-5-5',
  duration_ms: 900,
  input_tokens: 800,
  output_tokens: 40,
  cache_read_tokens: null,
  search_units: null,
  audio_seconds: null,
  usage_status: 'recorded',
  call_count: 1,
}

// What /recognise was sent, and how it answers: `ocr` is a status, or 'down' to fail to connect.
const sent: Record<string, unknown>[] = []
let ocr: 200 | 422 | 502 | 'down' = 200

let id: string
const upload = (body: Buffer, query = '?kind=table') =>
  admin
    .post(`/api/knowledge-documents/${id}/sections/screenshots${query}`)
    .set('Content-Type', 'application/octet-stream')
    .send(body)

beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (!String(url).endsWith('/recognise')) return Response.json({})
    if (ocr === 'down') throw new TypeError('fetch failed')
    const form = init.body as FormData
    const file = form.get('file') as Blob
    sent.push({
      kind: form.get('kind'),
      documentId: form.get('documentId'),
      context: form.get('context'),
      bytes: Buffer.from(await file.arrayBuffer()),
    })
    if (ocr === 422) {
      return Response.json(
        { detail: 'The file is not an image that can be read.' },
        { status: 422 },
      )
    }
    if (ocr === 502) return Response.json({ detail: 'unread' }, { status: 502 })
    return Response.json({
      text: 'Pipe size: 25 mm; Max spacing: 3.7 m',
      usage: [{ ...OCR_USAGE, document_id: id }],
    })
  })
  const created = await admin.post('/api/knowledge-documents/manual').send({
    sourceType: 'nfpa_standard',
    title: 'NFPA 13',
    edition: '2025',
    standardNumber: '13',
    effectiveDate: '2025-01-01',
    jurisdiction: 'all',
  })
  id = created.body.id
})
afterEach(() => {
  sent.length = 0
  ocr = 200
  s3.clear()
  vi.unstubAllGlobals()
})

describe('adding a screenshot', () => {
  it('reads it with OCR, stores it, and records the reading against the document', async () => {
    const response = await upload(PNG, '?kind=table&context=Chapter%208%20%3E%208.6%20Hangers')

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      key: expect.stringMatching(new RegExp(`^knowledge/${id}/sections/[0-9a-f-]{36}\\.png$`)),
      kind: 'table',
      text: 'Pipe size: 25 mm; Max spacing: 3.7 m',
      readError: null,
    })
    expect(s3.get(response.body.key)).toEqual({ body: PNG, type: 'image/png' })
    expect(sent).toEqual([
      { kind: 'table', documentId: id, context: 'Chapter 8 > 8.6 Hangers', bytes: PNG },
    ])
    const recorded = await AiCallModel.find().lean()
    expect(recorded.map((c) => [c.feature, String(c.documentId)])).toEqual([['ocr', id]])
  })

  it('keeps a JPG as a JPG', async () => {
    const response = await upload(JPG, '?kind=picture')

    expect(response.body.key).toMatch(/\.jpg$/)
    expect(s3.get(response.body.key)!.type).toBe('image/jpeg')
  })

  it.each([
    ['can’t read it', 502 as const],
    ['is down', 'down' as const],
  ])('keeps the image with empty text to type when OCR %s', async (_, state) => {
    ocr = state

    const response = await upload(PNG)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ text: '', readError: expect.stringMatching(/type/i) })
    expect(s3.has(response.body.key)).toBe(true)
  })

  it('refuses a file that is not an image, before any OCR', async () => {
    const response = await upload(Buffer.from('%PDF-1.7 a pdf'))

    expect(response.status).toBe(415)
    expect(response.body.error).toMatch(/PNG, JPG or WebP/)
    expect(sent).toEqual([])
    expect(s3.size).toBe(0)
  })

  it('refuses an image OCR says can’t be opened, storing nothing', async () => {
    ocr = 422

    const response = await upload(PNG)

    expect(response.status).toBe(422)
    expect(s3.size).toBe(0)
  })

  it('refuses an image over 10 MB, saying so', async () => {
    const response = await upload(Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]))

    expect(response.status).toBe(413)
    expect(response.body.error).toBe('The file is larger than 10 MB.')
  })

  it('needs a kind it knows', async () => {
    expect((await upload(PNG, '?kind=chart')).status).toBe(400)
    expect((await upload(PNG, '')).status).toBe(400)
  })

  it('refuses an engineer, an uploaded document and a withdrawn one', async () => {
    await engineer
      .post(`/api/knowledge-documents/${id}/sections/screenshots?kind=table`)
      .set('Content-Type', 'application/octet-stream')
      .send(PNG)
      .expect(403)
    await KnowledgeDocumentModel.updateOne(
      { _id: id },
      { withdrawn: { at: new Date(), by: { id: 'u1', name: 'Sana' } } },
    )
    expect((await upload(PNG)).status).toBe(409)
    await KnowledgeDocumentModel.updateOne(
      { _id: id },
      { $unset: { entryMethod: 1, withdrawn: 1 } },
    )
    expect((await upload(PNG)).status).toBe(409)
  })
})

describe('showing a screenshot', () => {
  const show = (name: string) =>
    engineer.get(`/api/knowledge-documents/${id}/sections/screenshots/${name}`)

  it('streams one a saved clause holds, to anyone who can view', async () => {
    const { body: shot } = await upload(PNG)
    await ManualSectionModel.create({
      documentId: id,
      seq: 1,
      order: 10,
      clause: '8.6.1',
      images: [{ key: shot.key, kind: 'table', text: 'x' }],
      updatedBy: { id: 'u1', name: 'Sana' },
    })

    const response = await show(shot.key.split('/').pop()).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(Buffer.from(response.body)).toEqual(PNG)
  })

  it('answers 404 for one no clause holds, or a name that isn’t a screenshot’s', async () => {
    const { body: shot } = await upload(PNG)

    await show(shot.key.split('/').pop()).expect(404)
    await show('..%2F..%2Fsecret.png').expect(404)
    await show('nothing.png').expect(404)
  })
})

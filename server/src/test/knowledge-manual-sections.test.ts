// IN-18: saving, deleting and re-embedding a manual document's clauses. The
// ingestion service is stubbed by URL, S3 by a set of the keys stored.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ManualSectionModel } from '../models/manual-section.model'
import { ReportSectionModel } from '../models/report-section.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

const s3 = vi.hoisted(() => new Set<string>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string) => void s3.add(key),
  deleteObject: async (key: string) => void s3.delete(key),
}))

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')
const engineer = signedInAsRole(app, 'risk_engineer')

type Call = { method: string; path: string; body: unknown }
const calls: Call[] = []
let ingestionDown = false
const EMBED_USAGE = {
  feature: 'embed-document',
  billed_service: 'cohere-embed',
  model: 'embed-v4.0',
  duration_ms: 90,
  input_tokens: 12,
  output_tokens: null,
  cache_read_tokens: null,
  search_units: null,
  audio_seconds: null,
  usage_status: 'recorded',
  call_count: 1,
}
const CLAUSE = {
  clause: '8.6.1',
  headings: ['Chapter 8 Installation', '8.6 Hangers'],
  text: 'Hangers shall be listed.',
}

let id: string
const sections = () => `/api/knowledge-documents/${id}/sections`
const add = (over: object = {}) => admin.post(sections()).send({ ...CLAUSE, ...over })
const change = (sid: string, body: object) => admin.put(`${sections()}/${sid}`).send(body)
const remove = (sid: string) => admin.delete(`${sections()}/${sid}`)
const cite = (citation: string) =>
  ReportSectionModel.collection.insertOne({
    subsections: [{ statements: [{ text: 'x', citations: [citation], supported: true }] }],
  })

beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push({
      method: init.method ?? 'GET',
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    })
    if (ingestionDown) return new Response('{}', { status: 500 })
    if (init.method === 'DELETE') return Response.json({ passagesDeleted: 1 })
    return Response.json({ passagesIndexed: 1, usage: [{ ...EMBED_USAGE, document_id: id }] })
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
  calls.length = 0
})
afterEach(() => {
  calls.length = 0
  ingestionDown = false
  s3.clear()
  vi.unstubAllGlobals()
})

describe('adding a clause', () => {
  it('saves it, indexes it and records the embedding against the document', async () => {
    const response = await add()

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      seq: 1,
      order: 10,
      ...CLAUSE,
      images: [],
      indexed: true,
      indexError: null,
      checked: true,
      copiedFrom: null,
      updatedBy: { name: 'Test User' },
    })
    expect(calls).toEqual([
      {
        method: 'PUT',
        path: `/documents/${id}/manual-sections/${response.body.id}`,
        body: { seq: 1, order: 10, ...CLAUSE, images: [] },
      },
    ])
    const recorded = await AiCallModel.find().lean()
    expect(recorded.map((c) => [c.feature, String(c.documentId)])).toEqual([['embed-document', id]])
  })

  it('numbers each clause once and puts a new one last', async () => {
    await add()
    const second = await add({ clause: '8.6.2' })

    expect(second.body).toMatchObject({ seq: 2, order: 20 })
    expect((await KnowledgeDocumentModel.findById(id).lean())!.manualSeq).toBe(2)
  })

  it('refuses a clause number the document already has, spaces aside', async () => {
    await add()

    const response = await add({ clause: ' 8.6.1 ' })

    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: 'Clause 8.6.1 already exists.',
      fields: { clause: 'Clause 8.6.1 already exists.' },
    })
  })

  it('keeps the text, unindexed, when ingestion is down; Re-embed then indexes it', async () => {
    ingestionDown = true
    const saved = await add()

    expect(saved.status).toBe(201)
    expect(saved.body).toMatchObject({ indexed: false, indexError: expect.any(String) })
    expect(await ManualSectionModel.countDocuments()).toBe(1)

    ingestionDown = false
    const retried = await admin.post(`${sections()}/${saved.body.id}/reembed`)

    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({ indexed: true, indexError: null })
  })

  it('searches a screenshot’s corrected text with the clause, sending only its key and kind', async () => {
    const key = `knowledge/${id}/sections/1.png`
    const images = [{ key, kind: 'table', text: 'Pipe size: 25 mm; Max spacing: 3.7 m' }]

    const response = await add({ images })

    expect(response.status).toBe(201)
    expect(calls[0].body).toMatchObject({
      text: 'Hangers shall be listed.\n\nPipe size: 25 mm; Max spacing: 3.7 m',
      images: [{ key, kind: 'table' }],
    })
    expect(response.body).toMatchObject({ text: 'Hangers shall be listed.', images })
  })

  it('takes a clause that is only a screenshot, but not an empty one', async () => {
    const key = `knowledge/${id}/sections/1.png`

    await add({ text: '', images: [{ key, kind: 'formula', text: 'Q = K\\sqrt{P}' }] }).expect(201)
    const empty = await add({ clause: '8.6.2', text: ' ' })

    expect(empty.status).toBe(400)
    expect(empty.body.fields.text).toMatch(/text, or add a screenshot/)
  })

  it('refuses a screenshot that is not this document’s', async () => {
    const images = [{ key: 'knowledge/other/sections/1.png', kind: 'table', text: 'x' }]

    expect((await add({ images })).status).toBe(400)
  })
})

describe('changing a clause', () => {
  it('saves and re-indexes it when nobody saved it meanwhile', async () => {
    const { body: saved } = await add()
    calls.length = 0

    const response = await change(saved.id, {
      ...CLAUSE,
      text: 'Hangers shall be listed and installed.',
      order: 15,
      updatedAt: saved.updatedAt,
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      text: 'Hangers shall be listed and installed.',
      order: 15,
    })
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { seq: 1, order: 15 } })
  })

  it('refuses a save over someone else’s newer one', async () => {
    const { body: saved } = await add()
    await change(saved.id, { ...CLAUSE, text: 'First.', updatedAt: saved.updatedAt }).expect(200)

    const response = await change(saved.id, {
      ...CLAUSE,
      text: 'Second.',
      updatedAt: saved.updatedAt,
    })

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/someone else saved this clause/i)
    expect((await ManualSectionModel.findById(saved.id).lean())!.text).toBe('First.')
  })

  it('refuses renumbering it to another clause’s number', async () => {
    await add()
    const { body: other } = await add({ clause: '8.6.2' })

    expect((await change(other.id, { ...CLAUSE, updatedAt: other.updatedAt })).status).toBe(409)
  })

  it('marks a copied clause checked once saved', async () => {
    const { body: saved } = await add()
    await ManualSectionModel.updateOne({ _id: saved.id }, { checked: false })
    const { updatedAt } = (await ManualSectionModel.findById(saved.id).lean())!

    const response = await change(saved.id, { ...CLAUSE, updatedAt: updatedAt.toISOString() })

    expect(response.body.checked).toBe(true)
  })
})

describe('deleting a clause', () => {
  it('removes its passages, the clause and its screenshots', async () => {
    const key = `knowledge/${id}/sections/1.png`
    s3.add(key)
    const { body: saved } = await add({ images: [{ key, kind: 'table', text: 'x' }] })
    calls.length = 0

    await remove(saved.id).expect(204)

    expect(calls).toEqual([
      { method: 'DELETE', path: `/documents/${id}/manual-sections/${saved.id}`, body: null },
    ])
    expect(await ManualSectionModel.countDocuments()).toBe(0)
    expect(s3.has(key)).toBe(false)
  })

  it.each([
    ['its passage', ':1'],
    ['a part of it', ':1:part2'],
  ])('is refused while a report cites %s, as IN-12 does for a document', async (_, rest) => {
    const { body: saved } = await add()
    await cite(`C:${id}${rest}`)

    const response = await remove(saved.id)

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/a report cites this clause/i)
    expect(await ManualSectionModel.countDocuments()).toBe(1)
  })

  it('is not blocked by a citation of another clause', async () => {
    const { body: saved } = await add()
    await cite(`C:${id}:10`)

    await remove(saved.id).expect(204)
  })

  it('keeps the clause when its passages can’t be removed', async () => {
    const { body: saved } = await add()
    ingestionDown = true

    expect((await remove(saved.id)).status).toBe(503)
    expect(await ManualSectionModel.countDocuments()).toBe(1)
  })
})

it('lists the clauses in their order, to anyone who can view', async () => {
  await add()
  const { body: first } = await add({ clause: '8.5', order: 5 })

  const response = await engineer.get(sections()).expect(200)

  expect(response.body.map((s: { clause: string }) => s.clause)).toEqual(['8.5', '8.6.1'])
  expect(response.body[0].id).toBe(first.id)
})

describe('who and what may change clauses', () => {
  it('refuses an engineer', async () => {
    await engineer.post(sections()).send(CLAUSE).expect(403)
  })

  it('answers 404 for an unknown document or clause', async () => {
    await admin
      .post('/api/knowledge-documents/6abb28ae16068a0793e99999/sections')
      .send(CLAUSE)
      .expect(404)
    await remove('6abb28ae16068a0793e99999').expect(404)
    await remove('not-an-id').expect(404)
  })

  it('refuses clauses on an uploaded document, which can’t be amended', async () => {
    await KnowledgeDocumentModel.updateOne({ _id: id }, { $unset: { entryMethod: 1 } })

    const response = await add()

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/only a manually entered document/i)
  })

  it('refuses changes to a withdrawn document, but still lists its clauses', async () => {
    const { body: saved } = await add()
    await KnowledgeDocumentModel.updateOne(
      { _id: id },
      { status: 'complete', withdrawn: { at: new Date(), by: { id: 'u1', name: 'Sana' } } },
    )

    expect((await add({ clause: '9.1' })).status).toBe(409)
    expect((await admin.post(`${sections()}/${saved.id}/reembed`)).status).toBe(409)
    expect((await remove(saved.id)).body.error).toMatch(/withdrawn/i)
    await engineer.get(sections()).expect(200)
  })
})

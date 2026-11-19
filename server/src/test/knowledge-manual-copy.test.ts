// IN-18: starting a new manual edition from an earlier one ("Start from"). Its clauses
// are copied into the new draft unchecked, so each must be checked before Publish.
// The copy is independent: new ids, new screenshot keys, and citations of the old
// edition never block changing or deleting a copied clause.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ManualSectionModel } from '../models/manual-section.model'
import { ReportSectionModel } from '../models/report-section.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

const s3 = vi.hoisted(() => new Set<string>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string) => void s3.add(key),
  copyObject: async (from: string, to: string) => {
    if (!s3.has(from)) throw new Error('NoSuchKey')
    s3.add(to)
  },
  deleteObject: async (key: string) => void s3.delete(key),
}))
vi.mock('../services/ingestion-queue.service', () => ({
  enqueueIngestion: vi.fn(),
  requeueIngestion: vi.fn(),
  removeIngestionJob: vi.fn(),
}))

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')

const PDF_CLAUSES = [
  { clause: '8.1', headings: ['Chapter 8 Installation', '8.1 General.'], text: 'Sprinklers.' },
  { clause: '8.2.1', headings: ['8.2.1* Hangers.'], text: 'Hangers shall be listed.' },
]
const calls: string[] = []
let down = false
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push(`${init.method ?? 'GET'} ${path}`)
    if (down) return new Response('{}', { status: 500 })
    if (path.endsWith('/clauses')) return Response.json({ clauses: PDF_CLAUSES })
    return Response.json({ passagesDeleted: 1, match: null })
  })
})
afterEach(() => {
  calls.length = 0
  down = false
  s3.clear()
  vi.unstubAllGlobals()
})

const METADATA = {
  source_type: 'nfpa_standard' as const,
  jurisdiction: 'all',
  facility_type: 'all',
  effective_date: new Date('2022-01-01'),
}
const OLD = { issuingBody: 'NFPA', edition: '2022', standardNumber: '13', metadata: METADATA }
const NEW_EDITION = {
  sourceType: 'nfpa_standard',
  title: 'NFPA 13',
  edition: '2025',
  standardNumber: '13',
  effectiveDate: '2025-01-01',
  jurisdiction: 'all',
}
const startFrom = (copyFrom: unknown, details: object = NEW_EDITION) =>
  admin.post('/api/knowledge-documents/manual').send({ ...details, copyFrom })
const pdf2022 = (over: object = {}) =>
  KnowledgeDocumentModel.create({
    ...OLD,
    title: 'NFPA 13 (2022)',
    fileName: 'nfpa-13-2022.pdf',
    file: { key: 'knowledge/old.pdf', contentType: 'application/pdf', size: 1, sha256: 'old' },
    status: 'complete',
    ...over,
  })
async function manual2022() {
  const old = await KnowledgeDocumentModel.create({
    ...OLD,
    title: 'NFPA 13 (2022, typed in)',
    entryMethod: 'manual',
    status: 'complete',
    manualSeq: 1,
  })
  const key = `knowledge/${old._id}/sections/0b7c7c3e-6d1b-4a6e-9a51-6a0f8c1e2f3a.png`
  s3.add(key)
  await ManualSectionModel.create({
    documentId: old._id,
    seq: 1,
    order: 10,
    clause: '8.6.1',
    headings: ['8.6 Hangers'],
    text: 'Hangers shall be listed.',
    images: [{ key, kind: 'table', text: 'Pipe: 25 mm' }],
    indexed: true,
    checked: true,
    updatedBy: { id: 'u1', name: 'Sana' },
  })
  return { old, key }
}

describe('starting from an earlier edition', () => {
  it('copies an uploaded edition’s clauses, unchecked and not yet indexed', async () => {
    const old = await pdf2022()

    const response = await startFrom(String(old._id))

    expect(response.status).toBe(201)
    const copied = await ManualSectionModel.find({ documentId: response.body.id })
      .sort({ order: 1 })
      .lean()
    expect(
      copied.map((s) => [s.seq, s.order, s.clause, s.headings, s.text, s.checked, s.indexed]),
    ).toEqual([
      [1, 10, '8.1', PDF_CLAUSES[0].headings, 'Sprinklers.', false, false],
      [2, 20, '8.2.1', PDF_CLAUSES[1].headings, 'Hangers shall be listed.', false, false],
    ])
    expect(copied[0].copiedFrom).toEqual({ documentId: old._id, clause: '8.1' })
    expect((await KnowledgeDocumentModel.findById(response.body.id).lean())!.manualSeq).toBe(2)
    // Copying reads the old edition only: nothing is embedded until each clause is checked.
    expect(calls).toEqual([`GET /documents/${old._id}/clauses`])
  })

  it('copies a manual edition’s clauses with their screenshots under new keys', async () => {
    const { old, key } = await manual2022()

    const response = await startFrom(String(old._id))

    const [copy] = await ManualSectionModel.find({ documentId: response.body.id }).lean()
    expect(copy).toMatchObject({ clause: '8.6.1', text: 'Hangers shall be listed.' })
    expect(copy.images[0]).toMatchObject({ kind: 'table', text: 'Pipe: 25 mm' })
    expect(copy.images[0].key).toMatch(new RegExp(`^knowledge/${response.body.id}/sections/`))
    expect(s3.has(copy.images[0].key)).toBe(true)
    expect(s3.has(key)).toBe(true)
    expect(calls).toEqual([])
  })

  it('needs every copied clause checked before Publish', async () => {
    const old = await pdf2022()
    const { body } = await startFrom(String(old._id))

    const response = await admin.post(`/api/knowledge-documents/${body.id}/publish`)

    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ unindexed: 2, unchecked: 2 })
  })

  it.each([
    ['another standard', () => pdf2022({ standardNumber: '20' })],
    ['the same edition', () => pdf2022({ edition: '2025' })],
    ['a document still being ingested', () => pdf2022({ status: 'processing' })],
  ])('refuses to start from %s, creating nothing', async (_, make) => {
    const old = await make()

    const response = await startFrom(String(old._id))

    expect(response.status).toBe(400)
    expect(response.body.fields).toHaveProperty('copyFrom')
    expect(await KnowledgeDocumentModel.countDocuments({ entryMethod: 'manual' })).toBe(0)
  })

  it('refuses an unknown or malformed edition', async () => {
    expect((await startFrom('6abb28ae16068a0793e99999')).status).toBe(400)
    expect((await startFrom('nope')).status).toBe(400)
  })

  it('creates nothing when the uploaded edition can’t be read', async () => {
    const old = await pdf2022()
    down = true

    expect((await startFrom(String(old._id))).status).toBe(503)
    expect(await KnowledgeDocumentModel.countDocuments({ entryMethod: 'manual' })).toBe(0)
  })
})

describe('a copy stands on its own', () => {
  it('can delete a clause whose original a report cites', async () => {
    const { old } = await manual2022()
    await ReportSectionModel.collection.insertOne({
      subsections: [
        { statements: [{ text: 'x', citations: [`C:${old._id}:1`], supported: true }] },
      ],
    })
    const { body } = await startFrom(String(old._id))
    const [copy] = await ManualSectionModel.find({ documentId: body.id }).lean()

    await admin.delete(`/api/knowledge-documents/${body.id}/sections/${copy._id}`).expect(204)
  })

  it('keeps its clauses and screenshots when the old edition is deleted', async () => {
    const { old } = await manual2022()
    const { body } = await startFrom(String(old._id))

    await admin.delete(`/api/knowledge-documents/${old._id}`).expect(204)

    const [copy] = await ManualSectionModel.find({ documentId: body.id }).lean()
    expect(copy).toBeDefined()
    expect(s3.has(copy.images[0].key)).toBe(true)
    expect(await ManualSectionModel.countDocuments({ documentId: old._id })).toBe(0)
  })

  it('records where each clause came from, for the editor’s note', async () => {
    const { old } = await manual2022()
    const { body } = await startFrom(String(old._id))

    const listed = await admin.get(`/api/knowledge-documents/${body.id}/sections`).expect(200)

    expect(listed.body[0].copiedFrom).toEqual({ documentId: String(old._id), clause: '8.6.1' })
    expect(Types.ObjectId.isValid(listed.body[0].id)).toBe(true)
  })
})

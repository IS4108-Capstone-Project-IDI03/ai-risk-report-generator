// IN-18: a manual document in the knowledge base. A draft is listed with the
// documents so any admin can continue it, and deleting or discarding a manual
// document removes its clauses and screenshots with it.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ManualSectionModel } from '../models/manual-section.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

const s3 = vi.hoisted(() => new Set<string>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string) => void s3.add(key),
  deleteObject: async (key: string) => {
    if (!key) throw new Error('no key')
    s3.delete(key)
  },
}))

// Deleting a document also drops its queued job (none for a manual one).
vi.mock('../services/ingestion-queue.service', () => ({
  enqueueIngestion: vi.fn(),
  requeueIngestion: vi.fn(),
  removeIngestionJob: vi.fn(),
}))

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')
const engineer = signedInAsRole(app, 'risk_engineer')

const calls: string[] = []
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push(`${init.method ?? 'GET'} ${path}`)
    if (path.endsWith('/match')) return Response.json({ match: null })
    return Response.json({ passagesDeleted: 3 })
  })
})
afterEach(() => {
  calls.length = 0
  s3.clear()
  vi.unstubAllGlobals()
})

const METADATA = {
  source_type: 'nfpa_standard' as const,
  jurisdiction: 'all',
  facility_type: 'all',
  effective_date: new Date('2025-01-01'),
}
const manual = (over: object = {}) =>
  KnowledgeDocumentModel.create({
    title: 'NFPA 13 (typed in)',
    issuingBody: 'NFPA',
    edition: '2025',
    standardNumber: '13',
    entryMethod: 'manual',
    status: 'draft',
    manualSeq: 1,
    metadata: METADATA,
    ...over,
  })
const uploaded = (title: string, status: 'complete' | 'processing' = 'complete') =>
  KnowledgeDocumentModel.create({
    title,
    fileName: `${title}.pdf`,
    file: { key: `knowledge/${title}.pdf`, contentType: 'application/pdf', size: 1, sha256: title },
    status,
    metadata: METADATA,
  })
async function withClause(documentId: Types.ObjectId) {
  const key = `knowledge/${documentId}/sections/1.png`
  s3.add(key)
  await ManualSectionModel.create({
    documentId,
    seq: 1,
    order: 10,
    clause: '8.1',
    text: 'x',
    images: [{ key, kind: 'table', text: 'y' }],
    updatedBy: { id: 'u1', name: 'Sana' },
  })
  return key
}

describe('the Documents list', () => {
  it('shows a manual draft beside the documents, by title, but not in Recent uploads', async () => {
    await uploaded('Zeta standard')
    await uploaded('Still processing', 'processing')
    const draft = await manual({ title: 'Alpha standard' })

    const { body } = await engineer.get('/api/knowledge-documents/ingested').expect(200)

    expect(body.map((d: { title: string; status: string }) => [d.title, d.status])).toEqual([
      ['Alpha standard', 'draft'],
      ['Zeta standard', 'complete'],
    ])
    expect(body[0]).toMatchObject({ id: String(draft._id), entryMethod: 'manual' })
    const recent = await admin.get('/api/knowledge-documents').expect(200)
    expect(recent.body.map((d: { title: string }) => d.title)).not.toContain('Alpha standard')
  })
})

describe('deleting a manual document', () => {
  it('removes its passages, clauses and screenshots, and asks for no file', async () => {
    const doc = await manual()
    const key = await withClause(doc._id)

    await admin.delete(`/api/knowledge-documents/${doc._id}`).expect(204)

    expect(calls).toContain(`DELETE /documents/${doc._id}/passages`)
    expect(await KnowledgeDocumentModel.countDocuments()).toBe(0)
    expect(await ManualSectionModel.countDocuments()).toBe(0)
    expect(s3.has(key)).toBe(false)
  })

  it('removes them when it is discarded from a review too', async () => {
    const pdf = await uploaded('NFPA 13 (PDF)')
    const doc = await manual({
      status: 'complete',
      match: {
        kind: 'replaces_manual',
        documentId: pdf._id,
        newMatched: 0,
        newTotal: 1,
        storedMatched: 0,
        storedTotal: 1,
      },
    })
    await withClause(doc._id)

    const response = await admin
      .post(`/api/knowledge-documents/${doc._id}/decision`)
      .send({ choice: 'discard_new' })

    expect(response.status).toBe(200)
    expect(await ManualSectionModel.countDocuments()).toBe(0)
    expect(await KnowledgeDocumentModel.exists({ _id: doc._id })).toBeNull()
  })

  it('leaves another document’s clauses alone', async () => {
    const doc = await manual()
    const other = await manual({ edition: '2022' })
    await withClause(doc._id)
    await withClause(other._id)

    await admin.delete(`/api/knowledge-documents/${doc._id}`).expect(204)

    expect(await ManualSectionModel.countDocuments({ documentId: other._id })).toBe(1)
  })
})

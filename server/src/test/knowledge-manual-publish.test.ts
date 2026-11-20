// IN-18: publishing a manual draft. Only a complete draft may be published: at least
// one clause, every clause indexed, every copied clause checked. Publishing runs the
// match (IN-07), so the document is active, or Needs review if it matched something.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ManualSectionModel } from '../models/manual-section.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')
const engineer = signedInAsRole(app, 'risk_engineer')

// Ingestion's POST /documents/:id/match saves the match on the document itself;
// the stub does the same with `found`, or fails when `down`.
const matched: string[] = []
let down = false
let found: object | null = null

let id: string
const publish = () => admin.post(`/api/knowledge-documents/${id}/publish`)
const clause = (seq: number, over: object = {}) =>
  ManualSectionModel.create({
    documentId: id,
    seq,
    order: seq * 10,
    clause: `8.${seq}`,
    text: 'Sprinklers shall be installed.',
    indexed: true,
    checked: true,
    updatedBy: { id: 'u1', name: 'Sana Patel' },
    ...over,
  })

beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const target = /^\/documents\/([0-9a-f]{24})\/match$/.exec(path)
    if (!target || init.method !== 'POST') return Response.json({})
    matched.push(target[1])
    if (down) return new Response('{}', { status: 500 })
    await KnowledgeDocumentModel.updateOne({ _id: target[1] }, { match: found })
    return Response.json({ match: found })
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
  matched.length = 0
  down = false
  found = null
  vi.unstubAllGlobals()
})

describe('POST /api/knowledge-documents/:id/publish', () => {
  it('makes a complete draft active once nothing matches', async () => {
    await clause(1)
    await clause(2)

    const response = await publish()

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id, status: 'complete', match: null })
    expect(matched).toEqual([id])
    expect((await KnowledgeDocumentModel.findById(id).lean())!.status).toBe('complete')
  })

  it('leaves it in Needs review when it matches the uploaded PDF of its edition', async () => {
    const pdf = await KnowledgeDocumentModel.create({
      title: 'NFPA 13 (PDF)',
      issuingBody: 'NFPA',
      edition: '2025',
      standardNumber: '13',
      fileName: 'nfpa-13.pdf',
      file: { key: 'knowledge/x.pdf', contentType: 'application/pdf', size: 1, sha256: 'a' },
      status: 'complete',
      metadata: {
        source_type: 'nfpa_standard',
        jurisdiction: 'all',
        facility_type: 'all',
        effective_date: new Date('2025-01-01'),
      },
    })
    found = {
      kind: 'replaces_manual',
      documentId: pdf._id,
      newMatched: 0,
      newTotal: 1,
      storedMatched: 0,
      storedTotal: 40,
    }
    await clause(1)

    const response = await publish()

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'complete',
      match: { kind: 'replaces_manual', document: { id: String(pdf._id) } },
    })
  })

  it('refuses a draft with no clauses', async () => {
    const response = await publish()

    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: 'Add at least one clause before publishing.',
      unindexed: 0,
      unchecked: 0,
    })
    expect(matched).toEqual([])
  })

  it('refuses while a clause isn’t indexed or a copied one isn’t checked, saying how many', async () => {
    await clause(1)
    await clause(2, { indexed: false, indexError: 'down' })
    await clause(3, {
      checked: false,
      copiedFrom: { documentId: new Types.ObjectId(), clause: '8.3' },
    })
    await clause(4, {
      checked: false,
      copiedFrom: { documentId: new Types.ObjectId(), clause: '8.4' },
    })

    const response = await publish()

    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error:
        '1 clause failed to embed and 2 clauses are left to check. Finish them before publishing.',
      unindexed: 1,
      unchecked: 2,
    })
    expect((await KnowledgeDocumentModel.findById(id).lean())!.status).toBe('draft')
    expect(matched).toEqual([])
  })

  it('stays a draft when the match can’t be run', async () => {
    await clause(1)
    down = true

    const response = await publish()

    expect(response.status).toBe(503)
    expect((await KnowledgeDocumentModel.findById(id).lean())!.status).toBe('draft')
  })

  it('refuses a document already published, or an uploaded one', async () => {
    await clause(1)
    await publish().expect(200)

    expect((await publish()).body.error).toMatch(/already published/i)
    await KnowledgeDocumentModel.updateOne(
      { _id: id },
      { $unset: { entryMethod: 1 }, status: 'draft' },
    )
    expect((await publish()).status).toBe(409)
  })

  it('refuses an engineer, and answers 404 for an unknown document', async () => {
    await engineer.post(`/api/knowledge-documents/${id}/publish`).expect(403)
    await admin.post('/api/knowledge-documents/6abb28ae16068a0793e99999/publish').expect(404)
  })
})

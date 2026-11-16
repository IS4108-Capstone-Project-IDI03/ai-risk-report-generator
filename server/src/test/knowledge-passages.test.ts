// IN-17 gateway tests: listing a knowledge document's passages for the knowledge
// base browser. Engineers and admins may read them. The ingestion service (which
// reads Chroma) is stubbed; documents are seeded straight into MongoDB.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()
const engineer = signedInAsRole(app, 'risk_engineer')

const PASSAGES = [
  {
    id: 'doc:0',
    text: 'Sprinklers shall be installed throughout.',
    headings: ['Chapter 8', '8.1'],
    section: 'Not applicable',
    pageStart: 12,
    pageEnd: 12,
    status: 'active',
  },
]
const requested: string[] = []
let ingestionDown = false
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(String(url).replace(process.env.INGESTION_SERVICE_URL!, ''))
    if (ingestionDown) return new Response('{}', { status: 500 })
    return Response.json({ passages: PASSAGES })
  })
})
afterEach(() => {
  requested.length = 0
  ingestionDown = false
  vi.unstubAllGlobals()
})

function seed() {
  return KnowledgeDocumentModel.create({
    title: 'NFPA 13',
    issuingBody: 'NFPA',
    edition: '2022',
    standardNumber: '13',
    fileName: 'nfpa-13.pdf',
    file: { key: 'knowledge/1.pdf', contentType: 'application/pdf', size: 10, sha256: 'sha1' },
    status: 'complete',
    metadata: {
      source_type: 'nfpa_standard',
      jurisdiction: 'SG',
      facility_type: 'all',
      effective_date: new Date('2022-01-01'),
    },
    unconfirmed: [],
  })
}

describe('GET /api/knowledge-documents/:id/passages', () => {
  it("lets an engineer read a document's passages from the ingestion service", async () => {
    const document = await seed()

    const response = await engineer.get(`/api/knowledge-documents/${document._id}/passages`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ passages: PASSAGES })
    expect(requested).toEqual([`/documents/${document._id}/passages`])
  })

  it('answers 404 for an unknown or malformed id without asking the ingestion service', async () => {
    const unknown = new Types.ObjectId()

    expect((await engineer.get(`/api/knowledge-documents/${unknown}/passages`)).status).toBe(404)
    expect((await engineer.get('/api/knowledge-documents/not-an-id/passages')).status).toBe(404)
    expect(requested).toEqual([])
  })

  it('answers 503 when the ingestion service is down', async () => {
    const document = await seed()
    ingestionDown = true

    const response = await engineer.get(`/api/knowledge-documents/${document._id}/passages`)

    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/passages could not be loaded/i)
  })
})

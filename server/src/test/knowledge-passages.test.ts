// IN-17 gateway tests: a knowledge document's passages for the knowledge base browser,
// one page at a time, filtered by the outline and pages, or searched by words. Engineers
// and admins may read them. The ingestion service (which lists Chroma) and the RAG
// service (whose keyword search ranks them) are stubbed; documents are seeded into MongoDB.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()
const engineer = signedInAsRole(app, 'risk_engineer')

const PASSAGE = {
  id: 'doc:0',
  position: 1,
  text: 'Sprinklers shall be installed throughout.',
  headings: ['8.1 General.'],
  section: 'Not applicable',
  pageStart: 12,
  pageEnd: 12,
  status: 'active',
  kind: 'text',
  generated: false,
}
const LISTED = {
  total: 1,
  passages: [PASSAGE],
  outline: {
    by: 'clause',
    chapters: [{ name: '8', count: 1, title: 'Installation' }],
    sections: [],
  },
}
const SEARCHED = [{ id: 'doc:7' }, { id: 'doc:2' }]

// Each call to the stubbed services: its method, path with query, and body.
type Call = { method: string; path: string; body: unknown }
const calls: Call[] = []
let down: 'ingestion' | 'rag' | null = null
let found: object[] = SEARCHED
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace('http://127.0.0.1:9', '')
    calls.push({
      method: init.method ?? 'GET',
      path,
      body: init.body && JSON.parse(String(init.body)),
    })
    if (path === '/passages/search') {
      if (down === 'rag') return new Response('{}', { status: 500 })
      return Response.json({ results: found })
    }
    if (down === 'ingestion') return new Response('{}', { status: 500 })
    return Response.json(LISTED)
  })
})
afterEach(() => {
  calls.length = 0
  down = null
  found = SEARCHED
  vi.unstubAllGlobals()
})

function seed(over: Record<string, unknown> = {}) {
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
    ...over,
  })
}
const listing = (id: Types.ObjectId | string, query = '') =>
  engineer.get(`/api/knowledge-documents/${id}/passages${query}`)
// The query the gateway sent the ingestion service, as an object.
const ingestionQuery = () => {
  const call = calls.find((c) => c.path.startsWith('/documents/'))!
  const url = new URL(call.path, 'http://x')
  return { path: url.pathname, query: [...url.searchParams.entries()] }
}

describe('GET /api/knowledge-documents/:id/passages', () => {
  it('lets an engineer read a page of passages with the outline', async () => {
    const document = await seed()

    const response = await listing(document._id)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(LISTED)
    expect(ingestionQuery()).toEqual({
      path: `/documents/${document._id}/passages`,
      query: [
        ['offset', '0'],
        ['limit', '25'],
      ],
    })
  })

  it('passes the page, the outline filters and the page range to the ingestion service', async () => {
    const document = await seed()

    await listing(document._id, '?offset=25&limit=10&chapter=8&section=8.6&pageFrom=3&pageTo=9')

    expect(ingestionQuery().query).toEqual([
      ['offset', '25'],
      ['limit', '10'],
      ['chapter', '8'],
      ['section', '8.6'],
      ['pageFrom', '3'],
      ['pageTo', '9'],
    ])
  })

  it('passes front matter, the empty chapter name, as a filter of its own', async () => {
    const document = await seed()

    await listing(document._id, '?chapter=')

    expect(ingestionQuery().query).toContainEqual(['chapter', ''])
  })

  it.each([
    ['?limit=0', 'a page of no passages'],
    ['?limit=101', 'a page over 100'],
    ['?offset=-1', 'a negative offset'],
    ['?pageFrom=0', 'page 0'],
    ['?pageFrom=5&pageTo=4', 'a range that ends before it starts'],
    ['?mode=guess&q=pump', 'an unknown search mode'],
  ])('answers 400 for %s (%s) without asking the services', async (query) => {
    const document = await seed()

    const response = await listing(document._id, query)

    expect(response.status).toBe(400)
    expect(response.body.error).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('answers 404 for an unknown or malformed id without asking the ingestion service', async () => {
    expect((await listing(new Types.ObjectId())).status).toBe(404)
    expect((await listing('not-an-id')).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('answers 503 when the ingestion service is down', async () => {
    const document = await seed()
    down = 'ingestion'

    const response = await listing(document._id)

    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/passages could not be loaded/i)
  })
})

describe('searching a document’s passages by words', () => {
  it('ranks them with the keyword search, then lists those passages in rank order', async () => {
    const document = await seed()

    const response = await listing(document._id, '?q=%20cold%20store%20&chapter=8')

    expect(response.status).toBe(200)
    const search = calls.find((c) => c.path === '/passages/search')!
    expect(search).toMatchObject({
      method: 'POST',
      body: { query: 'cold store', document_ids: [String(document._id)], limit: 30 },
    })
    expect(ingestionQuery().query).toEqual([
      ['offset', '0'],
      ['limit', '25'],
      ['chapter', '8'],
      ['ids', 'doc:7'],
      ['ids', 'doc:2'],
    ])
  })

  it('answers no passages, with the outline, when no word matches', async () => {
    const document = await seed()
    found = []

    const response = await listing(document._id, '?q=zebra')

    expect(response.body).toEqual({ ...LISTED, total: 0, passages: [] })
  })

  it.each([
    ['needs review', { unconfirmed: ['facility_type'] }],
    ['is withdrawn', { withdrawn: { at: new Date(), by: { id: 'u1', name: 'Sana Patel' } } }],
  ])('answers 409 when the document %s, as search skips its passages', async (_, over) => {
    const document = await seed(over)

    const response = await listing(document._id, '?q=pump')

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/search works once this document is active/i)
    expect(calls).toEqual([])
  })

  it('answers 503 when the search can’t be run', async () => {
    const document = await seed()
    down = 'rag'

    const response = await listing(document._id, '?q=pump')

    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/search could not be run/i)
  })
})

// IN-18: when the real PDF of a manually entered edition arrives, the review offers
// "Replace manual entry": the PDF becomes the active edition and the manual entry is
// withdrawn into the same edition family (kept, not deleted).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')

// Ingestion relabels passages (PUT /documents/:id/labels); each relabel's id and status.
const relabelled: [string, string][] = []
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const target = /^\/documents\/([0-9a-f]{24})\/labels$/.exec(path)
    if (target) relabelled.push([target[1], JSON.parse(String(init.body)).status])
    return Response.json({ passagesUpdated: 1 })
  })
})
afterEach(() => {
  relabelled.length = 0
  vi.unstubAllGlobals()
})

const METADATA = {
  source_type: 'nfpa_standard' as const,
  jurisdiction: 'all',
  facility_type: 'all',
  effective_date: new Date('2025-01-01'),
}
const STANDARD = { issuingBody: 'NFPA', edition: '2025', standardNumber: '13', metadata: METADATA }
const counts = { newMatched: 0, newTotal: 40, storedMatched: 0, storedTotal: 3 }

async function pair(reviewed: 'pdf' | 'manual', kind = 'replaces_manual') {
  const manual = await KnowledgeDocumentModel.create({
    ...STANDARD,
    title: 'NFPA 13 (typed in)',
    entryMethod: 'manual',
    status: 'complete',
  })
  const pdf = await KnowledgeDocumentModel.create({
    ...STANDARD,
    title: 'NFPA 13',
    fileName: 'nfpa-13.pdf',
    file: { key: 'knowledge/x.pdf', contentType: 'application/pdf', size: 1, sha256: 'a' },
    status: 'complete',
  })
  const [document, other] = reviewed === 'pdf' ? [pdf, manual] : [manual, pdf]
  await KnowledgeDocumentModel.updateOne(
    { _id: document._id },
    { match: { kind, documentId: other._id, ...counts } },
  )
  return { manual, pdf, reviewed: document }
}
const decide = (id: unknown, choice: string) =>
  admin.post(`/api/knowledge-documents/${id}/decision`).send({ choice })
const read = (id: unknown) => KnowledgeDocumentModel.findById(id).lean()

describe('Replace manual entry', () => {
  it('makes the arriving PDF active and withdraws the manual entry into its family', async () => {
    const { manual, pdf } = await pair('pdf')

    const response = await decide(pdf._id, 'replace_manual')

    expect(response.status).toBe(200)
    expect(response.body.document).toMatchObject({
      id: String(pdf._id),
      withdrawn: null,
      match: null,
    })
    const [m, p] = [await read(manual._id), await read(pdf._id)]
    expect(m!.withdrawn).toMatchObject({ by: { name: 'Test User' } })
    expect(p!.withdrawn).toBeUndefined()
    expect(String(p!.editionFamily)).toBe(String(manual._id))
    expect(String(m!.editionFamily)).toBe(String(manual._id))
    expect(p!.handled).toMatchObject({ by: { name: 'Test User' } })
    expect(relabelled).toEqual(
      expect.arrayContaining([
        [String(manual._id), 'withdrawn'],
        [String(pdf._id), 'active'],
      ]),
    )
  })

  it('withdraws the manual entry when it is the one under review', async () => {
    const { manual, pdf } = await pair('manual')

    const response = await decide(manual._id, 'replace_manual')

    expect(response.status).toBe(200)
    expect(response.body.document.withdrawn).toMatchObject({ by: { name: 'Test User' } })
    expect((await read(pdf._id))!.withdrawn).toBeUndefined()
  })

  it('keeps the manual entry’s clauses but no longer lets them change', async () => {
    const { manual, pdf } = await pair('pdf')
    await decide(pdf._id, 'replace_manual').expect(200)

    const response = await admin
      .post(`/api/knowledge-documents/${manual._id}/sections`)
      .send({ clause: '9.1', text: 'x' })

    expect(response.status).toBe(409)
    expect(await read(manual._id)).not.toBeNull()
  })

  it('is offered only for a manual entry’s match', async () => {
    const { pdf } = await pair('pdf', 'newer_edition')

    expect((await decide(pdf._id, 'replace_manual')).status).toBe(409)
  })

  it('is the only replacement offered: Supersede doesn’t fit a manual entry’s match', async () => {
    const { pdf } = await pair('pdf')

    expect((await decide(pdf._id, 'supersede')).status).toBe(409)
  })
})

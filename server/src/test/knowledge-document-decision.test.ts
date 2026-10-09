// IN-07 gateway tests: the match fields on the DTO, the comparison, every
// decision, the reinstate guard and the details-correction re-match. Documents
// are seeded straight into MongoDB (the ingestion service writes `match`, not
// the gateway); the ingestion service and S3 are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { IngestionJobModel } from '../models/ingestion-job.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

const s3Deleted = vi.hoisted(() => [] as string[])
const order = vi.hoisted(() => [] as string[])
vi.mock('../services/storage.service', () => ({
  putObject: async () => undefined,
  deleteObject: async (key: string) => {
    order.push('s3')
    s3Deleted.push(key)
  },
}))
vi.mock('../services/ingestion-queue.service', () => ({ enqueueIngestion: vi.fn() }))

useMemoryMongo()
const api = signedInAsRole(app, 'knowledge_admin')

// Every call to the ingestion service, and what it answers. `fail` makes the
// calls whose URL ends with one of its entries answer 500.
type Call = { method: string; url: string; body: unknown }
const calls: Call[] = []
let fail: string[] = []
let onMatch: (id: string) => Promise<unknown> = async () => null
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(process.env.INGESTION_SERVICE_URL!, '')
    calls.push({
      method: init.method ?? 'GET',
      url: path,
      body: init.body && JSON.parse(String(init.body)),
    })
    order.push(path.split('/').pop()!)
    if (fail.some((suffix) => path.endsWith(suffix))) return new Response('{}', { status: 500 })
    if (path.endsWith('/match')) return Response.json({ match: await onMatch(path.split('/')[2]) })
    if (path.includes('/comparison/')) return Response.json({ rows: ROWS })
    if (path.endsWith('/passages')) return Response.json({ passagesDeleted: 3 })
    return Response.json({ passagesUpdated: 3 })
  })
})
afterEach(() => {
  calls.length = order.length = s3Deleted.length = fail.length = 0
  onMatch = async () => null
  vi.unstubAllGlobals()
})
const ROWS = [
  { new: { id: 'n1', text: 'New', pageStart: 1, pageEnd: 1 }, stored: null, differs: true },
]
const labelCalls = () => calls.filter((c) => c.url.endsWith('/labels'))
const labelOf = (id: Types.ObjectId | string) =>
  labelCalls().find((c) => c.url === `/documents/${id}/labels`)?.body as
    { status: string } | undefined

let n = 0
type Seed = Record<string, unknown>
// A finished NFPA 13 document with a unique file, active unless `over` says otherwise.
async function seed(over: Seed = {}) {
  n += 1
  return KnowledgeDocumentModel.create({
    title: 'NFPA 13',
    issuingBody: 'NFPA',
    edition: '2019',
    standardNumber: '13',
    fileName: `nfpa-${n}.pdf`,
    file: {
      key: `knowledge/${n}.pdf`,
      contentType: 'application/pdf',
      size: 10,
      sha256: `sha${n}`,
    },
    status: 'complete',
    metadata: {
      source_type: 'nfpa_standard',
      jurisdiction: 'SG',
      facility_type: 'all',
      COPE_dimension: 'all',
      effective_date: new Date('2019-01-01'),
    },
    unconfirmed: [],
    ...over,
  })
}
const matchTo = (documentId: Types.ObjectId, kind = 'newer_edition') => ({
  kind,
  documentId,
  newMatched: 90,
  newTotal: 98,
  storedMatched: 88,
  storedTotal: 100,
})
// A stored 2019 edition and a new 2022 upload flagged as its newer edition.
async function editionPair(kind = 'newer_edition', otherOver: Seed = {}) {
  const stored = await seed(otherOver)
  const upload = await seed({ edition: '2022', match: matchTo(stored._id, kind) })
  return { stored, upload }
}
const decide = (id: Types.ObjectId | string, choice: string) =>
  api.post(`/api/knowledge-documents/${id}/decision`).send({ choice })
const reload = (id: Types.ObjectId) => KnowledgeDocumentModel.findById(id).lean()

describe('the match fields on the document DTO', () => {
  it('names the matched document, the shares and whether it also needs review', async () => {
    const { stored, upload } = await editionPair()

    const { body } = await api.get('/api/knowledge-documents/ingested')

    expect(body.find((d: { id: string }) => d.id === String(upload._id)).match).toEqual({
      kind: 'newer_edition',
      document: { id: String(stored._id), title: 'NFPA 13', edition: '2019', withdrawn: false },
      newMatched: 90,
      newTotal: 98,
      storedMatched: 88,
      storedTotal: 100,
      otherNeedsReview: false,
    })
    expect(body.find((d: { id: string }) => d.id === String(stored._id)).match).toBeNull()
  })

  it('flags otherNeedsReview when the matched document waits for a decision too', async () => {
    const { upload } = await editionPair('possible_copy', { unconfirmed: ['title'] })

    const { body } = await api.get('/api/knowledge-documents/ingested')

    expect(
      body.find((d: { id: string }) => d.id === String(upload._id)).match.otherNeedsReview,
    ).toBe(true)
  })

  it('says when the matched document is withdrawn', async () => {
    const gone = { at: new Date(), by: { id: 'u', name: 'U' } }
    const { upload } = await editionPair('possible_copy', { withdrawn: gone })

    const { body } = await api.get('/api/knowledge-documents/ingested')

    expect(
      body.find((d: { id: string }) => d.id === String(upload._id)).match.document.withdrawn,
    ).toBe(true)
  })

  it("gives a withdrawn edition the family's newest edition, and the newest none", async () => {
    const family = new Types.ObjectId()
    const gone = { at: new Date(), by: { id: 'u', name: 'U' } }
    const old = await seed({ editionFamily: family, withdrawn: gone })
    const mid = await seed({ edition: '2022', editionFamily: family, withdrawn: gone })
    const newest = await seed({ edition: '2026', editionFamily: family })

    const { body } = await api.get('/api/knowledge-documents/ingested')

    const of = (id: Types.ObjectId) => body.find((d: { id: string }) => d.id === String(id))
    const pointer = { id: String(newest._id), title: 'NFPA 13', edition: '2026' }
    expect(of(old._id).newerEdition).toEqual(pointer)
    expect(of(mid._id).newerEdition).toEqual(pointer)
    expect(of(newest._id).newerEdition).toBeNull()
  })

  it('looks the matched and family documents up once for the whole list', async () => {
    for (let i = 0; i < 3; i++) await editionPair()
    const find = vi.spyOn(KnowledgeDocumentModel, 'find')

    await api.get('/api/knowledge-documents/ingested')

    // One for the list, one for the matched documents; no family lookup is needed.
    expect(find).toHaveBeenCalledTimes(2)
    find.mockRestore()
  })
})

const NFPA_2022 = {
  title: 'NFPA 13',
  effectiveDate: '2022-01-01',
  sourceType: 'nfpa_standard',
  edition: '2022',
  standardNumber: '13',
  jurisdiction: 'SG',
  facilityType: 'all',
}
const correct = (id: Types.ObjectId, over: Record<string, string> = {}) =>
  api.put(`/api/knowledge-documents/${id}`).send({ ...NFPA_2022, ...over })

describe('a correction that cannot reach /match', () => {
  it('is rolled back with a 503, and passages are not relabelled, when /match is needed', async () => {
    const { upload } = await editionPair()
    fail = ['/match']

    const response = await correct(upload._id, { jurisdiction: 'MY' })

    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/nothing changed/)
    expect((await reload(upload._id))!.metadata.jurisdiction).toBe('SG')
    expect(labelCalls().every((c) => c.body === undefined)).toBe(true)
    expect(response.body.match).toBeUndefined()
  })

  it('also rolls back an identity change on a document with no match yet', async () => {
    const doc = await seed()
    fail = ['/match']

    const response = await correct(doc._id, { edition: '2022' })

    expect(response.status).toBe(503)
    const saved = await reload(doc._id)
    expect(saved!.edition).toBe('2019')
    expect(saved!.history).toHaveLength(0)
  })
})

describe('when a correction calls /match', () => {
  const matchCalls = () => calls.filter((c) => c.url.endsWith('/match'))

  it('skips /match when no identity detail changed and there is no match', async () => {
    const doc = await seed({ edition: '2022' })

    const response = await correct(doc._id, { jurisdiction: 'MY' })

    expect(response.status).toBe(200)
    expect(matchCalls()).toEqual([])
    expect(labelOf(doc._id)).toMatchObject({ status: 'active' })
  })

  it('calls /match, and leaves relabelling to it, when the standard number changed', async () => {
    const doc = await seed()

    expect((await correct(doc._id, { standardNumber: '13R', edition: '2019' })).status).toBe(200)

    expect(matchCalls()).toHaveLength(1)
  })

  it('calls /match, and leaves relabelling to it, when the edition changed', async () => {
    const doc = await seed()

    expect((await correct(doc._id)).status).toBe(200)

    expect(matchCalls()).toHaveLength(1)
    expect(labelCalls()).toEqual([])
  })

  it('calls /match for any correction when the document already has a match', async () => {
    const { upload } = await editionPair()

    expect((await correct(upload._id, { jurisdiction: 'MY' })).status).toBe(200)

    expect(matchCalls()).toHaveLength(1)
  })
})

describe('PUT /api/knowledge-documents/:id then /match (IN-07 AC5)', () => {
  it('asks the ingestion service to match the saved details and answers with the refreshed document', async () => {
    const stored = await seed()
    const doc = await seed({
      title: 'Untitled',
      edition: undefined,
      unconfirmed: ['title', 'edition'],
    })
    onMatch = async (id) => {
      const match = matchTo(stored._id)
      await KnowledgeDocumentModel.updateOne({ _id: id }, { match })
      return match
    }

    const response = await api.put(`/api/knowledge-documents/${doc._id}`).send({
      title: 'NFPA 13',
      effectiveDate: '2022-01-01',
      sourceType: 'nfpa_standard',
      edition: '2022',
      standardNumber: '13',
      jurisdiction: 'SG',
      facilityType: 'all',
    })

    expect(response.status).toBe(200)
    expect(calls.filter((c) => c.url.endsWith('/match'))).toEqual([
      { method: 'POST', url: `/documents/${doc._id}/match`, body: undefined },
    ])
    expect(response.body.match).toMatchObject({
      kind: 'newer_edition',
      document: { id: String(stored._id) },
    })
  })
})

describe('GET /api/knowledge-documents/:id/comparison', () => {
  it('returns both documents and the aligned rows from the ingestion service', async () => {
    const { stored, upload } = await editionPair()

    const response = await api.get(`/api/knowledge-documents/${upload._id}/comparison`)

    expect(response.status).toBe(200)
    expect(response.body.document.id).toBe(String(upload._id))
    expect(response.body.matched.id).toBe(String(stored._id))
    expect(response.body.rows).toEqual(ROWS)
    expect(calls[0].url).toBe(`/documents/${upload._id}/comparison/${stored._id}`)
  })

  it('answers 409 when the document has no match, 404 for an unknown one and 503 when ingestion is down', async () => {
    const plain = await seed()
    expect((await api.get(`/api/knowledge-documents/${plain._id}/comparison`)).status).toBe(409)
    expect((await api.get('/api/knowledge-documents/not-an-id/comparison')).status).toBe(404)

    const { upload } = await editionPair()
    fail = ['/comparison/' + upload.match!.documentId]
    expect((await api.get(`/api/knowledge-documents/${upload._id}/comparison`)).status).toBe(503)
  })
})

describe('POST /api/knowledge-documents/:id/decision refusals', () => {
  it('refuses an unknown choice with 400, an unknown document with 404', async () => {
    const { upload } = await editionPair()
    expect((await decide(upload._id, 'shred')).status).toBe(400)
    expect((await decide(new Types.ObjectId(), 'keep_both')).status).toBe(404)
  })

  it('refuses while details are Unconfirmed', async () => {
    const { upload } = await editionPair()
    await KnowledgeDocumentModel.updateOne({ _id: upload._id }, { unconfirmed: ['edition'] })

    const response = await decide(upload._id, 'keep_both')

    expect(response.status).toBe(409)
    expect(response.body.error).toBe(
      "This document's details are not confirmed yet. Save them first, then decide.",
    )
  })

  it('refuses a document with no match', async () => {
    const plain = await seed()
    const response = await decide(plain._id, 'keep_both')
    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/nothing left to decide/)
  })

  it('refuses when the matched document is gone', async () => {
    const { stored, upload } = await editionPair()
    await KnowledgeDocumentModel.deleteOne({ _id: stored._id })
    const response = await decide(upload._id, 'keep_both')
    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/matched document was removed/)
    expect((await reload(upload._id))!.match).toBeFalsy()
    expect(labelOf(upload._id)).toMatchObject({ status: 'active' })
  })

  it.each([
    ['possible_copy', 'supersede'],
    ['possible_copy', 'add_as_older'],
    ['earlier_edition', 'supersede'],
    ['newer_edition', 'add_as_older'],
    ['newer_edition', 'discard_other'],
  ])('refuses %s + %s, and changes nothing', async (kind, choice) => {
    const { stored, upload } = await editionPair(kind)

    const response = await decide(upload._id, choice)

    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/doesn't fit this match/)
    expect((await reload(upload._id))!.match).not.toBeNull()
    expect((await reload(stored._id))!.withdrawn).toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe('decision: keep_both', () => {
  it('clears the match, activates the passages and leaves the matched document alone', async () => {
    const { stored, upload } = await editionPair()

    const response = await decide(upload._id, 'keep_both')

    expect(response.status).toBe(200)
    expect(response.body.document).toMatchObject({ id: String(upload._id), match: null })
    expect((await reload(upload._id))!.match).toBeNull()
    expect(labelOf(upload._id)).toMatchObject({ status: 'active' })
    expect(labelOf(stored._id)).toBeUndefined()
    expect((await reload(stored._id))!.withdrawn).toBeUndefined()
  })

  it("also clears the other document's match when it points back", async () => {
    const stored = await seed()
    const upload = await seed({ edition: '2022', match: matchTo(stored._id) })
    await KnowledgeDocumentModel.updateOne(
      { _id: stored._id },
      { match: matchTo(upload._id, 'possible_copy') },
    )

    await decide(upload._id, 'keep_both')

    expect((await reload(stored._id))!.match).toBeNull()
    expect(labelOf(stored._id)).toMatchObject({ status: 'active' })
  })

  it('restores the match and answers 503 when search cannot be updated', async () => {
    const { upload } = await editionPair()
    fail = ['/labels']

    const response = await decide(upload._id, 'keep_both')

    expect(response.status).toBe(503)
    expect((await reload(upload._id))!.match).toMatchObject({ kind: 'newer_edition' })
  })
})

describe('decision: supersede', () => {
  it('activates the new edition, withdraws the stored one and joins both in one family', async () => {
    const { stored, upload } = await editionPair()

    const response = await decide(upload._id, 'supersede')

    expect(response.status).toBe(200)
    const [newer, older] = [await reload(upload._id), await reload(stored._id)]
    expect(newer!.match).toBeNull()
    expect(newer!.withdrawn).toBeUndefined()
    expect(older!.withdrawn).toMatchObject({ by: { name: 'Test User' } })
    expect(String(newer!.editionFamily)).toBe(String(stored._id))
    expect(String(older!.editionFamily)).toBe(String(stored._id))
    expect(labelOf(upload._id)).toMatchObject({ status: 'active' })
    expect(labelOf(stored._id)).toMatchObject({ status: 'withdrawn' })
    expect(response.body.document.newerEdition).toBeNull()
  })

  it("reuses the stored edition's family, and keeps an earlier withdrawal record", async () => {
    const family = new Types.ObjectId()
    const at = new Date('2025-05-05')
    const { stored, upload } = await editionPair('newer_edition', {
      editionFamily: family,
      withdrawn: { at, by: { id: 'x', name: 'Someone' } },
    })

    await decide(upload._id, 'supersede')

    expect(String((await reload(upload._id))!.editionFamily)).toBe(String(family))
    expect((await reload(stored._id))!.withdrawn).toMatchObject({ by: { name: 'Someone' } })
  })

  it('refuses while another edition in the family is still active', async () => {
    const family = new Types.ObjectId()
    const gone = { at: new Date(), by: { id: 'x', name: 'X' } }
    await seed({ editionFamily: family, edition: '2022', title: 'NFPA 13 live' })
    const { upload } = await editionPair('newer_edition', {
      editionFamily: family,
      withdrawn: gone,
    })

    const response = await decide(upload._id, 'supersede')

    expect(response.status).toBe(409)
    expect(response.body.error).toBe('Withdraw NFPA 13 live (2022 edition) first.')
    expect((await reload(upload._id))!.match).toMatchObject({ kind: 'newer_edition' })
  })

  it('restores both documents and answers 503 when search cannot be updated', async () => {
    const { stored, upload } = await editionPair()
    fail = ['/labels']

    const response = await decide(upload._id, 'supersede')

    expect(response.status).toBe(503)
    const [newer, older] = [await reload(upload._id), await reload(stored._id)]
    expect(newer!.match).toMatchObject({ kind: 'newer_edition' })
    expect(newer!.editionFamily).toBeUndefined()
    expect(older!.withdrawn).toBeUndefined()
    expect(older!.editionFamily).toBeUndefined()
  })
})

describe('decision: add_as_older', () => {
  it("stores the earlier edition as withdrawn, in the stored one's family, which stays active", async () => {
    const { stored, upload } = await editionPair('earlier_edition')

    const response = await decide(upload._id, 'add_as_older')

    expect(response.status).toBe(200)
    const [older, active] = [await reload(upload._id), await reload(stored._id)]
    expect(older!.match).toBeNull()
    expect(older!.withdrawn).toMatchObject({ by: { name: 'Test User' } })
    expect(String(older!.editionFamily)).toBe(String(stored._id))
    expect(String(active!.editionFamily)).toBe(String(stored._id))
    expect(active!.withdrawn).toBeUndefined()
    expect(labelOf(upload._id)).toMatchObject({ status: 'withdrawn' })
    expect(labelOf(stored._id)).toBeUndefined()
  })

  it("also clears the other document's match when it points back", async () => {
    const { stored, upload } = await editionPair('earlier_edition')
    await KnowledgeDocumentModel.updateOne(
      { _id: stored._id },
      { match: matchTo(upload._id, 'newer_edition') },
    )

    expect((await decide(upload._id, 'add_as_older')).status).toBe(200)

    expect((await reload(stored._id))!.match).toBeFalsy()
  })
})

describe('decision: discard_new and discard_other', () => {
  it('removes passages, then the file, the ingestion job and the record, in that order', async () => {
    const { stored, upload } = await editionPair()
    await IngestionJobModel.create({
      documentId: upload._id,
      currentStage: 'complete',
      stageLog: [],
      currentStageStartedAt: new Date(),
      startedAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await decide(upload._id, 'discard_new')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ document: null })
    expect(order).toEqual(['passages', 's3'])
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `/documents/${upload._id}/passages` })
    expect(s3Deleted).toEqual([upload.file.key])
    expect(await IngestionJobModel.countDocuments()).toBe(0)
    expect(await reload(upload._id)).toBeNull()
    expect(await reload(stored._id)).not.toBeNull()
  })

  it('changes nothing and answers 503 when the passages cannot be deleted', async () => {
    const { upload } = await editionPair()
    fail = ['/passages']

    const response = await decide(upload._id, 'discard_new')

    expect(response.status).toBe(503)
    expect(s3Deleted).toEqual([])
    expect(await reload(upload._id)).not.toBeNull()
  })

  it('matches again every document that pointed at the discarded one', async () => {
    const { stored, upload } = await editionPair()
    const second = await seed({ edition: '2023', match: matchTo(upload._id) })
    await seed({ edition: '2024', match: matchTo(stored._id) })

    await decide(upload._id, 'discard_new')

    expect(calls.filter((c) => c.url.endsWith('/match')).map((c) => c.url)).toEqual([
      `/documents/${second._id}/match`,
    ])
  })

  it('discard_other removes the matched document when both need review, and answers with the kept one', async () => {
    const { stored, upload } = await editionPair('possible_copy', { unconfirmed: ['title'] })
    // The kept document's own match pointed at the removed one; /match clears it.
    onMatch = async (id) => {
      await KnowledgeDocumentModel.updateOne({ _id: id }, { match: null })
      return null
    }

    const response = await decide(upload._id, 'discard_other')

    expect(response.status).toBe(200)
    expect(response.body.document).toMatchObject({ id: String(upload._id), match: null })
    expect(await reload(stored._id)).toBeNull()
    expect(s3Deleted).toEqual([stored.file.key])
    expect(calls.map((c) => c.url)).toContain(`/documents/${upload._id}/match`)
  })

  it('still discards when matching the dependents fails, and clears their match and relabels them', async () => {
    const { upload } = await editionPair()
    const dependent = await seed({ edition: '2023', match: matchTo(upload._id) })
    fail = ['/match']

    expect((await decide(upload._id, 'discard_new')).status).toBe(200)
    expect(await reload(upload._id)).toBeNull()
    expect((await reload(dependent._id))!.match).toBeFalsy()
    expect(labelOf(dependent._id)).toMatchObject({ status: 'active' })
  })
})

describe('reinstating an edition (IN-07 AC15)', () => {
  const gone = { at: new Date(), by: { id: 'u', name: 'U' } }
  const reinstate = (id: Types.ObjectId) => api.post(`/api/knowledge-documents/${id}/reinstate`)

  it('is refused while another edition of the family is active, naming it', async () => {
    const family = new Types.ObjectId()
    const old = await seed({ editionFamily: family, withdrawn: gone })
    await seed({ edition: '2022', title: 'NFPA 13 (sprinklers)', editionFamily: family })

    const response = await reinstate(old._id)

    expect(response.status).toBe(409)
    expect(response.body.error).toBe('Withdraw NFPA 13 (sprinklers) (2022 edition) first.')
    expect((await reload(old._id))!.withdrawn).toBeDefined()
    expect(calls).toEqual([])
  })

  it('works once the active edition is withdrawn', async () => {
    const family = new Types.ObjectId()
    const old = await seed({ editionFamily: family, withdrawn: gone })
    await seed({ edition: '2022', editionFamily: family, withdrawn: gone })

    expect((await reinstate(old._id)).status).toBe(200)
  })
})

describe('keep_both takes the matched document status (IN-07 feedback)', () => {
  const gone = { at: new Date(), by: { id: 'u', name: 'U' } }

  it('withdraws the reviewed document and joins the family when the matched one is withdrawn', async () => {
    const family = new Types.ObjectId()
    const { upload } = await editionPair('possible_copy', {
      editionFamily: family,
      withdrawn: gone,
    })

    expect((await decide(upload._id, 'keep_both')).status).toBe(200)

    const saved = await reload(upload._id)
    expect(saved!.withdrawn).toMatchObject({ by: { name: 'Test User' } })
    expect(String(saved!.editionFamily)).toBe(String(family))
    expect(labelOf(upload._id)).toMatchObject({ status: 'withdrawn' })
  })

  it('withdraws without a family when the withdrawn matched document has none', async () => {
    const { upload } = await editionPair('possible_copy', { withdrawn: gone })

    await decide(upload._id, 'keep_both')

    const saved = await reload(upload._id)
    expect(saved!.withdrawn).toBeDefined()
    expect(saved!.editionFamily).toBeFalsy()
  })

  it('restores the document and answers 503 when search cannot be updated', async () => {
    const { upload } = await editionPair('possible_copy', { withdrawn: gone })
    fail = ['/labels']

    expect((await decide(upload._id, 'keep_both')).status).toBe(503)

    const saved = await reload(upload._id)
    expect(saved!.withdrawn).toBeUndefined()
    expect(saved!.match).not.toBeNull()
  })
})

describe('reinstateBlockedBy on the DTO', () => {
  const gone = { at: new Date(), by: { id: 'u', name: 'U' } }
  type Row = { id: string; reinstateBlockedBy: unknown }
  const find = (body: Row[], id: Types.ObjectId) => body.find((d) => d.id === String(id))!

  it('names the active member of a withdrawn document family', async () => {
    const family = new Types.ObjectId()
    const old = await seed({ editionFamily: family, withdrawn: gone })
    const active = await seed({ edition: '2022', title: 'NFPA 13 new', editionFamily: family })

    const { body } = await api.get('/api/knowledge-documents/ingested')

    expect(find(body, old._id)).toMatchObject({
      reinstateBlockedBy: { id: String(active._id), title: 'NFPA 13 new', edition: '2022' },
    })
    expect(find(body, active._id).reinstateBlockedBy).toBeNull()
  })

  it('is null when every member is withdrawn, or the document has no family', async () => {
    const family = new Types.ObjectId()
    const a = await seed({ editionFamily: family, withdrawn: gone })
    await seed({ edition: '2022', editionFamily: family, withdrawn: gone })
    const lone = await seed({ withdrawn: gone })

    const { body } = await api.get('/api/knowledge-documents/ingested')

    expect(find(body, a._id).reinstateBlockedBy).toBeNull()
    expect(find(body, lone._id).reinstateBlockedBy).toBeNull()
  })
})

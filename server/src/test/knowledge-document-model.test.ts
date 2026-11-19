import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const validDocument = () => ({
  _id: new Types.ObjectId(),
  title: 'NFPA 13 sprinkler standard',
  fileName: 'nfpa-13.pdf',
  file: {
    key: 'knowledge/nfpa-13.pdf',
    contentType: 'application/pdf' as const,
    size: 2048,
    sha256: 'abc',
  },
  status: 'cancelled' as const,
  metadata: {
    source_type: 'nfpa_standard' as const,
    jurisdiction: 'SG',
    facility_type: 'all',
    effective_date: new Date('2022-01-01'),
  },
})

describe('knowledge_documents model', () => {
  it('stores cancelled status and cancellation timestamps', async () => {
    const cancelRequestedAt = new Date('2026-10-09T12:00:00Z')
    const cancelledAt = new Date('2026-10-09T12:01:00Z')
    const created = await KnowledgeDocumentModel.create({
      ...validDocument(),
      cancelRequestedAt,
      cancelledAt,
    })

    const found = await KnowledgeDocumentModel.findById(created._id).lean()

    expect(found!.status).toBe('cancelled')
    expect(found!.cancelRequestedAt).toEqual(cancelRequestedAt)
    expect(found!.cancelledAt).toEqual(cancelledAt)
  })

  it('rejects an unknown ingestion status', async () => {
    await expect(
      KnowledgeDocumentModel.create({ ...validDocument(), status: 'stopped' as never }),
    ).rejects.toThrow(/validation/i)
  })
})

// PV-05: the ingestion worker saves a redacted report's mapping (tag -> the
// client detail it replaced) on the document; rag reads it. The gateway never
// loads it, so no route can send it to the browser by mistake.
describe('a knowledge document privacy mapping', () => {
  it('is left out of every read unless asked for by name', async () => {
    const { insertedId } = await KnowledgeDocumentModel.collection.insertOne({
      ...validDocument(),
      privacyMapping: { '[PERSON_1]': 'John Tan' },
    })

    const read = await KnowledgeDocumentModel.findById(insertedId).lean()

    expect(read).not.toBeNull()
    expect(read).not.toHaveProperty('privacyMapping')
  })
})

// IN-18: a standard entered clause by clause has no file. It starts as a draft
// whose passages stay out of search until it is published.
describe('a manually entered knowledge document', () => {
  const manual = (status: 'draft' | 'complete' = 'draft') => {
    const { file: _file, fileName: _fileName, ...rest } = validDocument()
    return { ...rest, _id: new Types.ObjectId(), entryMethod: 'manual' as const, status }
  }

  it('saves without a file, as a draft', async () => {
    const created = await KnowledgeDocumentModel.create(manual())

    const found = await KnowledgeDocumentModel.findById(created._id).lean()

    expect(found!.entryMethod).toBe('manual')
    expect(found!.status).toBe('draft')
    expect(found!.file).toBeUndefined()
  })

  it('still requires a file for an upload', async () => {
    const { file: _file, ...noFile } = validDocument()

    await expect(KnowledgeDocumentModel.create(noFile)).rejects.toThrow(/validation/i)
  })

  // The file fingerprint index would read a missing file as null, so a second
  // published manual document would clash with the first.
  it('lets two published manual documents sit beside each other', async () => {
    await KnowledgeDocumentModel.syncIndexes()

    await KnowledgeDocumentModel.create(manual('complete'))
    await expect(KnowledgeDocumentModel.create(manual('complete'))).resolves.toBeDefined()
  })
})

// IN-18: ingestion writes `replaces_manual` when an upload is the same edition as a manual
// entry. The gateway must still be able to save such a document (a correction, a decision).
describe('a replaces_manual match', () => {
  it('is a match kind the document saves with', async () => {
    const match = {
      kind: 'replaces_manual' as const,
      documentId: new Types.ObjectId(),
      newMatched: 0,
      newTotal: 2,
      storedMatched: 0,
      storedTotal: 1,
    }

    const created = await KnowledgeDocumentModel.create({ ...validDocument(), match })

    expect((await KnowledgeDocumentModel.findById(created._id).lean())!.match!.kind).toBe(
      'replaces_manual',
    )
  })
})

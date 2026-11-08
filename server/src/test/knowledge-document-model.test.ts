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

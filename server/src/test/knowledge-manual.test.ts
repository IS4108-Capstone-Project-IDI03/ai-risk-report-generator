// IN-18: a standard entered clause by clause, for one with no PDF to upload.
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ManualSectionModel } from '../models/manual-section.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAsRole } from './auth-test-helpers'

const queued = vi.hoisted(() => vi.fn())
vi.mock('../services/ingestion-queue.service', () => ({
  enqueueIngestion: queued,
  requeueIngestion: queued,
  removeIngestionJob: queued,
}))

useMemoryMongo()

const admin = signedInAsRole(app, 'knowledge_admin')
const engineer = signedInAsRole(app, 'risk_engineer')

const NFPA_13 = {
  sourceType: 'nfpa_standard',
  title: 'NFPA 13: Installation of Sprinkler Systems',
  edition: '2025',
  standardNumber: '13',
  effectiveDate: '2025-01-01',
  jurisdiction: 'all',
  facilityType: '',
}
const create = (details: object = NFPA_13) =>
  admin.post('/api/knowledge-documents/manual').send(details)

beforeEach(() => {
  queued.mockReset()
})

describe('POST /api/knowledge-documents/manual', () => {
  it('creates a draft with no file and queues nothing', async () => {
    const response = await create()

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      title: NFPA_13.title,
      issuingBody: 'NFPA',
      edition: '2025',
      standardNumber: '13',
      sourceType: 'nfpa_standard',
      jurisdiction: 'all',
      facilityType: 'all',
      effectiveDate: '2025-01-01',
      unconfirmed: [],
      entryMethod: 'manual',
      status: 'draft',
      fileUrl: null,
    })
    const saved = await KnowledgeDocumentModel.findById(response.body.id).lean()
    expect(saved!.file).toBeUndefined()
    expect(saved!.manualSeq).toBe(0)
    expect(queued).not.toHaveBeenCalled()
  })

  it('keeps a local standard’s own issuing body', async () => {
    const response = await create({
      ...NFPA_13,
      sourceType: 'local_standard',
      title: 'Code of Practice for Fire Precautions in Buildings',
      standardNumber: 'CP 52',
      jurisdiction: 'SG',
      issuingBody: 'SCDF',
    })

    expect(response.status).toBe(201)
    expect(response.body.issuingBody).toBe('SCDF')
  })

  it('refuses an engineer', async () => {
    await engineer.post('/api/knowledge-documents/manual').send(NFPA_13).expect(403)
  })

  it('needs the edition and standard number, which matching relies on', async () => {
    const response = await create({ ...NFPA_13, edition: undefined, standardNumber: undefined })

    expect(response.status).toBe(400)
    expect(Object.keys(response.body.fields)).toEqual(
      expect.arrayContaining(['edition', 'standardNumber']),
    )
  })

  it('takes standards only, not a past report', async () => {
    const response = await create({
      ...NFPA_13,
      sourceType: 'marsh_report',
      facilityType: 'Warehouse',
    })

    expect(response.status).toBe(400)
  })

  describe('one manual entry per standard', () => {
    it('refuses a second entry of the same edition, naming the first', async () => {
      const first = await create()

      const response = await create({ ...NFPA_13, title: 'Another title', standardNumber: ' 13 ' })

      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({
        error: expect.stringMatching(/NFPA 13 \(2025\) is already being entered/),
        documentId: first.body.id,
      })
      expect(await KnowledgeDocumentModel.countDocuments()).toBe(1)
    })

    it('counts a published entry too', async () => {
      const first = await create()
      await KnowledgeDocumentModel.updateOne({ _id: first.body.id }, { status: 'complete' })

      const response = await create()

      expect(response.status).toBe(409)
      expect(response.body.error).toMatch(/already entered manually/)
    })

    it('allows another edition, and an edition whose entry was withdrawn', async () => {
      const first = await create()
      await KnowledgeDocumentModel.updateOne(
        { _id: first.body.id },
        { status: 'complete', withdrawn: { at: new Date(), by: { id: 'u1', name: 'Sana' } } },
      )

      await create().expect(201)
      await create({ ...NFPA_13, edition: '2022', effectiveDate: '2022-01-01' }).expect(201)
    })
  })
})

describe('manual_sections', () => {
  const section = (over: object = {}) => ({
    documentId: new Types.ObjectId('6abb28ae16068a0793e99999'),
    seq: 1,
    order: 10,
    clause: '8.6.1',
    headings: ['Chapter 8 Installation'],
    text: 'Sprinklers shall be installed throughout.',
    updatedBy: { id: 'u1', name: 'Sana Patel' },
    ...over,
  })

  it('stores a clause unindexed and unchecked until it is saved through ingestion', async () => {
    const saved = await ManualSectionModel.create(section())

    expect(saved.toObject()).toMatchObject({ indexed: false, checked: false, images: [] })
  })

  it('refuses a clause number twice in one document, but not across documents', async () => {
    await ManualSectionModel.syncIndexes()
    await ManualSectionModel.create(section())

    await expect(ManualSectionModel.create(section({ seq: 2 }))).rejects.toThrow(/duplicate key/)
    await expect(
      ManualSectionModel.create(section({ documentId: new Types.ObjectId() })),
    ).resolves.toBeDefined()
  })

  it('refuses a fixed number twice in one document', async () => {
    await ManualSectionModel.syncIndexes()
    await ManualSectionModel.create(section())

    await expect(ManualSectionModel.create(section({ clause: '8.6.2' }))).rejects.toThrow(
      /duplicate key/,
    )
  })
})

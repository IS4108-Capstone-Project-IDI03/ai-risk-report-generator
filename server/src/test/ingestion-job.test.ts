import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { IngestionJobModel } from '../models/ingestion-job.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// A complete, valid job document. Individual tests override fields as needed.
const validJob = () => ({
  documentId: new Types.ObjectId(),
  currentStage: 'chunking' as const,
  pageCurrent: 12,
  pageTotal: 45,
  stageLog: [{ stage: 'parsing', startedAt: new Date(), durationMs: 1200 }],
  currentStageStartedAt: new Date(),
  startedAt: new Date(),
  updatedAt: new Date(),
})

describe('ingestion_jobs model', () => {
  it('creates a valid job and round-trips every field', async () => {
    const input = validJob()
    const created = await IngestionJobModel.create(input)

    const found = await IngestionJobModel.findById(created._id).lean()
    expect(found).not.toBeNull()
    expect(String(found!.documentId)).toBe(String(input.documentId))
    expect(found!.currentStage).toBe('chunking')
    expect(found!.pageCurrent).toBe(12)
    expect(found!.pageTotal).toBe(45)
    expect(found!.stageLog).toHaveLength(1)
    expect(found!.stageLog[0].stage).toBe('parsing')
    expect(found!.stageLog[0].durationMs).toBe(1200)
    expect(found!.currentStageStartedAt).toBeInstanceOf(Date)
    expect(found!.startedAt).toBeInstanceOf(Date)
    expect(found!.updatedAt).toBeInstanceOf(Date)
  })

  it('rejects a document missing required fields', async () => {
    const { documentId: id, currentStage: currStage, ...rest } = validJob()
    void id
    void currStage
    await expect(IngestionJobModel.create(rest)).rejects.toThrow(/validation/i)
  })

  it('rejects an unknown stage value', async () => {
    await expect(
      // Deliberately invalid stage: cast past the enum type to test the
      // schema's runtime enum validation.
      IngestionJobModel.create({ ...validJob(), currentStage: 'bogus' as never }),
    ).rejects.toThrow(/validation/i)
  })

  it('rejects two documents sharing one documentId', async () => {
    const documentId = new Types.ObjectId()
    await IngestionJobModel.create({ ...validJob(), documentId })
    await expect(IngestionJobModel.create({ ...validJob(), documentId })).rejects.toThrow(
      /duplicate key/i,
    )
  })
})

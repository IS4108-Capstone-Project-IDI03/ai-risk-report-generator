import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { IngestionJobModel } from '../models/ingestion-job.model'
import { getJobProgress, getJobProgressBatch } from '../services/ingestion-job.service'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// Seeds one job for the given document, returning its documentId as a string.
async function seedJob(overrides: Record<string, unknown> = {}): Promise<string> {
  const documentId = new Types.ObjectId()
  await IngestionJobModel.create({
    documentId,
    currentStage: 'chunking',
    pageCurrent: 20,
    pageTotal: null,
    stageLog: [{ stage: 'parsing', startedAt: new Date(), durationMs: 900 }],
    currentStageStartedAt: new Date(),
    startedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  })
  return String(documentId)
}

describe('getJobProgress', () => {
  it('returns null when no job exists', async () => {
    expect(await getJobProgress(String(new Types.ObjectId()))).toBeNull()
  })

  it('returns null for a malformed id without throwing', async () => {
    expect(await getJobProgress('not-an-object-id')).toBeNull()
  })

  it('returns the job when one exists', async () => {
    const documentId = await seedJob()
    const job = await getJobProgress(documentId)
    expect(job).not.toBeNull()
    expect(String(job!.documentId)).toBe(documentId)
    expect(job!.currentStage).toBe('chunking')
    expect(job!.pageCurrent).toBe(20)
  })
})

describe('getJobProgressBatch', () => {
  it('returns an empty map when no jobs exist', async () => {
    const map = await getJobProgressBatch([String(new Types.ObjectId())])
    expect(map.size).toBe(0)
  })

  it('maps two documents and ignores a third with no job', async () => {
    const first = await seedJob({ currentStage: 'parsing' })
    const second = await seedJob({ currentStage: 'indexing' })
    const third = String(new Types.ObjectId()) // no job seeded

    const map = await getJobProgressBatch([first, second, third, 'bad-id'])

    expect(map.size).toBe(2)
    expect(map.get(first)!.currentStage).toBe('parsing')
    expect(map.get(second)!.currentStage).toBe('indexing')
    expect(map.has(third)).toBe(false)
  })
})

import { beforeEach, expect, it, vi } from 'vitest'

const remove = vi.hoisted(() => vi.fn(async () => 1))
const add = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('bullmq', () => ({
  Queue: class {
    on() {}
    remove = remove
    add = add
  },
}))
vi.mock('../config', () => ({ config: { redisUrl: 'redis://unused' } }))

const DOC = '6abb28ae16068a0793e9962a'

beforeEach(() => {
  remove.mockClear()
  add.mockClear()
})

it('removes the document job from the ingestion queue', async () => {
  const { removeIngestionJob } = await import('../services/ingestion-queue.service')

  await removeIngestionJob(DOC)

  expect(remove).toHaveBeenCalledWith(DOC)
})

it('queues a cancellation wake-up job with a distinct id', async () => {
  const { enqueueCancellationJob } = await import('../services/ingestion-queue.service')

  await enqueueCancellationJob(DOC)

  expect(add).toHaveBeenCalledWith(
    'cancel',
    { documentId: DOC, action: 'cancel' },
    { jobId: `cancel-${DOC}`, attempts: 1, removeOnComplete: true },
  )
})

it('allows removal when BullMQ reports no matching job', async () => {
  remove.mockResolvedValueOnce(0)
  const { removeIngestionJob } = await import('../services/ingestion-queue.service')

  await expect(removeIngestionJob(DOC)).resolves.toBeUndefined()
  expect(remove).toHaveBeenCalledWith(DOC)
})

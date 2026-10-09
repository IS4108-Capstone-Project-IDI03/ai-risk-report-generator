import { beforeEach, expect, it, vi } from 'vitest'

const remove = vi.hoisted(() => vi.fn(async () => 1))
vi.mock('bullmq', () => ({
  Queue: class {
    on() {}
    remove = remove
  },
}))
vi.mock('../config', () => ({ config: { redisUrl: 'redis://unused' } }))

const DOC = '6abb28ae16068a0793e9962a'

beforeEach(() => {
  remove.mockClear()
})

it('removes the document job from the ingestion queue', async () => {
  const { removeIngestionJob } = await import('../services/ingestion-queue.service')

  await removeIngestionJob(DOC)

  expect(remove).toHaveBeenCalledWith(DOC)
})

it('allows removal when BullMQ reports no matching job', async () => {
  remove.mockResolvedValueOnce(0)
  const { removeIngestionJob } = await import('../services/ingestion-queue.service')

  await expect(removeIngestionJob(DOC)).resolves.toBeUndefined()
  expect(remove).toHaveBeenCalledWith(DOC)
})

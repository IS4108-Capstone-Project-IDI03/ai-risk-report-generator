import { beforeEach, expect, it, vi } from 'vitest'

// requeueIngestion must clear the stale BullMQ job before re-adding, because
// add() ignores a duplicate jobId. These tests mock the BullMQ Queue to observe
// the remove→add ordering without a Redis connection. (The real-Redis timeout
// behaviour of enqueueIngestion is covered separately in ingestion-queue.test.ts.)
const calls = vi.hoisted(() => [] as string[])
const remove = vi.hoisted(() => vi.fn(async () => void calls.push('remove')))
const add = vi.hoisted(() =>
  vi.fn(async (..._args: [unknown, unknown, { jobId: string }]) => void calls.push('add')),
)
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
  calls.length = 0
  remove.mockClear()
  add.mockClear()
})

it('removes the stale job before re-adding it', async () => {
  const { requeueIngestion } = await import('../services/ingestion-queue.service')

  await requeueIngestion(DOC)

  expect(remove).toHaveBeenCalledWith(DOC)
  expect(add).toHaveBeenCalledOnce()
  // The order is the whole point: a re-add before the remove would be a no-op.
  expect(calls).toEqual(['remove', 'add'])
})

it('re-adds with the document id as the job id, so one job per document holds', async () => {
  const { requeueIngestion } = await import('../services/ingestion-queue.service')

  await requeueIngestion(DOC)

  const [, , options] = add.mock.calls[0] as [unknown, unknown, { jobId: string }]
  expect(options.jobId).toBe(DOC)
})

it('still re-adds when there was no stale job to remove', async () => {
  // remove() on a non-existent job is a no-op in BullMQ; the add must still run.
  remove.mockResolvedValueOnce(undefined)
  const { requeueIngestion } = await import('../services/ingestion-queue.service')

  await requeueIngestion(DOC)

  expect(add).toHaveBeenCalledOnce()
})

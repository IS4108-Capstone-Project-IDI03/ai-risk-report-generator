import { beforeEach, expect, it, vi } from 'vitest'

// requeueIngestion adds each retry under its own job id, because add() ignores
// a duplicate jobId and remove() cannot clear a job a worker still holds (a
// cancelled run winding down). These tests mock the BullMQ Queue to observe
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

it("removes the previous attempt's job, then adds this one", async () => {
  const { requeueIngestion } = await import('../services/ingestion-queue.service')

  await requeueIngestion(DOC, 2)

  expect(remove).toHaveBeenCalledWith(`${DOC}-1`)
  expect(calls).toEqual(['remove', 'add'])
})

it("adds a retry under its own job id, not the original upload's", async () => {
  const { requeueIngestion } = await import('../services/ingestion-queue.service')

  await requeueIngestion(DOC, 1)

  expect(remove).toHaveBeenCalledWith(DOC)
  const [, , options] = add.mock.calls[0] as [unknown, unknown, { jobId: string }]
  expect(options.jobId).toBe(`${DOC}-1`)
})

it('still adds when a worker still holds the previous job', async () => {
  // remove() returns 0 for a locked (running) job; the retry must still queue.
  remove.mockResolvedValueOnce(0 as never)
  const { requeueIngestion } = await import('../services/ingestion-queue.service')

  await requeueIngestion(DOC, 1)

  expect(add).toHaveBeenCalledOnce()
})

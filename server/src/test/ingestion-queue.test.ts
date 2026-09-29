import { expect, it, vi } from 'vitest'

// Nothing listens on port 1, so this is Redis being down.
vi.mock('../config', () => ({ config: { redisUrl: 'redis://127.0.0.1:1' } }))

it('gives up queueing within a few seconds when Redis is down, instead of hanging', async () => {
  const { enqueueIngestion } = await import('../services/ingestion-queue.service')

  const started = Date.now()
  await expect(enqueueIngestion('6abb28ae16068a0793e9962a')).rejects.toThrow(
    'The ingestion queue did not respond.',
  )
  expect(Date.now() - started).toBeLessThan(5000)
}, 10_000)

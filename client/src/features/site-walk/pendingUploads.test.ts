// Tests for the pending-upload store (CP-22 AC4): what is kept, re-sent or dropped.
// Covers pendingUploads.ts.
import { describe, expect, it } from 'vitest'
import { GatewayError } from '../assessments/api'
import {
  type PendingUpload,
  type UploadStore,
  photoKey,
  recordingKey,
  uploadQueue,
} from './pendingUploads'

// A stand-in for IndexedDB: a map, like the real store's keyPath.
function fakeStore(): UploadStore & { items: Map<string, PendingUpload> } {
  const items = new Map<string, PendingUpload>()
  return {
    items,
    put: async (i) => void items.set(i.key, i),
    remove: async (k) => void items.delete(k),
    all: async () => [...items.values()],
  }
}
const recording = (seq: number, walkId = 'w1'): PendingUpload => ({
  key: recordingKey(walkId, seq),
  kind: 'recording',
  reference: 'R',
  walkId,
  seq,
  durationSec: 60,
  blob: new Blob(['a']),
})

describe('pending uploads', () => {
  it('forgets an upload only after the server confirms it', async () => {
    const store = fakeStore()
    const queue = uploadQueue(store, async () => {})
    await queue.add(recording(1))
    expect(store.items.size).toBe(0)
  })

  it('drops a photo the server can never accept', async () => {
    for (const status of [400, 404, 413, 415, 422]) {
      const store = fakeStore()
      const queue = uploadQueue(store, async () => {
        throw new GatewayError(status)
      })
      await queue.add({
        key: photoKey('w1', 'p1'),
        kind: 'photo',
        reference: 'R',
        walkId: 'w1',
        photoId: 'p1',
        recordingSeq: null,
        offsetSec: null,
        blob: new Blob(['photo']),
      })
      expect(store.items.size, String(status)).toBe(0)
    }
  })

  it.each([400, 404, 409, 413, 415, 422])(
    'keeps a recording refused with %s without retrying every flush',
    async (status) => {
      const store = fakeStore()
      let calls = 0
      const queue = uploadQueue(store, async () => {
        calls++
        throw new GatewayError(status)
      })
      const item = recording(1)
      await queue.add(item)
      expect(await queue.pending()).toEqual([item])
      await queue.flush()
      await queue.flush()
      expect(calls).toBe(1)
      expect(await queue.pending()).toEqual([item])
    },
  )

  it('keeps a recording or photo refused because the walk was finished elsewhere', async () => {
    const store = fakeStore()
    const queue = uploadQueue(store, async () => {
      throw new GatewayError(409)
    })
    await queue.add(recording(1))
    await queue.add({
      key: photoKey('w1', 'p1'),
      kind: 'photo',
      reference: 'R',
      walkId: 'w1',
      photoId: 'p1',
      recordingSeq: null,
      offsetSec: null,
      blob: new Blob(['x']),
    })
    // Neither is silently deleted: both stay in "waiting to send".
    expect([...store.items.keys()]).toEqual([recordingKey('w1', 1), photoKey('w1', 'p1')])
  })

  it('keeps an upload that may still succeed: expired session, busy, timeout, server error', async () => {
    for (const status of [401, 403, 408, 429, 500, 503]) {
      const store = fakeStore()
      const queue = uploadQueue(store, async () => {
        throw new GatewayError(status)
      })
      await queue.add(recording(1))
      expect(store.items.size, String(status)).toBe(1)
    }
  })

  it('keeps a failed upload and sends it on the next flush', async () => {
    const store = fakeStore()
    let online = false
    const sent: number[] = []
    const queue = uploadQueue(store, async (i) => {
      if (!online) throw new Error('offline')
      if (i.kind === 'recording') sent.push(i.seq)
    })
    await queue.add(recording(1))
    await queue.add(recording(2))
    expect(store.items.size).toBe(2)

    online = true
    expect(await queue.flush()).toEqual([])
    expect(sent).toEqual([1, 2])
  })

  it('keeps one copy when the same recording is saved twice', async () => {
    const store = fakeStore()
    const queue = uploadQueue(store, async () => {
      throw new Error('offline')
    })
    await queue.add(recording(1))
    await queue.add(recording(1))
    expect(store.items.size).toBe(1)
  })

  it('does not send the same upload twice at once', async () => {
    const store = fakeStore()
    let calls = 0
    let release = () => {}
    const queue = uploadQueue(store, () => new Promise<void>((r) => ((calls += 1), (release = r))))
    const adding = queue.add(recording(1))
    await Promise.resolve()
    await Promise.resolve()
    const flushing = queue.flush()
    release()
    await Promise.all([adding, flushing])
    expect(calls).toBe(1)
  })

  it('flushes only the given walk', async () => {
    const store = fakeStore()
    let online = false
    const queue = uploadQueue(store, async () => {
      if (!online) throw new Error('offline')
    })
    await queue.add(recording(1, 'w1'))
    await queue.add(recording(1, 'w2'))
    online = true
    expect(await queue.flush('w1')).toEqual([])
    expect(store.items.size).toBe(1)
  })
})

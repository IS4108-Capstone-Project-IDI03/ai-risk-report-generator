// Tests for sending kept site-walk uploads from the Observations tab (CP-22 AC4).
// Covers useKeptUploads.ts.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { photoKey, type PendingUpload, type UploadStore } from './pendingUploads'
import { useKeptUploads } from './useKeptUploads'

const photo = (reference: string, walkId: string, photoId: string): PendingUpload => ({
  key: photoKey(walkId, photoId),
  kind: 'photo',
  reference,
  walkId,
  photoId,
  recordingSeq: null,
  offsetSec: null,
  blob: new Blob(['x']),
})
function fakeStore(...list: PendingUpload[]): UploadStore & { items: Map<string, PendingUpload> } {
  const items = new Map(list.map((i) => [i.key, i]))
  return {
    items,
    put: async (i) => void items.set(i.key, i),
    remove: async (k) => void items.delete(k),
    all: async () => [...items.values()],
  }
}
let online = false
const send = vi.fn(async () => {
  if (!online) throw new Error('offline')
})

afterEach(() => {
  online = false
  send.mockClear()
})

describe('useKeptUploads', () => {
  it('sends this assessment’s kept uploads when the tab opens', async () => {
    online = true
    const store = fakeStore(photo('R1', 'w1', 'p1'), photo('R2', 'w9', 'p2'))
    const sent = vi.fn()
    renderHook(() => useKeptUploads('R1', sent, store, send))
    await waitFor(() => expect(sent).toHaveBeenCalled())
    expect([...store.items.keys()]).toEqual([photoKey('w9', 'p2')])
  })

  it('reports what is still waiting, then sends it when the connection returns', async () => {
    const store = fakeStore(photo('R1', 'w1', 'p1'))
    const { result } = renderHook(() => useKeptUploads('R1', () => {}, store, send))
    await waitFor(() => expect(result.current).toBe(1))

    online = true
    await act(async () => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(result.current).toBe(0))
    expect(store.items.size).toBe(0)
  })
})

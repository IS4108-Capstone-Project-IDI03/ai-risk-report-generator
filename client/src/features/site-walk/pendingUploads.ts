// The pending-upload store (CP-22 AC4): each finished walk recording and photo
// is kept on the device first, then sent, and only forgotten once the gateway
// confirms it. Used by the Recording screen; sends through api.ts.
// IndexedDB is the browser's own database; it survives a reload or a closed tab.
import { GatewayError } from '../assessments/api'
import { uploadPhoto, uploadRecording, type SiteWalk } from './api'

export type PendingUpload =
  | {
      key: string
      kind: 'recording'
      reference: string
      walkId: string
      seq: number
      durationSec: number
      blob: Blob
    }
  | {
      key: string
      kind: 'photo'
      reference: string
      walkId: string
      photoId: string
      recordingSeq: number | null
      offsetSec: number | null
      blob: Blob
    }

export type UploadStore = {
  put: (item: PendingUpload) => Promise<void>
  remove: (key: string) => Promise<void>
  all: () => Promise<PendingUpload[]>
}

// The same key for the same recording or photo, so saving it twice keeps one copy.
export const recordingKey = (walkId: string, seq: number) => `${walkId}/recording/${seq}`
// Returns the stable device-store key for one photo.
export const photoKey = (walkId: string, photoId: string) => `${walkId}/photo/${photoId}`

const DB = 'site-walk-uploads'
const STORE = 'pending'

// Refusals no retry can fix: bad request, gone, conflict, too large, wrong type, invalid.
const NEVER_ACCEPTED = new Set([400, 404, 409, 413, 415, 422])

// Wraps one IndexedDB request in a promise.
const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

async function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB, 1)
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' })
  return done(req)
}

// Returns a store kept in IndexedDB, or in memory where IndexedDB is missing
// or refuses (private mode): uploads still work, they just don't survive a reload.
export function deviceStore(): UploadStore {
  const memory = new Map<string, PendingUpload>()
  const db = openDb().catch(() => null)
  const tx = async (mode: IDBTransactionMode) => {
    const d = await db
    return d ? d.transaction(STORE, mode).objectStore(STORE) : null
  }
  return {
    async put(item) {
      memory.set(item.key, item)
      try {
        const s = await tx('readwrite')
        if (s) await done(s.put(item))
      } catch {
        // Kept in memory only; without this a full disk would lose the upload.
      }
    },
    async remove(key) {
      memory.delete(key)
      try {
        const s = await tx('readwrite')
        if (s) await done(s.delete(key))
      } catch {
        // Left on the device; the next send is a harmless repeat (uploads are idempotent).
      }
    },
    async all() {
      try {
        const s = await tx('readonly')
        const saved = s ? await done(s.getAll() as IDBRequest<PendingUpload[]>) : []
        const keys = new Set(saved.map((i) => i.key))
        return [...saved, ...[...memory.values()].filter((i) => !keys.has(i.key))]
      } catch {
        return [...memory.values()]
      }
    },
  }
}

// Sends one upload to the gateway.
export function sendUpload(item: PendingUpload): Promise<SiteWalk> {
  return item.kind === 'recording'
    ? uploadRecording(item.reference, item.walkId, item.seq, item.blob, item.durationSec)
    : uploadPhoto(
        item.reference,
        item.walkId,
        item.photoId,
        item.blob,
        item.recordingSeq,
        item.offsetSec,
      )
}

// Returns the queue: add() keeps then sends one upload and says whether it was
// sent; pending() lists those still kept; flush() re-sends all still kept, e.g.
// when the connection returns, and returns those still left.
export function uploadQueue(store: UploadStore, send: (item: PendingUpload) => Promise<unknown>) {
  // One send per key at a time, so a flush during an add doesn't double-send.
  const sending = new Set<string>()
  // Keep refused evidence, but retry permanent refusals only after reopening the screen.
  const refused = new Set<string>()
  async function trySend(item: PendingUpload) {
    if (sending.has(item.key) || refused.has(item.key)) return false
    sending.add(item.key)
    try {
      await send(item)
      await store.remove(item.key)
      return true
    } catch (error) {
      const status = error instanceof GatewayError ? error.status : null
      if (status && NEVER_ACCEPTED.has(status)) {
        // A refused recording may be its only copy; keep it on the device.
        if (item.kind === 'recording' || status === 409) refused.add(item.key)
        else await store.remove(item.key)
      }
      return false
    } finally {
      sending.delete(item.key)
    }
  }
  const pending = async (walkId?: string) =>
    (await store.all()).filter((i) => !walkId || i.walkId === walkId)
  return {
    async add(item: PendingUpload) {
      await store.put(item)
      return trySend(item)
    },
    pending,
    async flush(walkId?: string) {
      for (const item of await pending(walkId)) await trySend(item)
      return pending(walkId)
    },
  }
}

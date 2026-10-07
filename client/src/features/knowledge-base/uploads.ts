// The upload rows in the "Add documents" panel (IN-01, IN-05). Browser only:
// the server's list of accepted documents is separate (UploadedDocuments in
// KnowledgeBase.tsx). Choosing or dropping a file uploads it at once; its row
// goes uploading (the gateway is reading its details) → queued (accepted),
// rejected (the file is the problem) or failed (retry can help).
import { useSyncExternalStore } from 'react'
import { GatewayError } from '../assessments/api'
import { uploadKnowledgeDocument } from './api'

// A selected file and where its upload stands. `queued` means the gateway
// accepted it; its ingestion progress then shows in the uploads list.
export type Upload = {
  key: string
  file: File
  state: 'uploading' | 'queued' | 'rejected' | 'failed'
  error: string | null
}

// Kept outside React so uploads keep going, and their outcomes stay visible,
// while the admin works elsewhere in the app: React state (useState) is thrown
// away when you leave the screen, a module variable is not. A page reload
// clears them; accepted documents are in the gateway's list anyway (IN-01 D9).
let uploads: Upload[] = []
const listeners = new Set<() => void>()
let nextKey = 0

// Every change goes through set, which swaps in a new list and tells React to
// redraw. patch changes a few fields on one row.
function set(next: Upload[]) {
  uploads = next
  listeners.forEach((listener) => listener())
}
function patch(key: string, change: Partial<Upload>) {
  set(uploads.map((u) => (u.key === key ? { ...u, ...change } : u)))
}

/** Returns the current uploads and re-renders when they change. */
export function useUploads(): Upload[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => uploads,
  )
}

/** Adds a row per file and uploads each at once, independently (IN-01 AC6); returns nothing. */
export function addFiles(files: File[]) {
  const rows = files.map((file) => ({
    key: String(nextKey++),
    file,
    state: 'uploading' as const,
    error: null,
  }))
  set([...uploads, ...rows])
  // Each send catches its own errors, so one failure never stops the others.
  rows.forEach(send)
}

export function removeUpload(key: string) {
  set(uploads.filter((u) => u.key !== key))
}

/** Uploads a failed row's file again; returns nothing. */
export function retryUpload(key: string) {
  const upload = uploads.find((u) => u.key === key && u.state === 'failed')
  if (!upload) return
  const row: Upload = { ...upload, state: 'uploading', error: null }
  patch(key, row)
  void send(row)
}

// Clears accepted and rejected rows from this panel, so the next batch starts
// clean. The uploaded documents list is untouched.
export function clearFinished() {
  set(uploads.filter((u) => u.state === 'uploading' || u.state === 'failed'))
}

// Uploads one row and moves it to its next state. The rule: if retrying can
// help, failed; if only a different file can, rejected.
async function send(upload: Upload) {
  try {
    // 201: accepted. Its ingestion progress now shows in the uploaded list.
    await uploadKnowledgeDocument(upload.file)
    patch(upload.key, { state: 'queued' })
  } catch (error: unknown) {
    // Nothing wrong with the file: the gateway or ingestion is down. Keep the
    // row so the admin can upload it again.
    if (error instanceof GatewayError && (error.status === null || error.status >= 500)) {
      patch(upload.key, {
        state: 'failed',
        error:
          error.status === null
            ? 'The gateway could not be reached, so the file was not uploaded. Try again.'
            : error.message,
      })
      return
    }
    // Anything else (413 too big, 415 not a PDF, 422 will not open): the file
    // itself is the problem.
    patch(upload.key, {
      state: 'rejected',
      error: error instanceof Error ? error.message : 'The file was not uploaded.',
    })
  }
}

// For tests: forget every row between cases.
export function resetUploads() {
  set([])
}

import { useSyncExternalStore } from 'react'
import { GatewayError } from '../assessments/api'
import { uploadKnowledgeDocument, type DocumentDetails } from './api'

// A selected file and where its upload stands. `queued` means the gateway
// accepted it; its ingestion progress then shows in the uploads list.
export type Upload = {
  key: string
  file: File
  details: DocumentDetails
  state: 'draft' | 'uploading' | 'queued' | 'rejected'
  error: string | null
  fieldErrors: Record<string, string>
}

// Kept outside React so uploads keep going, and their outcomes stay visible,
// while the admin works elsewhere in the app. A page reload clears them;
// accepted documents are in the gateway's list anyway (IN-01 D9).
let uploads: Upload[] = []
const listeners = new Set<() => void>()
let nextKey = 0

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

/** Adds a draft row per file, titled from its file name; returns nothing. */
export function addFiles(files: File[]) {
  set([
    ...uploads,
    ...files.map((file) => ({
      key: String(nextKey++),
      file,
      details: {
        title: file.name.replace(/\.pdf$/i, ''),
        issuingBody: '',
        edition: '',
        effectiveDate: '',
        sourceType: '' as const,
        jurisdiction: 'SG',
        facilityType: '',
      },
      state: 'draft' as const,
      error: null,
      fieldErrors: {},
    })),
  ])
}

export function editDetails(key: string, change: Partial<DocumentDetails>) {
  const upload = uploads.find((u) => u.key === key)
  if (upload) patch(key, { details: { ...upload.details, ...change } })
}

export function removeUpload(key: string) {
  set(uploads.filter((u) => u.key !== key))
}

// Clears rows that are done with, so the next batch starts clean.
export function clearFinished() {
  set(uploads.filter((u) => u.state === 'draft' || u.state === 'uploading'))
}

async function send(upload: Upload) {
  patch(upload.key, { state: 'uploading', error: null, fieldErrors: {} })
  try {
    await uploadKnowledgeDocument(upload.file, upload.details)
    patch(upload.key, { state: 'queued' })
  } catch (error: unknown) {
    // A 400 means the details need fixing, so the row stays editable.
    if (error instanceof GatewayError && error.status === 400) {
      patch(upload.key, { state: 'draft', error: error.message, fieldErrors: error.fields })
      return
    }
    // Nothing wrong with the file: the gateway or ingestion is down. Keep the
    // row so the admin can upload it again.
    if (error instanceof GatewayError && (error.status === null || error.status >= 500)) {
      patch(upload.key, {
        state: 'draft',
        error:
          error.status === null
            ? 'The gateway could not be reached, so the file was not uploaded. Try again.'
            : error.message,
      })
      return
    }
    patch(upload.key, {
      state: 'rejected',
      error: error instanceof Error ? error.message : 'The file was not uploaded.',
    })
  }
}

/** Uploads every draft row at once, each independently (IN-01 AC6). */
export function uploadAll() {
  void Promise.all(uploads.filter((u) => u.state === 'draft').map(send))
}

// For tests: forget every row between cases.
export function resetUploads() {
  set([])
}

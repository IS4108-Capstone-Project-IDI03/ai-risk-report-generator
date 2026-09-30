// The upload rows in the "Add documents" panel (IN-01). Browser only: the
// server's list of accepted documents is separate (UploadedDocuments in
// KnowledgeBase.tsx). A row goes draft → uploading → queued (accepted) or
// rejected, or back to draft when fixing the details or retrying can help.
import { useSyncExternalStore } from 'react'
import { GatewayError } from '../assessments/api'
import { uploadKnowledgeDocument, type DocumentDetails, type SourceType } from './api'

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

/** Adds a draft row per file, titled from its file name; returns nothing. */
export function addFiles(files: File[]) {
  set([
    ...uploads,
    ...files.map((file) => ({
      key: String(nextKey++),
      file,
      // Only the source type is asked first; it decides the other fields.
      details: {
        sourceType: '' as const,
        title: file.name.replace(/\.pdf$/i, ''),
        edition: '',
        effectiveDate: '',
        jurisdiction: '',
        facilityType: '',
      },
      state: 'draft' as const,
      error: null,
      fieldErrors: {},
    })),
  ])
}

// Returns the details with the new source type and that type's defaults.
// Changing the source type starts that type's own fields afresh: a standard
// applies in all countries unless narrowed; a past report is about one site,
// most often in Singapore. Title and date suit both types, so they stay.
export function withSourceType(
  details: DocumentDetails,
  sourceType: SourceType | '',
): DocumentDetails {
  return {
    ...details,
    sourceType,
    edition: '',
    facilityType: '',
    jurisdiction: sourceType === 'marsh_report' ? 'SG' : sourceType ? 'all' : '',
  }
}

/**
 * Returns why a standard's edition is not acceptable, or null when it is.
 * It must be a year from 1900 to next year (a new edition can come out ahead
 * of the year it is named for); the gateway checks the same rule.
 */
export function editionProblem(details: DocumentDetails): string | null {
  if (details.sourceType !== 'fm_standard' && details.sourceType !== 'nfpa_standard') return null
  if (!details.edition) return 'Edition is required.'
  const nextYear = new Date().getFullYear() + 1
  const year = Number(details.edition)
  return /^\d{4}$/.test(details.edition) && year >= 1900 && year <= nextYear
    ? null
    : `Edition must be a year from 1900 to ${nextYear}.`
}

export function editDetails(key: string, change: Partial<DocumentDetails>) {
  const upload = uploads.find((u) => u.key === key)
  if (!upload) return
  const details =
    change.sourceType !== undefined && change.sourceType !== upload.details.sourceType
      ? withSourceType(upload.details, change.sourceType)
      : upload.details
  // An edited field's old error no longer applies.
  const fieldErrors = Object.fromEntries(
    Object.entries(upload.fieldErrors).filter(([field]) => !(field in change)),
  )
  patch(key, { details: { ...details, ...change }, fieldErrors })
}

export function removeUpload(key: string) {
  set(uploads.filter((u) => u.key !== key))
}

// Clears accepted and rejected rows from this panel, so the next batch starts
// clean. The uploaded documents list is untouched.
export function clearFinished() {
  set(uploads.filter((u) => u.state === 'draft' || u.state === 'uploading'))
}

// Uploads one row and moves it to its next state. The rule: if fixing the
// details or retrying can help, back to draft; if only a different file can,
// rejected.
async function send(upload: Upload) {
  // A bad edition is caught here, so the row never leaves the browser.
  const edition = editionProblem(upload.details)
  if (edition) {
    patch(upload.key, { error: null, fieldErrors: { edition } })
    return
  }
  // Lock the row and clear any error from a previous attempt.
  patch(upload.key, { state: 'uploading', error: null, fieldErrors: {} })
  try {
    // 201: accepted. Its ingestion progress now shows in the uploaded list.
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
    // Anything else (413 too big, 415 not a PDF, 422 will not open): the file
    // itself is the problem.
    patch(upload.key, {
      state: 'rejected',
      error: error instanceof Error ? error.message : 'The file was not uploaded.',
    })
  }
}

/**
 * Uploads every draft row at once, each independently (IN-01 AC6); returns nothing.
 * Each send catches its own errors, so one failure never stops the others.
 */
export function uploadAll() {
  void Promise.all(uploads.filter((u) => u.state === 'draft').map(send))
}

// For tests: forget every row between cases.
export function resetUploads() {
  set([])
}

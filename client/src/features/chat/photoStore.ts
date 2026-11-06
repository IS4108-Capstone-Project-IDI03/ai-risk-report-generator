// Photos on the chat question being written, and on each question already sent (CB-08).
// Used by components/PhotoAttach.tsx (adds and removes), components/MessagePhotos.tsx (shows),
// and api.ts, whose chat link adds the chosen photos to each send.
import { useSyncExternalStore } from 'react'

/** One photo the engineer attached: what the gateway kept, and whether faces are blurred. */
export type PendingPhoto = {
  key: string
  name: string
  id: string
  blurredId: string | null
  faces: number
  // 'blur' sends the copy with faces blurred (the default); 'asis' sends the original.
  choice: 'blur' | 'asis'
  // The file as chosen, for the thumbnail when it is sent as is.
  preview: string
}

/** A PDF attached to the question being written (CB-09). `flagged`: its text looks like instructions. */
export type PendingPdf = {
  id: string
  name: string
  pages: number
  skipped: number[]
  flagged: boolean
}

let pending: PendingPhoto[] = []
let pendingPdf: PendingPdf | null = null
const sent = new Map<string, string[]>()
const sentPdfs = new Map<string, { id: string; name: string; flagged: boolean }[]>()
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => (
  listeners.add(listener),
  () => void listeners.delete(listener)
)

/** The id to send for a photo: the blurred copy when faces are blurred, else the original. */
export const idToSend = (p: PendingPhoto) =>
  p.faces && p.blurredId && p.choice === 'blur' ? p.blurredId : p.id

export const usePending = () => useSyncExternalStore(subscribe, () => pending)
export const usePendingPdf = () => useSyncExternalStore(subscribe, () => pendingPdf)
/** The PDF a sent question carried, by its message id. */
export const useSentPdfs = (messageId: string) =>
  useSyncExternalStore(subscribe, () => sentPdfs.get(messageId))
/** Whether any question sent from this page carried a PDF (a chat holds one). */
export const useAnySentPdf = () => useSyncExternalStore(subscribe, () => sentPdfs.size > 0)

export function setPendingPdf(pdf: PendingPdf | null) {
  pendingPdf = pdf
  tell()
}
/** The photos a sent question carried, by its message id. */
export const useSentPhotos = (messageId: string) =>
  useSyncExternalStore(subscribe, () => sent.get(messageId))

/** Forgets every photo, attached or sent. For tests; the page never needs it. */
export function resetPhotos() {
  pending = []
  pendingPdf = null
  sent.clear()
  sentPdfs.clear()
  tell()
}
export function addPending(photo: PendingPhoto) {
  pending = [...pending, photo]
  tell()
}
export function updatePending(key: string, change: Partial<PendingPhoto>) {
  pending = pending.map((p) => (p.key === key ? { ...p, ...change } : p))
  tell()
}
export function removePending(key: string) {
  pending.find((p) => p.key === key && URL.revokeObjectURL(p.preview))
  pending = pending.filter((p) => p.key !== key)
  tell()
}

/**
 * Wraps the chat link's fetch: the chosen photos and PDF go with the question, are remembered under that
 * question's id so it can show them at once, and the tray is emptied. A send with no photos (a
 * retry, an edit) is passed on unchanged: the gateway reuses a retried question's saved photos.
 */
export function withPhotos(send: typeof fetch): typeof fetch {
  return (input, init) => {
    if ((!pending.length && !pendingPdf) || typeof init?.body !== 'string') return send(input, init)
    const body = JSON.parse(init.body) as { messages?: { id?: string; role?: string }[] }
    const ids = pending.map(idToSend)
    const pdf = pendingPdf
    const last = body.messages?.findLast((m) => m.role === 'user')
    if (last?.id) {
      if (ids.length) sent.set(last.id, ids)
      if (pdf) sentPdfs.set(last.id, [{ id: pdf.id, name: pdf.name, flagged: pdf.flagged }])
    }
    pending = []
    pendingPdf = null
    tell()
    return send(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        ...(ids.length && { attachments: ids }),
        ...(pdf && { pdfs: [pdf.id] }),
      }),
    })
  }
}

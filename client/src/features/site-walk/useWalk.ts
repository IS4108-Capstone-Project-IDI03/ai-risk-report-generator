// One site walk on the Recording screen (CP-22 AC2–AC4): starts or resumes the
// walk, keeps each recording and photo on the device until it is sent, saves typed
// notes, re-sends on reconnect and reload, and finishes the walk.
// Calls api.ts and pendingUploads.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { GatewayError } from '../assessments/api'
import { toast } from '../../design-system'
import { finishWalk, retryRecording, saveNote, startWalk, type SiteWalk } from './api'
import {
  deviceStore,
  photoKey,
  recordingKey,
  sendUpload,
  uploadQueue,
  type PendingUpload,
  type UploadStore,
} from './pendingUploads'
import { refusalToast } from './refusalToast'
import { walkItems } from './walkItems'
import { useWalkPolling } from './useWalkPolling'
import { hiddenKey, useWalkRemovals, type Removal } from './useWalkRemovals'

// The gateway's own reason for a refusal (a 4xx), else the plain fallback.
export const problemText = (error: unknown, fallback: string) =>
  error instanceof GatewayError && error.status && error.status < 500 ? error.message : fallback

// Returns the walk, its recordings, and the actions that keep and send them.
export function useWalk(reference: string, store?: UploadStore) {
  // `version` counts the changes made here, so a slow poll from before one is dropped.
  const [{ walk, version }, setState] = useState<{ walk: SiteWalk | null; version: number }>({
    walk: null,
    version: 0,
  })
  const [unsent, setUnsent] = useState<PendingUpload[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  // How many sends are running, so a recording on the device can read "Sending".
  const [sendingCount, setSendingCount] = useState(0)
  // Counts changes made here; a slow poll started before one is ignored.
  // The highest seq used so far, kept in step at once (not on the next render) so a note
  // saved right after a recording stops numbers after it.
  const highSeq = useRef(0)
  const apply = useCallback(
    (next: SiteWalk) => setState((s) => ({ walk: next, version: s.version + 1 })),
    [],
  )
  // A poll's walk counts only if nothing changed since the poll began.
  const applyPolled = useCallback(
    (next: SiteWalk, startedAt: number) =>
      setState((s) => (s.version === startedAt ? { ...s, walk: next } : s)),
    [],
  )
  // Every confirmed upload returns the walk, so the screen shows what the server has.
  // Made once per screen: opening IndexedDB on every render would be wasted work.
  const [queue] = useState(() =>
    uploadQueue(store ?? deviceStore(), sendUpload, {
      onSent: (walk) => apply(walk as SiteWalk),
      // The person still has the file they picked, so a refusal drops it and says why.
      onRefused: (item, error) => {
        setUnsent((u) => u.filter((i) => i.key !== item.key))
        refusalToast(item, error)
      },
    }),
  )

  // Re-sends what is still on the device and notes what is left.
  const flush = useCallback(
    async (walkId: string) => {
      setSendingCount((n) => n + 1)
      try {
        const left = await queue.flush(walkId)
        setUnsent(left)
        return left
      } finally {
        setSendingCount((n) => n - 1)
      }
    },
    [queue],
  )

  // a. Start or resume the walk, then send anything a reload left behind.
  // The walk is shown (and Record offered) only once the kept recordings are
  // listed: without this a new recording could reuse a kept one's seq and
  // overwrite it on the device.
  useEffect(() => {
    let live = true
    startWalk(reference)
      .then(async (w) => {
        const kept = await queue.pending(w.id)
        if (!live) return
        setUnsent(kept)
        apply(w)
        return flush(w.id)
      })
      .catch((e) => live && setProblem(problemText(e, 'The site walk could not be started.')))
    return () => {
      live = false
    }
  }, [reference, queue, flush, apply])

  // b. The connection is back: send what waited (AC4).
  useEffect(() => {
    if (!walk) return
    const online = () => void flush(walk.id)
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [walk, flush])

  const keep = useCallback(
    async (item: PendingUpload) => {
      if (item.kind === 'recording') highSeq.current = Math.max(highSeq.current, item.seq)
      setUnsent((u) => [...u.filter((i) => i.key !== item.key), item])
      setSendingCount((n) => n + 1)
      try {
        if (await queue.add(item)) setUnsent((u) => u.filter((i) => i.key !== item.key))
      } finally {
        setSendingCount((n) => n - 1)
      }
    },
    [queue],
  )

  // `extra` marks a picked file (Upload recording) and its own name.
  const addRecording = useCallback(
    (
      seq: number,
      blob: Blob,
      durationSec: number,
      extra: { uploaded?: boolean; name?: string } = {},
    ) => {
      if (!walk) return
      const key = recordingKey(walk.id, seq)
      return keep({
        key,
        kind: 'recording',
        reference,
        walkId: walk.id,
        seq,
        durationSec,
        blob,
        ...extra,
      })
    },
    [walk, reference, keep],
  )

  const addPhoto = useCallback(
    (blob: Blob, recordingSeq: number | null, offsetSec: number | null, name?: string) => {
      if (!walk) return
      const photoId = crypto.randomUUID()
      const key = photoKey(walk.id, photoId)
      void keep({
        key,
        kind: 'photo',
        reference,
        walkId: walk.id,
        photoId,
        recordingSeq,
        offsetSec,
        blob,
        name,
      })
    },
    [walk, reference, keep],
  )

  // Saves a note under the next seq; blank text on an existing seq removes it.
  const writeNote = useCallback(
    async (seq: number, text: string) => {
      if (!walk) return false
      setProblem(null)
      highSeq.current = Math.max(highSeq.current, seq)
      try {
        apply(await saveNote(reference, walk.id, seq, text))
        return true
      } catch (e) {
        setProblem(
          problemText(e, 'The note could not be saved. Check your connection and try again.'),
        )
        return false
      }
    },
    [walk, reference, apply],
  )
  // Takes the next seq for a recording at once, so a note still saving keeps its own
  // (without this, both shared a seq and the gateway refused the recording).
  const claimSeq = useCallback(() => ++highSeq.current, [])
  // Adds a note after everything so far, a running recording included (it claimed
  // its seq when it started); says whether it was saved.
  const addNote = useCallback((text: string) => writeNote(highSeq.current + 1, text), [writeNote])

  // Puts a failed recording back to Transcribing; it can be tried again any number of times.
  const retry = useCallback(
    async (seq: number) => {
      if (!walk) return
      try {
        apply(await retryRecording(reference, walk.id, seq))
      } catch {
        toast.error("Couldn't try again", { description: 'Check your connection' })
      }
    },
    [walk, reference, apply],
  )

  // Drops a removed item that is still only on this device from the queue and the screen,
  // and says whether a send already running got it to the server.
  const discardLocal = useCallback(
    async (removal: Removal) => {
      if (!walk || removal.kind === 'note') return false
      const key =
        removal.kind === 'recording'
          ? recordingKey(walk.id, removal.seq)
          : photoKey(walk.id, removal.id)
      const landed = await queue.discard(key)
      setUnsent((u) => u.filter((i) => i.key !== key))
      return landed
    },
    [walk, queue],
  )
  const removals = useWalkRemovals(reference, walk, apply, discardLocal)
  const { flush: flushRemovals } = removals

  // c. Finish: save any unsent note, make sure everything is sent, then finish.
  // Refused while anything is still on the device, or the walk would be read without it.
  const finish = useCallback(
    async (name: string, draft: string | null, onDraftSaved?: () => void) => {
      if (!walk) return
      setProblem(null)
      try {
        // Pending removals are deleted first, so the walk is finished without them.
        if (!(await flushRemovals())) {
          setProblem(
            'Some removed items could not be deleted. Check your connection and try again.',
          )
          return
        }
        if (draft?.trim()) {
          apply(await saveNote(reference, walk.id, highSeq.current + 1, draft))
          highSeq.current++
          // Without this, a retry after a later failure would save the same note twice.
          onDraftSaved?.()
        }
        const left = await flush(walk.id)
        if (left.length) {
          setProblem(
            'Some recordings or photos are still on this device. They are sent when you are back online; finish the walk then.',
          )
          return
        }
        apply(await finishWalk(reference, walk.id, name))
        setFinished(true)
      } catch (e) {
        setProblem(
          problemText(e, 'The walk could not be finished. Check your connection and try again.'),
        )
      }
    },
    [walk, reference, flush, apply, flushRemovals],
  )

  useWalkPolling(reference, walk, finished, version, applyPolled)

  const everyItem = walkItems(walk, unsent, sendingCount > 0)
  const items = everyItem.filter((i) => !removals.hidden.has(hiddenKey(i)))
  // The seq of the newest recording or note (removed ones included), so the next one numbers after it.
  const lastSeq = Math.max(0, ...everyItem.map((i) => i.seq))
  useEffect(() => {
    highSeq.current = Math.max(highSeq.current, lastSeq)
  }, [lastSeq])
  const serverPhotos = (walk?.photos ?? []).filter(
    (p) => !removals.hidden.has(hiddenKey({ kind: 'photo', id: p.id })),
  )
  // Photos still only on this device, once the server has not yet confirmed them.
  const localPhotos = unsent.flatMap((i) =>
    i.kind === 'photo' &&
    !(walk?.photos ?? []).some((p) => p.id === i.photoId) &&
    !removals.hidden.has(hiddenKey({ kind: 'photo', id: i.photoId }))
      ? [{ id: i.photoId, blob: i.blob }]
      : [],
  )

  return {
    walk,
    items,
    serverPhotos,
    localPhotos,
    lastSeq,
    problem,
    setProblem,
    finished,
    addRecording,
    claimSeq,
    addPhoto,
    addNote,
    editNote: writeNote,
    retry,
    remove: removals.remove,
    finish,
  }
}

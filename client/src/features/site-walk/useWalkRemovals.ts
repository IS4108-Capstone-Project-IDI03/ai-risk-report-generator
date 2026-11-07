// Removing a photo, recording or note from a walk, with 10 s to Undo (CP-22 AC19-AC22).
// The item hides at once; the delete runs after 10 s, or now on flush (Finish walk, leaving
// the screen). Used by useWalk.ts. Calls api.ts and the design system's toast.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../design-system'
import { deletePhoto, deleteRecording, saveNote, type SiteWalk } from './api'

export type Removal =
  { kind: 'recording'; seq: number } | { kind: 'note'; seq: number } | { kind: 'photo'; id: string }

const UNDO_MS = 10_000
const WORDS = { recording: 'Recording removed', note: 'Note removed', photo: 'Photo removed' }
// The key a hidden item is listed under.
export const hiddenKey = (r: Removal) =>
  r.kind === 'photo' ? `photo:${r.id}` : `${r.kind}:${r.seq}`

// Whether the walk as last read holds this item.
function isOnServer(walk: SiteWalk, removal: Removal) {
  if (removal.kind === 'note') return true
  if (removal.kind === 'photo') return walk.photos.some((p) => p.id === removal.id)
  return walk.recordings.some((r) => r.seq === removal.seq)
}

// Returns the hidden keys, remove() for a bin, and flush() that deletes everything pending now
// and says whether every delete worked.
export function useWalkRemovals(
  reference: string,
  walk: SiteWalk | null,
  apply: (walk: SiteWalk) => void,
  // Drops an item still only on this device; says whether its send reached the server.
  discardLocal: (removal: Removal) => Promise<boolean>,
) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const waiting = useRef(
    new Map<string, { removal: Removal; timer: number; toastId: string | number }>(),
  )
  // Deletes under way. Finish waits for these too; without this a slow delete could
  // land after Finish, be refused, and leave the removed item in the proposal.
  const running = useRef(new Set<Promise<boolean>>())
  const latest = useRef({ walk, apply, discardLocal })
  // Kept current after each render, so a delete 10 s later sees the walk as it is then.
  useEffect(() => {
    latest.current = { walk, apply, discardLocal }
  })

  const show = useCallback(
    (key: string, on: boolean) =>
      setHidden((s) => {
        const next = new Set(s)
        if (on) next.add(key)
        else next.delete(key)
        return next
      }),
    [],
  )

  // Deletes one item for good; on a failure it comes back with an error toast.
  const run = useCallback(
    async (removal: Removal) => {
      const { apply: put, discardLocal: drop } = latest.current
      const key = hiddenKey(removal)
      try {
        const landed = await drop(removal)
        const w = latest.current.walk
        if (!w) return true
        // Never reached the server, so there is nothing to delete. Without this a phone
        // offline would show a false error for an item already gone from the device.
        if (!landed && !isOnServer(w, removal)) return true
        if (removal.kind === 'note') put(await saveNote(reference, w.id, removal.seq, ''))
        else if (removal.kind === 'recording')
          put(await deleteRecording(reference, w.id, removal.seq))
        else put(await deletePhoto(reference, w.id, removal.id))
        return true
      } catch {
        show(key, false)
        toast.error("Couldn't remove it", { description: 'Check your connection' })
        return false
      }
    },
    [reference, show],
  )

  // Starts one waiting delete. Its toast closes too, or Undo would still be offered for
  // something already going.
  const begin = useCallback(
    (key: string) => {
      const item = waiting.current.get(key)
      if (!item) return
      waiting.current.delete(key)
      window.clearTimeout(item.timer)
      toast.dismiss(item.toastId)
      const job: Promise<boolean> = run(item.removal).finally(() => running.current.delete(job))
      running.current.add(job)
    },
    [run],
  )

  const remove = useCallback(
    (removal: Removal) => {
      const key = hiddenKey(removal)
      show(key, true)
      const timer = window.setTimeout(() => begin(key), UNDO_MS)
      const toastId = toast.success(WORDS[removal.kind], {
        duration: UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            window.clearTimeout(timer)
            waiting.current.delete(key)
            show(key, false)
          },
        },
      })
      waiting.current.set(key, { removal, timer, toastId })
    },
    [begin, show],
  )

  const flush = useCallback(async () => {
    ;[...waiting.current.keys()].forEach(begin)
    const results = await Promise.all(running.current)
    return results.every(Boolean)
  }, [begin])

  // Leaving the screen deletes what is waiting, so nothing removed is left behind.
  useEffect(() => () => void flush(), [flush])

  return { hidden, remove, flush }
}

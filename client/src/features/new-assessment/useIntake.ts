// A client intake's life on the New Assessment screen (CP-23): add files or
// pasted text, read them with each file's simulated progress, reveal what was
// found, then hand over to the form; cancel; and discard what was added when
// the screen is left without creating (AC13). Called by
// screens/NewAssessment.tsx. Calls api.ts.
import { useEffect, useRef, useState } from 'react'
import { GatewayError } from '../assessments/api'
import {
  discardIntake,
  discardIntakeOnExit,
  readIntake,
  startIntake,
  type IntakeFile,
  type IntakeResult,
  type IntakeSource,
} from './api'

// About how long a pack takes to read (timing test, 3 Nov).
export const EXPECTED_SECONDS = 20
// Past this, the card says the read is slow rather than counting down.
const SLOW_SECONDS = 40
// After the result: one found item (and one file tick) every 150 ms, then both
// columns held in view for 1.5 s, the "All read" card for 3 s, then 180 ms for it
// and the blur to fade (boards 02 and 17, motion 5).
export const REVEAL_MS = 150
export const HELD_MS = 1500
export const DONE_MS = 3000
export const LEAVE_MS = 180
// Found so far shows at most this many sites and assessments (board 10).
export const FOUND_ROWS = 4

// revealing → done → leaving → ready: the form is shown only once ready.
// failed: the read went wrong; the intake is kept to try again or cancel.
type Phase =
  'idle' | 'uploading' | 'reading' | 'revealing' | 'held' | 'done' | 'leaving' | 'ready' | 'failed'
export type Intake = ReturnType<typeof useIntake>
export type Read = {
  result: IntakeResult
  sources: IntakeSource[]
  files: Record<string, { name: string; size: number }>
}

// The files a 400 or 422 lists, each with why it was refused or not read.
const filesOf = (e: unknown) =>
  e instanceof GatewayError && Array.isArray(e.detail.files)
    ? (e.detail.files as IntakeFile[])
    : null
// How many items Found so far reveals: the client, then up to 4 sites and 4 assessments.
const foundCount = (r: IntakeResult) =>
  +!!r.client.name.value +
  Math.min(FOUND_ROWS, r.sites.length) +
  Math.min(FOUND_ROWS, r.assessments.length)

/** Returns the intake's state and actions: add, retry, cancel, keep. */
export function useIntake() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [files, setFiles] = useState<IntakeFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [read, setRead] = useState<Read | null>(null)
  // Items revealed so far, after the result; files tick done at the same pace.
  const [revealed, setRevealed] = useState(0)
  // What was added, kept to show while uploading and to add more files to.
  const [added, setAdded] = useState<{ files: File[]; text: string }>({ files: [], text: '' })
  // The intake on the gateway, kept until created or discarded.
  const id = useRef<string | null>(null)
  const kept = useRef(false)
  // The upload or read in flight, aborted by Cancel and by leaving the screen.
  const reading = useRef<AbortController | null>(null)

  // Seconds since reading began, for the simulated status words.
  useEffect(() => {
    if (phase !== 'reading') return
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  // The reveal, then the done card, then the form (motions 3 and 5).
  const total = read
    ? Math.max(foundCount(read.result), Object.keys(read.files).length + +!!added.text.trim())
    : 0
  useEffect(() => {
    if (phase === 'revealing') {
      // The last item (or none at all) moves on to the held pause, then the done card.
      const last = revealed + 1 >= total
      const t = setTimeout(
        () => {
          setRevealed((n) => n + 1)
          if (last) setPhase('held')
        },
        revealed >= total ? 0 : REVEAL_MS,
      )
      return () => clearTimeout(t)
    }
    if (phase === 'held') {
      const t = setTimeout(() => setPhase('done'), HELD_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'done' || phase === 'leaving') {
      const t = setTimeout(
        () => setPhase(phase === 'done' ? 'leaving' : 'ready'),
        phase === 'done' ? DONE_MS : LEAVE_MS,
      )
      return () => clearTimeout(t)
    }
  }, [phase, revealed, total])

  // Leaving the screen (Back, the navigation, Cancel) unmounts it; closing the
  // tab fires pagehide. Either way an intake not created is discarded, so
  // half-finished uploads don't pile up (best effort; a daily job sweeps the rest).
  useEffect(() => {
    // A page kept in the back-forward cache (persisted) may come back, so it keeps its intake.
    const onExit = (e: PageTransitionEvent) => {
      if (!e.persisted && id.current && !kept.current) discardIntakeOnExit(id.current)
    }
    window.addEventListener('pagehide', onExit)
    return () => {
      window.removeEventListener('pagehide', onExit)
      reading.current?.abort()
      if (id.current && !kept.current) void discardIntake(id.current).catch(() => {})
    }
  }, [])

  // Stops whatever is in flight and discards the intake.
  function drop() {
    reading.current?.abort()
    if (id.current) void discardIntake(id.current).catch(() => {})
    id.current = null
  }

  // Reads the intake; files refused at upload keep their reason in the list.
  async function readNow(refused: IntakeFile[]): Promise<Read | null> {
    const controller = new AbortController()
    reading.current = controller
    setElapsed(0)
    setRevealed(0)
    setPhase('reading')
    setError(null)
    try {
      const answer = await readIntake(id.current!, controller.signal)
      const byId = Object.fromEntries(
        answer.files.flatMap((f) => (f.id ? [[f.id, { name: f.name, size: f.size }]] : [])),
      )
      const next = { result: answer.result, sources: answer.sources ?? [], files: byId }
      setFiles([...refused, ...answer.files])
      setRead(next)
      setPhase('revealing')
      return next
    } catch (e: unknown) {
      if (controller.signal.aborted) return null
      // A 422 lists why each file could not be read.
      const listed = filesOf(e)
      if (listed) setFiles([...refused, ...listed])
      // 503 carries the privacy reason, shown as it is (AC22).
      setError(
        e instanceof GatewayError && e.status !== null
          ? e.message
          : 'The documents could not be read. Try again.',
      )
      setPhase('failed')
      return null
    }
  }

  // Uploads, then reads; refused files are listed with their reason (AC4).
  async function add(more: File[], text: string): Promise<Read | null> {
    // More files mid-read or mid-upload: one intake reads everything, so start
    // again with all (without the upload check the first files were lost).
    const all =
      id.current || phase === 'uploading'
        ? { files: [...added.files, ...more], text: text || added.text }
        : { files: more, text }
    drop()
    const controller = new AbortController()
    reading.current = controller
    setAdded(all)
    setRead(null)
    setFiles([])
    setPhase('uploading')
    setError(null)
    let intake: { id: string; files: IntakeFile[] }
    try {
      intake = await startIntake(all.files, all.text, controller.signal)
    } catch (e: unknown) {
      if (controller.signal.aborted) return null
      // A 400 says why nothing could be added, listing each file refused; a
      // 413 that the upload is over 100 MB.
      setFiles(filesOf(e) ?? [])
      setError(e instanceof Error ? e.message : 'The files could not be added.')
      setPhase('idle')
      return null
    }
    // Cancelled or left while uploading: without this the finished upload
    // would be read and left behind on the gateway.
    if (controller.signal.aborted) {
      void discardIntake(intake.id).catch(() => {})
      return null
    }
    id.current = intake.id
    setFiles(intake.files)
    return readNow(intake.files.filter((f) => f.status === 'refused'))
  }

  return {
    phase,
    files,
    added,
    read,
    revealed,
    error,
    elapsed,
    secondsLeft: Math.max(0, EXPECTED_SECONDS - elapsed),
    slow: elapsed > SLOW_SECONDS,
    id: () => id.current,
    add,
    retry: () => readNow(files.filter((f) => f.status === 'refused')),
    // Stops reading and discards the intake, back to adding files.
    cancel: () => {
      drop()
      setAdded({ files: [], text: '' })
      setFiles([])
      setRead(null)
      setError(null)
      setPhase('idle')
    },
    // Created: its documents are the client's now, so leaving keeps them.
    keep: () => {
      kept.current = true
    },
  }
}

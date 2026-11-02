// The Review screen's state (CP-22 AC9, AC10): loads the walk and the
// assessment's locations, applies the engineer's edits, autosaves the whole
// proposal (PUT proposal, debounced) and runs Create all. Calls api.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { listLocations, type SiteLocation } from '../assessments/api'
import {
  createAll,
  getWalk,
  renameWalk,
  retryWalk,
  saveProposal,
  type Proposal,
  type SiteWalk,
} from './api'
import { createProblem } from './proposal'
import { problemText } from './useWalk'

// How long after the last edit the proposal is saved.
export const AUTOSAVE_MS = 800

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'failed'

// Returns the walk, its proposal, the assessment's locations and the actions.
export function useProposal(reference: string, walkId: string) {
  const [walk, setWalk] = useState<SiteWalk | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [existing, setExisting] = useState<SiteLocation[]>([])
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [problem, setProblem] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The edits not yet saved; null once the latest is on the server.
  const unsaved = useRef<Proposal | null>(null)
  // The save on its way to the server, if any.
  const running = useRef<Promise<boolean> | null>(null)

  // a. Load the walk and the locations "Same as…" offers.
  useEffect(() => {
    const ctrl = new AbortController()
    Promise.all([getWalk(reference, walkId, ctrl.signal), listLocations(reference, ctrl.signal)])
      .then(([w, locations]) => {
        setWalk(w)
        setProposal(w.proposal)
        setExisting(locations)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setProblem(problemText(e, 'The proposal could not be loaded.'))
      })
    return () => ctrl.abort()
  }, [reference, walkId])

  // Saves the latest edits now; resolves false when the save failed.
  // One save at a time: without this an older save finishing last would
  // overwrite newer edits on the server while the screen says "Saved".
  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    while (running.current) await running.current
    const next = unsaved.current
    if (!next) return true
    setSaveState('saving')
    const run = saveProposal(reference, walkId, next).then(
      () => {
        // A later edit made while saving stays unsaved, and is saved next.
        if (unsaved.current === next) {
          unsaved.current = null
          setSaveState('saved')
        }
        return true
      },
      (e: unknown) => {
        setSaveState('failed')
        setProblem(problemText(e, 'Your changes could not be saved. Check your connection.'))
        return false
      },
    )
    running.current = run
    try {
      return await run
    } finally {
      running.current = null
    }
  }, [reference, walkId])

  // b. Every edit: show it at once, save it shortly after the last one.
  const change = useCallback(
    (edit: (p: Proposal) => Proposal) => {
      setProposal((p) => {
        if (!p) return p
        const next = edit(p)
        unsaved.current = next
        return next
      })
      setSaveState('unsaved')
      setProblem(null)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), AUTOSAVE_MS)
    },
    [save],
  )

  // Leaving the screen saves what is pending, so no edit is lost.
  useEffect(() => () => void save(), [save])

  // c. Create all: save, check, then create everything once (AC10).
  const create = useCallback(async () => {
    if (!proposal) return false
    const refused = createProblem(proposal)
    if (refused) {
      setProblem(refused)
      return false
    }
    setCreating(true)
    try {
      if (!(await save())) return false
      await createAll(reference, walkId)
      return true
    } catch (e) {
      setProblem(problemText(e, 'Nothing was created. Check your connection and try again.'))
      return false
    } finally {
      setCreating(false)
    }
  }, [proposal, save, reference, walkId])

  // Re-runs a walk whose proposal step failed.
  const retry = useCallback(async () => {
    try {
      setWalk(await retryWalk(reference, walkId))
    } catch (e) {
      setProblem(problemText(e, 'The walk could not be retried.'))
    }
  }, [reference, walkId])

  // Renames the walk (AC13); resolves to the problem in words, or null once saved.
  const rename = useCallback(
    async (name: string) => {
      try {
        const renamed = await renameWalk(reference, walkId, name)
        setWalk((w) => (w ? { ...w, name: renamed.name } : renamed))
        return null
      } catch (e) {
        return problemText(e, 'The name could not be saved. Check your connection.')
      }
    },
    [reference, walkId],
  )

  return {
    walk,
    proposal,
    existing,
    saveState,
    problem,
    setProblem,
    creating,
    change,
    save,
    create,
    retry,
    rename,
  }
}

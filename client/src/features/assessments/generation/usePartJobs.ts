// Review's view of background drafting (GN-13): which parts are drafted, which are being
// drafted now and why one failed, starting a Redraft or Regenerate, and reading Review again
// once a part's job clears. Used by screens/ReviewWorkspace.tsx. Calls useGeneration.ts and
// generation/api.ts.
import { useEffect, useRef } from 'react'
import { toast } from '../../../design-system'
import { draftPart } from './api'
import { useGeneration } from './useGeneration'

// Waiting its turn or being drafted now.
const WORKING = new Set(['queued', 'drafting'])

/** Returns the drafting state and what Review asks of it, and starts drafting a part again.
    `reload`, `reloadSummary` and `reloadOfis` read Review's own data again. */
export function usePartJobs(
  reference: string,
  reloads: { reload: () => void; reloadSummary: () => unknown; reloadOfis: () => void },
) {
  const { generation, setGeneration, loadError } = useGeneration(reference)
  const parts = generation?.parts ?? []
  const part = (id: string) => parts.find((p) => p.id === id)
  const working = (id: string) => WORKING.has(part(id)?.job ?? '')
  const checkpoint = generation?.checkpoint

  // When a part's job ends, read again what Review shows of it, so the new text (or
  // "Replacement ready") appears without a refresh. Without this, the engineer would see the
  // old draft until they reloaded the page.
  const workingKey = parts
    .filter((p) => WORKING.has(p.job ?? ''))
    .map((p) => p.id)
    .join(',')
  const workingBefore = useRef<string[]>([])
  const { reload, reloadSummary, reloadOfis } = reloads
  useEffect(() => {
    const before = workingBefore.current
    workingBefore.current = workingKey ? workingKey.split(',') : []
    const cleared = before.filter((id) => !workingBefore.current.includes(id))
    if (!cleared.length) return
    reload()
    if (cleared.includes('2')) void reloadSummary()
    if (cleared.includes('3')) reloadOfis()
  }, [workingKey, reload, reloadSummary, reloadOfis])

  // a. Starts drafting a part again and shows the state the gateway returns at once; a
  //    refusal (409: one is running, or a replacement is waiting) is a toast.
  const start = async (
    id: string,
    instruction: string | null,
    started: string,
    description: string,
    refused: string,
  ) => {
    try {
      setGeneration(await draftPart(reference, id, instruction))
      toast.success(started, { description })
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : refused)
    }
  }

  return {
    generation,
    loadError,
    // Until all 11 parts are drafted, Review leaves out Section 1, Section 2 and Appendix A
    // (rule 9). A failed read shows them, as before GN-13.
    openingHidden: generation ? generation.drafted < generation.parts.length : false,
    // Parts with background drafting waiting or running.
    working,
    workingIds: workingKey ? workingKey.split(',') : [],
    drafted: (id: string) => !!part(id)?.drafted,
    // A drafting run is redrafting this part now (it replaces the draft directly, so the
    // gateway refuses review decisions on it with 409). A Regenerate from Review is not this:
    // it makes a replacement and leaves the saved draft to work on.
    redraftedByRun: (id: string) =>
      checkpoint?.kind === 'drafting' && checkpoint.parts.includes(id) && working(id),
    // Why a drafted part's last background drafting failed; null while it is fine.
    failedWith: (id: string) => {
      const p = part(id)
      return p?.job === 'failed' && p.drafted ? (p.error ?? 'Drafting failed.') : null
    },
    // Redraft for Section 2 and Section 3.
    redraft: (id: string) =>
      start(
        id,
        null,
        `Redrafting Section ${id}`,
        'You can keep working. The bell tells you when it is ready.',
        'Redrafting could not start.',
      ),
    // Regenerate for Sections 4 to 12, with the engineer's optional instruction.
    regenerate: (id: string, name: string, instruction: string) =>
      start(
        id,
        instruction || null,
        `Regenerating ${name}`,
        'You can keep working. The bell tells you when the replacement is ready.',
        'Regenerating could not start.',
      ),
  }
}

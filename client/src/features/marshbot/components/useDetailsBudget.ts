// How much each Details block may show so the panel never scrolls (AS-06, board D1).
// Called by DetailsContent.tsx. Reads the panel body's size; changes nothing else.
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

// `links` is the last step: no previews, each block one big row that opens its list or the map.
export type Budget = { contacts: number; documents: number; places: number; links: boolean }

// From most to least: full, then fewer documents, then one of each, then links only.
const STEPS: Budget[] = [
  { contacts: 2, documents: 3, places: 4, links: false },
  { contacts: 2, documents: 2, places: 4, links: false },
  { contacts: 1, documents: 1, places: 2, links: false },
  { contacts: 0, documents: 0, places: 0, links: true },
]

/**
 * Returns the largest budget whose blocks fit the body that holds `root`. `key` changes when
 * the content does, so a block that gets longer starts again from the full budget. Off on a
 * phone, where the sheet scrolls.
 */
export function useDetailsBudget(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  key: string,
) {
  // The step reached for this content and body size; a new key or size starts again at 0.
  const [reached, setReached] = useState({ id: '', step: 0 })
  const [resized, setResized] = useState(0)
  const id = `${key}|${resized}`
  const step = enabled && reached.id === id ? reached.step : 0

  // Measure after each draw, before the screen paints: too tall means one step less, drawn
  // again at once. Without this a body that is too short would cut off the bottom block, unseen.
  // It stops by itself: each pass either fits or moves one step along STEPS.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs every render on purpose
  useLayoutEffect(() => {
    const body = root.current?.parentElement
    if (!enabled || !body || step >= STEPS.length - 1) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measure, then adjust, before paint
    if (body.scrollHeight > body.clientHeight + 1) setReached({ id, step: step + 1 })
  })

  // A taller or shorter window changes how much fits.
  useEffect(() => {
    const body = root.current?.parentElement
    if (!enabled || !body || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => setResized((n) => n + 1))
    watch.observe(body)
    return () => watch.disconnect()
  }, [root, enabled])

  return STEPS[step]
}

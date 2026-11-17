// Whether the Overview's area is too narrow for the rail beside a readable conversation (AS-06
// round 9): the rail then folds into the stage bar on top, as on a phone. Not a CSS container
// query: a container makes its fixed-position children (the bar, the calendar) fixed to itself.
// Called by screens/MarshBotOverview.tsx.
import { useLayoutEffect, useState, type RefObject } from 'react'
import { RAIL_AREA_MIN } from './settings'

/** Returns true while the element in `ref` is narrower than the rail plus a readable thread. */
export function useNarrowArea(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // A width of 0 means no layout (a test, a hidden tab): keep the rail.
    const judge = (width: number) => setNarrow(width > 0 && width < RAIL_AREA_MIN)
    // Measured before the first paint, so a narrow Overview never flashes the rail.
    judge(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => judge(el.getBoundingClientRect().width))
    watch.observe(el)
    return () => watch.disconnect()
  }, [ref])
  return narrow
}

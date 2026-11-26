// Fits New Observation's two halves to the screen (CP-24, CP-37): the checklist on the right may
// grow to the window's bottom edge and no further, and is never shorter than the form on the left.
// Used by screens/SiteObservation.tsx; capture.css reads the --cap-room it sets.
import { useLayoutEffect, useRef } from 'react'

// Returns the ref for the halves' grid. --cap-room is the room from the grid's top to the bottom
// of the area that scrolls (the workspace's om-scroll), less the 16 px kept under the cards; but
// never less than the left card, so a short window scrolls the page instead of shrinking it.
export function useCaptureFit<T extends HTMLElement>() {
  const grid = useRef<T>(null)
  // Every render, since what sits above the cards (a notice) can change height.
  useLayoutEffect(() => {
    const el = grid.current
    const scroller = el?.closest<HTMLElement>('.om-scroll')
    const left = el?.firstElementChild as HTMLElement | null
    if (!el || !scroller || !left) return
    const fit = () => {
      const rest =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const room = Math.max(scroller.clientHeight - rest - 16, left.offsetHeight)
      el.style.setProperty('--cap-room', room + 'px')
    }
    fit()
    // jsdom (the tests) has no ResizeObserver; the first fit is enough there.
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(fit)
    watch.observe(scroller)
    watch.observe(left)
    // What sits above the cards can grow after this render, e.g. the site weather panel once it
    // loads or shows a warning (CP-62).
    for (let above = el.previousElementSibling; above; above = above.previousElementSibling)
      watch.observe(above)
    return () => watch.disconnect()
  })
  return grid
}

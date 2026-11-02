// Fits a sidebar-and-table layout (.ob-layout) to the screen (CP-22 round 3):
// it ends at the bottom of the area that scrolls (the workspace's om-scroll), so
// the sidebar and the table card stay put and only the table scrolls, inside its
// card. Used by the Observations tab, Site Walk Proposals and a proposal's review.
import { useLayoutEffect, useRef } from 'react'

// Returns the ref for the layout. Sets --ob-room, the height left below where
// the layout rests; observations.css sizes both panes from it from 900px.
export function useFitPane<T extends HTMLElement>() {
  const pane = useRef<T>(null)
  // Every render, since what sits above it (a header, an alert) can change height.
  useLayoutEffect(() => {
    const el = pane.current
    const scroller = el?.closest<HTMLElement>('.om-scroll')
    if (!el || !scroller) return
    const fit = () => {
      // Where it rests, from the scroller's top, whatever the scroll now.
      const rest =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      el.style.setProperty('--ob-room', scroller.clientHeight - rest + 'px')
    }
    fit()
    // jsdom (the tests) has no ResizeObserver; the first fit is enough there.
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(fit)
    watch.observe(scroller)
    return () => watch.disconnect()
  })
  return pane
}

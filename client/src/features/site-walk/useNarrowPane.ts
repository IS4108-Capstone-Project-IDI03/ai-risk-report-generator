// Whether a list screen is too narrow for its location navigator beside the list (a tablet, or a
// laptop with the sidebar open). The navigator then becomes the phone's button and sheet above the
// list. Used by the Observations tab and a site walk proposal's review (screens/Review.tsx).
import { useCallback, useState, type RefObject } from 'react'

// The navigator (248 px, observations.css .ob-layout), the gap, and the narrowest list whose
// columns still read.
const NAV_AREA_MIN = 248 + 16 + 600

/** Returns whether the measured element is narrow, and the callback ref that measures it (and
    also fills `alsoRef`, when the screen needs the element itself). A callback ref, so an element
    that comes back after another screen replaced it is measured again. */
export function useNarrowPane<T extends HTMLElement>(alsoRef?: RefObject<T | null>) {
  const [narrow, setNarrow] = useState(false)
  const measure = useCallback(
    (el: T | null) => {
      if (alsoRef) alsoRef.current = el
      // jsdom (the tests) has no ResizeObserver: the navigator stays beside the list.
      if (!el || typeof ResizeObserver === 'undefined') return
      // It reports once on observe, before the first paint, so a narrow screen never flashes
      // the side-by-side layout.
      const watch = new ResizeObserver(() => {
        const width = el.getBoundingClientRect().width
        setNarrow(width > 0 && width < NAV_AREA_MIN)
      })
      watch.observe(el)
      return () => watch.disconnect()
    },
    [alsoRef],
  )
  return [narrow, measure] as const
}

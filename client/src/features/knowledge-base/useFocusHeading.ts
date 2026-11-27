// Moves focus to a page's title when it opens, so a screen reader starts at the title (the Review
// and clauses pages, IN-07 and IN-18). The title is the top bar's h1, which has no ref, so it is
// found inside the page's own element. Used by screens/ReviewDocument.tsx and ManualSections.tsx.
import { useEffect, useRef } from 'react'

/** Returns a ref for the page's root element; its h1 takes focus once, on mount. */
export function useFocusHeading<T extends HTMLElement>() {
  const root = useRef<T>(null)
  useEffect(() => {
    const heading = root.current?.querySelector('h1')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus()
  }, [])
  return root
}

// Whether the screen is under 1024 px (tablet or phone) (CP-23 round 12).
// Called by the Assessments and Clients lists, which then put New assessment beside the bell.
import { useEffect, useState } from 'react'

// True under 1024 px (tablet and phone), where New assessment moves up beside the bell; false in tests.
/** Returns true at or under maxWidth (1023 px by default); false where matchMedia is missing (tests). */
export function useCompact(maxWidth = 1023) {
  const query = `(max-width: ${maxWidth}px)`
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const change = () => setOn(mq.matches)
    mq.addEventListener('change', change)
    return () => mq.removeEventListener('change', change)
  }, [query])
  return on
}

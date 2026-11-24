// Whether the window is 1100 px or wider (CP-37): wide enough for the checklist beside the
// recording. Called by screens/SiteObservation.tsx. False where matchMedia is missing (tests).
import { useEffect, useState } from 'react'

const QUERY = '(min-width: 1100px)'

/** Returns true at 1100 px or wider. */
export function useWideCapture() {
  const [wide, setWide] = useState(() => window.matchMedia?.(QUERY).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const change = () => setWide(mq.matches)
    mq.addEventListener('change', change)
    return () => mq.removeEventListener('change', change)
  }, [])
  return wide
}

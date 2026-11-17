// Scrolls an open observation to one of its recordings or pages (AS-06 MarshBot link).
// Called by screens/ObservationPage.tsx. The ids are on RecordingItem and PageEntry sections.
import { useEffect, useRef } from 'react'

/** Scrolls to the recording or page `id` once it is drawn, then leaves the page alone. */
export function useScrollToEvidence(id: string | undefined) {
  // Without `scrolled` a later redraw would pull the page back after the engineer scrolled away.
  const scrolled = useRef(false)
  useEffect(() => {
    if (!id || scrolled.current) return
    const target = document.getElementById('evidence-' + id)
    if (!target) return
    scrolled.current = true
    target.scrollIntoView?.({ block: 'center' })
  })
}

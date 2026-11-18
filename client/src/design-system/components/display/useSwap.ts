// Crossfade bookkeeping for the journey components (GN-13): remembers the value a component
// showed before, for as long as it fades out. Used by RowMark, NumberSwap and CheckpointHeader.
import { useEffect, useState } from 'react'

/** Returns the value it replaced (`was`, null once faded out), and `moved`: whether it has
    changed since the component mounted, so nothing animates on page load. `same` says when
    two values count as one (CheckpointHeader compares its checkpoint's key, not the words). */
export function useSwap<T>(value: T, outMs = 120, same: (a: T, b: T) => boolean = Object.is) {
  const [s, setS] = useState({ now: value, was: null as T | null, moved: false, turn: 0 })
  // Updated during render (React's "storing information from previous renders"), so the old
  // value and the new one are drawn in the same frame.
  if (!same(s.now, value)) setS({ now: value, was: s.now, moved: true, turn: s.turn + 1 })
  useEffect(() => {
    if (s.was === null) return
    // Without this, the faded-out copy would stay in the page (and in screen readers' tree).
    const t = setTimeout(() => setS((x) => (x.turn === s.turn ? { ...x, was: null } : x)), outMs)
    return () => clearTimeout(t)
  }, [s.turn, s.was, outMs])
  return { was: s.was, moved: s.moved, turn: s.turn }
}

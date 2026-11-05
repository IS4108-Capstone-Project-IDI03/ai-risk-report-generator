// A block of the New Assessment form that moves in and out (CP-23, board 17 · 3): a block added
// after the form opened fades in rising 6 px; a removed one fades out (120 ms), then the space
// closes (180 ms), then it is really removed. Used by NewAssessmentForm.tsx (site cards) and
// SiteCard.tsx (assessments). Its remove button calls `useExit()` instead of removing at once.
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'

// Runs `remove` after the block has left; plain removal when the block isn't wrapped.
const ExitContext = createContext<(remove: () => void) => void>((remove) => remove())
export const useExit = () => useContext(ExitContext)

// Blocks already there when the form opens must not animate; each Block asks this once, at mount.
export const FormOpened = createContext<{ current: boolean }>({ current: false })

export function Block({ children }: { children: ReactNode }) {
  const opened = useContext(FormOpened)
  // Fixed at mount: a block mounted after the form opened animates in; the first ones don't.
  const [late] = useState(() => opened.current)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const exit = (remove: () => void) => {
    // Reduced motion: only the 120 ms fade, no closing space.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setLeaving(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(remove, still ? 120 : 300)
  }
  return (
    <ExitContext.Provider value={exit}>
      <div
        className="na-block"
        data-leaving={leaving ? '' : undefined}
        data-late={late ? '' : undefined}
      >
        <div className="na-block-inner">{children}</div>
      </div>
    </ExitContext.Provider>
  )
}

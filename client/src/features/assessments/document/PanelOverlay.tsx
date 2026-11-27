// The document editor's side panel (Comments or Ask, RV-03 / AS-02) in a window too narrow for it
// beside the page: drawn over the page under the editor's bar (Return to review, Page layout,
// Save), over a scrim that closes it, with Tab kept inside and Esc closing it.
// Called by screens/DocumentEdit.tsx around CommentsPanel and DocumentAsk. Calls useOverlayStack.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { useOverlayStack } from '../../../design-system'

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Returns the panel as is beside the page, or over a scrim under the editor's bar when `overlay`. */
export function PanelOverlay({
  overlay,
  bar,
  onClose,
  children,
}: {
  overlay: boolean
  // The editor's sticky bar: the panel and scrim start under it, so Save stays in reach.
  bar: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  // Only the topmost overlay answers Esc: a (?) tip open inside the panel closes first.
  const isTop = useOverlayStack(overlay)
  // onClose lives in a ref, so a new function each render does not re-run the effect below.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // a. Follow the bar's bottom edge: it moves while the page scrolls, until it sticks.
  useEffect(() => {
    if (!overlay) return
    const place = () => setTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 0))
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [overlay, bar])

  // b. Focus moves into the panel and back to the opener on close; Tab stays inside; Esc closes.
  useEffect(() => {
    if (!overlay) return
    const opener = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length
      e.preventDefault()
      items[next].focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // Without this, focus would drop to the top of the page when the panel closes.
      if (opener?.isConnected) opener.focus()
    }
  }, [overlay, isTop])

  if (!overlay) return <>{children}</>
  return (
    <div
      ref={box}
      className="dm-overlay"
      style={{ '--dm-overlay-top': `${top}px` } as CSSProperties}
    >
      <div className="dm-scrim" aria-hidden="true" onClick={onClose} />
      {children}
    </div>
  )
}

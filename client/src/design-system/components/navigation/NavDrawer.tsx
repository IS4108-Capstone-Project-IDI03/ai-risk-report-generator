// The phone's navigation drawer (CP-23, board 21): the sidebar itself in a modal
// <dialog>, no × button. Esc, a tap on the scrim or a swipe left closes it; the
// browser moves focus in and back. Called by AssessmentApp. Wraps SideNav.
import { useRef, useState } from 'react'
import type * as React from 'react'
import './shell.css'

export type NavDrawerProps = { open: boolean; onClose: () => void; children: React.ReactNode }

/** Returns the drawer, or nothing while closed. */
export function NavDrawer({ open, onClose, children }: NavDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // A callback ref: opens modally as soon as the element exists.
  const attach = (el: HTMLDialogElement | null) => {
    dialog.current = el
    if (el && !el.open) el.showModal?.()
  }
  // Stays mounted while it slides out (with reduced motion, fades), then unmounts when that ends.
  const [mounted, setMounted] = useState(open)
  // jsdom has no matchMedia and fires no transitionend, so tests close at once too.
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (open && !mounted) setMounted(true)
  if (!open && mounted && !window.matchMedia) setMounted(false)
  if (!open && !mounted) return null
  return (
    <dialog
      ref={attach}
      className="ds-navdrawer navigation-drawer"
      data-closing={!open || undefined}
      onTransitionEnd={(e) => {
        if (
          !open &&
          e.target === e.currentTarget &&
          e.propertyName === (reduce ? 'opacity' : 'transform')
        )
          setMounted(false)
      }}
      aria-label="Navigation"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // The dialog fills the panel; the scrim is its ::backdrop, so a click on the
      // dialog's own edge area (outside the panel) means the scrim.
      onClick={(e) => {
        if (open && e.target === dialog.current) onClose()
      }}
      onTouchStart={(e) => (start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        // A swipe left that is more sideways than vertical (a scroll must not close it).
        const s = start.current
        const dx = s ? s.x - e.changedTouches[0].clientX : 0
        const dy = s ? Math.abs(s.y - e.changedTouches[0].clientY) : 0
        if (dx > 60 && dy < dx) onClose()
        start.current = null
      }}
    >
      {children}
    </dialog>
  )
}

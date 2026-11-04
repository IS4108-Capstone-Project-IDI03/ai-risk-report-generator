// Phone bottom sheet (CP-23, R11 More sheet / R12): grabber, title, then action rows or any content.
// Called by Popover (under 768 px), DatePicker and screens' More menus. Calls Icon, IconButton.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../core/Icon'
import { useOverlayStack } from './overlayStack'
import { IconButton } from '../core/IconButton'

export type SheetAction = {
  label: string
  icon?: string
  onSelect: () => void
  destructive?: boolean
  // Greys the row out; the reason shows under the label as a 13 px grey line.
  disabledReason?: string
  // A second grey line under the label (64 px row), e.g. what the action does.
  description?: string
}

export type SheetProps = {
  open: boolean
  onClose: () => void
  // The object's name, or "Tag this document" for a picker.
  title: string
  // Action rows (More sheet). Ends with a 48 px Cancel button.
  actions?: SheetAction[]
  // Content mode (details, pickers): any children, with a close tick beside the title.
  children?: ReactNode
  // A centred card over the scrim (fade + scale) instead of sliding up from the bottom.
  centred?: boolean
}

const EXIT_MS = 200
const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** True under 768 px wide (a phone); false where matchMedia is missing (tests). */
export function useIsPhone() {
  const query = '(max-width: 767px)'
  const [phone, setPhone] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

/** Returns the sheet, portalled to the body; renders nothing when closed (after the exit fade). */
export function Sheet({ open, onClose, title, actions, children, centred }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  // Keep it mounted for the exit motion; jsdom cannot animate, so it unmounts at once there.
  const canAnimate = typeof Element !== 'undefined' && 'animate' in Element.prototype
  const [leaving, setLeaving] = useState(false)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current || !canAnimate) return
    wasOpen.current = false
    setLeaving(true)
    const t = setTimeout(() => setLeaving(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [open, canAnimate])

  // onClose lives in a ref so a new function each render cannot re-run the focus effect.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  const isTop = useOverlayStack(open, true)

  // Focus moves in on open and returns to the opener on close; Tab stays inside; Esc closes
  // (only the topmost overlay answers).
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') return closeRef.current()
      if (e.key !== 'Tab') return
      const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length
      e.preventDefault()
      items[next].focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [open, isTop])

  if (!open && !leaving) return null
  return createPortal(
    <div
      className="ds-sheet-root"
      data-state={open ? 'open' : 'closed'}
      data-centred={centred ? '' : undefined}
    >
      <div className="ds-sheet-scrim" onClick={onClose} />
      <div ref={panel} className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="ds-sheet-grabber" aria-hidden="true" />
        <div className="ds-sheet-head">
          <h2>{title}</h2>
          {actions ? null : (
            <IconButton
              icon="check"
              label="Close"
              size="lg"
              style={{ color: 'var(--marsh-navy)' }}
              onClick={onClose}
            />
          )}
        </div>
        {actions ? (
          <>
            <div className="ds-sheet-rows">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="ds-sheet-row"
                  data-described={a.description ? '' : undefined}
                  data-destructive={a.destructive ? '' : undefined}
                  aria-disabled={a.disabledReason ? true : undefined}
                  onClick={() => {
                    if (a.disabledReason) return
                    onClose()
                    a.onSelect()
                  }}
                >
                  {a.icon ? <Icon name={a.icon} size={20} /> : null}
                  <span>
                    {a.label}
                    {a.disabledReason || a.description ? (
                      <small>{a.disabledReason ?? a.description}</small>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="ds-sheet-cancel" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <div className="ds-sheet-body">{children}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

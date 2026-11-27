import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { IconButton } from '../core/IconButton'
import { useIsPhone } from './Sheet'

export type DialogProps = {
  className?: string
  open?: boolean
  ariaLabel?: string
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  // Controls in the header, just left of Close (the passages' page range); a phone gives them
  // their own row under the title.
  headerAction?: ReactNode
  width?: number
  onClose?: () => void
  // Unsaved edits in the dialog: Esc and a backdrop click do nothing, so a stray press can't
  // throw them away; the Close button and the caller's Cancel still close.
  unsaved?: boolean
  children?: ReactNode
  style?: CSSProperties
}
// Where the browser can animate (not jsdom), a dialog fades out on closing.
const canAnimate = typeof Element !== 'undefined' && 'animate' in Element.prototype
const LEAVE_MS = 150 // must match .ds-dialog.is-leaving in kit.css

/** Shows a still copy of a closing dialog that fades out, and returns it. React removes the
    real one at once, however it closes (Cancel, the X, Esc or a confirmed action). */
function leaveCopy(element: HTMLDialogElement) {
  const copy = element.cloneNode(true) as HTMLDialogElement
  copy.classList.add('is-leaving')
  // Inert: it never takes focus or reaches a screen reader, and focus stays restorable.
  copy.inert = true
  // A clone copies attributes, not a select's chosen option: without this, Edit site's
  // dropdowns would flash their first option while it fades.
  const picks = element.querySelectorAll('select')
  copy.querySelectorAll('select').forEach((s, n) => (s.selectedIndex = picks[n].selectedIndex))
  // A cloned <audio>/<video> loads its src again, and the owner may already have revoked that
  // blob URL (Add media's queued recording): without this the console logs ERR_FILE_NOT_FOUND.
  copy.querySelectorAll('audio, video').forEach((m) => {
    m.removeAttribute('src')
    m.querySelectorAll('source').forEach((s) => s.remove())
  })
  // The copy carries the open attribute, and showModal refuses a dialog already open.
  copy.removeAttribute('open')
  document.body.append(copy)
  copy.showModal()
  return copy
}

/** True when a pointer event is on the backdrop: on the <dialog> element, outside its card. */
function isBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false
  const box = event.currentTarget.getBoundingClientRect()
  const { clientX: x, clientY: y } = event
  return x < box.left || x > box.right || y < box.top || y > box.bottom
}

export function Dialog({
  className = '',
  open = true,
  ariaLabel,
  title,
  description,
  footer,
  headerAction,
  width = 480,
  onClose,
  unsaved = false,
  children,
  style,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  // The close button is a 44 px target on a phone; its size is set inline by IconButton, so the
  // Dialog gives it the size itself.
  const phone = useIsPhone()
  const closeSize = phone ? { width: 44, height: 44 } : undefined
  // Whether the last press began on the backdrop, so a text selection dragged out of the card
  // and released outside it doesn't close the dialog.
  const pressedOutside = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const element = dialog.current
    if (!element || !open) return
    const previousFocus = document.activeElement
    element.showModal()
    return () => {
      // Only when React really removed it: StrictMode's test unmount (development) keeps the
      // node in the page, and a copy then would flash over the opening dialog.
      const copy = canAnimate && !element.isConnected ? leaveCopy(element) : null
      element.close()
      const refocus = () => {
        // preventScroll: returning focus must not scroll the page, or Ask's "Go to the passage"
        // on a phone would be scrolled back to the button that opened the sheet.
        if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
      }
      if (!copy) return refocus()
      // Focus returns once the copy is gone: while it shows, the page behind is inert.
      setTimeout(() => {
        copy.close()
        copy.remove()
        refocus()
      }, LEAVE_MS)
    }
  }, [open])
  if (!open) return null
  return (
    <dialog
      ref={dialog}
      // Every dialog wears the v2 Apple look (kit.css .ds-dialog--v2); a caller's class adds to it.
      className={`ds-dialog ds-dialog--v2 ${className}`}
      aria-label={ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      // No way to close: the browser mustn't close it either. Chrome lets a second Esc through
      // however `cancel` answers, which would leave React thinking it's still open.
      // Unsaved edits: Esc mustn't close it either.
      closedby={onClose && !unsaved ? undefined : 'none'}
      onCancel={(event) => {
        event.preventDefault()
        if (!unsaved) onClose?.()
      }}
      // A click on the backdrop closes it, as Esc does (IN-17 follow-up). The backdrop is the
      // <dialog> itself outside its box: a gap between the card's parts is inside the box.
      onPointerDown={(event) => {
        pressedOutside.current = isBackdrop(event)
      }}
      onClick={(event) => {
        if (onClose && !unsaved && pressedOutside.current && isBackdrop(event)) onClose()
        pressedOutside.current = false
      }}
      style={{ width, ...style }}
    >
      {title || description ? (
        // Keyed by the title, so a step change (Edit site to its scope check) replays the
        // header's fade (.ds-dialog .ds-dialog-header in kit.css).
        <header
          className={headerAction ? 'ds-dialog-header has-action' : 'ds-dialog-header'}
          key={typeof title === 'string' ? title : undefined}
        >
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          {headerAction && <div className="ds-dialog-header-action">{headerAction}</div>}
          {onClose && (
            <IconButton icon="x" label="Close" size="sm" style={closeSize} onClick={onClose} />
          )}
        </header>
      ) : onClose ? (
        <IconButton
          className="ds-dialog-close"
          icon="x"
          label="Close"
          size="sm"
          style={closeSize}
          onClick={onClose}
        />
      ) : null}
      {children && <div className="ds-dialog-body">{children}</div>}
      {footer && <footer className="ds-dialog-footer">{footer}</footer>}
    </dialog>
  )
}

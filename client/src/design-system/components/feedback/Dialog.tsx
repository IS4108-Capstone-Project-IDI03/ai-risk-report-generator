import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconButton } from '../core/IconButton'

export type DialogProps = {
  className?: string
  open?: boolean
  ariaLabel?: string
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  width?: number
  onClose?: () => void
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
  // The copy carries the open attribute, and showModal refuses a dialog already open.
  copy.removeAttribute('open')
  document.body.append(copy)
  copy.showModal()
  return copy
}

export function Dialog({
  className = '',
  open = true,
  ariaLabel,
  title,
  description,
  footer,
  width = 480,
  onClose,
  children,
  style,
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
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
        if (previousFocus instanceof HTMLElement) previousFocus.focus()
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
      className={`ds-dialog ${className}`}
      aria-label={ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      // No way to close: the browser mustn't close it either. Chrome lets a second Esc through
      // however `cancel` answers, which would leave React thinking it's still open.
      closedby={onClose ? undefined : 'none'}
      onCancel={(event) => {
        event.preventDefault()
        onClose?.()
      }}
      style={{ width, ...style }}
    >
      {title || description ? (
        // Keyed by the title, so a step change (Edit site to its scope check) replays the
        // header's fade (.ds-dialog .ds-dialog-header in kit.css).
        <header className="ds-dialog-header" key={typeof title === 'string' ? title : undefined}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          {onClose && <IconButton icon="x" label="Close" size="sm" onClick={onClose} />}
        </header>
      ) : onClose ? (
        <IconButton
          className="ds-dialog-close"
          icon="x"
          label="Close"
          size="sm"
          onClick={onClose}
        />
      ) : null}
      {children && <div className="ds-dialog-body">{children}</div>}
      {footer && <footer className="ds-dialog-footer">{footer}</footer>}
    </dialog>
  )
}

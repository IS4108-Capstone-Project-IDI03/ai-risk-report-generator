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
      element.close()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
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
      onCancel={(event) => {
        event.preventDefault()
        onClose?.()
      }}
      style={{ width, ...style }}
    >
      {title || description ? (
        <header className="ds-dialog-header">
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

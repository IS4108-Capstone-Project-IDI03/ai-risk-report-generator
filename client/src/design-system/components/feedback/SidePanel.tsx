// Side panel (v2, NEW pattern; the assessment's Details panel, AS-06, made shared): a record's
// details in a full-height panel flush with the window's right edge over a dimmed page on a
// computer, and a bottom sheet on a phone. Header: an optional Back, tile, the title and one grey
// line, any icon tools, Close. The footer bar, pinned to the bottom edge, holds the record's actions,
// so a short record never shows its actions at the top over empty space; the header takes only a
// round icon link that opens something else (a document's View original). The one details
// panel of the app: the assessment's Details, the client's details, a knowledge-base document and
// a user account. Calls Sheet, BackButton, IconAction, Toaster.
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { IconAction } from '../core/IconAction'
import { BackButton } from '../navigation/BackButton'
import { Toaster } from './notify'
import { Sheet, useIsPhone } from './Sheet'
import './side-panel.css'

export type SidePanelProps = {
  open: boolean
  onClose: () => void
  title: string
  // One grey line under the title ("NFPA 13 · 2022 Edition").
  subtitle?: ReactNode
  // A 40 px tile or avatar before the title (computer only; a phone sheet keeps its row for the title).
  lead?: ReactNode
  // A bar pinned to the panel's foot: the record's actions.
  footer?: ReactNode
  // Round icon actions (IconAction) in the header, just left of Close.
  tools?: ReactNode
  children: ReactNode
  // Width on a computer.
  width?: number
  // A toaster id. On a computer the panel is a modal <dialog> in the browser's top layer, which
  // covers the app's toaster: toasts sent with this `toasterId` show inside the panel instead.
  toaster?: string
  className?: string
  // A walkthrough tag (F-12) on Close, so a walkthrough can close the panel before its next step.
  closeWalk?: string
  // A sub-view (the Details panel's site map): a round Back before the title returns from it.
  back?: { label: string; onClick: () => void }
  // Unsaved edits in the panel: Esc and a backdrop click do nothing; Close still closes.
  unsaved?: boolean
}

/** Returns the side panel (or the phone sheet) while open; nothing when closed. */
export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  lead,
  footer,
  tools,
  children,
  width = 400,
  toaster,
  className,
  closeWalk,
  back,
  unsaved = false,
}: SidePanelProps) {
  const phone = useIsPhone()
  const titleId = useId()
  const pressedOnBackdrop = useRef(false)
  // What had focus when the panel opened. The dialog is removed rather than closed, so the browser
  // doesn't return focus by itself: without this it would drop to the top of the page. The cleanup
  // runs both when `open` turns false and when a caller unmounts the panel while open.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    return () => opener.current?.focus?.()
  }, [open])

  // The round Back leads the title (on a phone the sheet puts it after the title: CSS `order` moves it).
  const backButton = back && (
    <span className="ds-side-panel-back">
      <BackButton label={back.label} onClick={back.onClick} />
    </span>
  )
  if (phone)
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        subtitle={typeof subtitle === 'string' ? subtitle : undefined}
        headerAction={
          backButton || tools ? (
            <>
              {backButton}
              {tools}
            </>
          ) : undefined
        }
        closeWalk={closeWalk}
        unsaved={unsaved}
        className={className ? `ds-side-sheet ${className}` : 'ds-side-sheet'}
        footer={footer && <div className="ds-side-panel-foot">{footer}</div>}
      >
        <div className="ds-side-panel-content">{children}</div>
      </Sheet>
    )
  if (!open) return null
  return (
    <dialog
      // Opens modally as soon as it exists: the page behind dims and can't be tabbed into.
      ref={(el) => {
        if (el && !el.open) {
          opener.current = document.activeElement as HTMLElement | null
          el.showModal?.()
        }
      }}
      className={className ? `ds-side-panel ${className}` : 'ds-side-panel'}
      aria-labelledby={titleId}
      // The panel's width, which the toaster centres under (side-panel.css).
      style={{ '--ds-side-panel-w': `${width}px` } as CSSProperties}
      // Unsaved edits: the browser mustn't close it on Esc either (Chrome lets a second Esc through).
      closedby={unsaved ? 'none' : undefined}
      onCancel={(e) => {
        e.preventDefault()
        if (!unsaved) onClose()
      }}
      // Escape closes a list open over the panel (the Popover hears it too), not the panel:
      // without this one press would close both.
      onKeyDown={(e) =>
        e.key === 'Escape' && e.currentTarget.querySelector('.ds-popover') && e.preventDefault()
      }
      // A click on the dimmed backdrop (the dialog's own box, outside the card) closes it, but
      // only when the press began and ended there: a text selection dragged out stays open.
      onPointerDown={(e) => (pressedOnBackdrop.current = e.target === e.currentTarget)}
      onPointerUp={(e) => {
        if (e.target !== e.currentTarget) pressedOnBackdrop.current = false
      }}
      onClick={(e) =>
        e.target === e.currentTarget && pressedOnBackdrop.current && !unsaved && onClose()
      }
    >
      <div className="ds-side-panel-card">
        <header className="ds-side-panel-head">
          {backButton}
          {lead && <span className="ds-side-panel-lead">{lead}</span>}
          <div className="ds-side-panel-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <span className="ds-side-panel-tools">
            {tools}
            <IconAction
              icon="x"
              label="Close"
              size="md"
              placement="bottom"
              data-walk={closeWalk}
              onClick={onClose}
            />
          </span>
        </header>
        <div className="ds-side-panel-body">{children}</div>
        {footer && <footer className="ds-side-panel-foot">{footer}</footer>}
      </div>
      {toaster && <Toaster id={toaster} className="ds-side-panel-toaster" />}
    </dialog>
  )
}

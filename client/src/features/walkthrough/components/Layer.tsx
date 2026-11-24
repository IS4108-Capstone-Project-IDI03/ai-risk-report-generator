// The walkthrough's layer (F-12): a manual popover in the browser's top layer, above the page and
// any open dialog (WalkthroughHost places it inside the open modal dialog when there is one).
// Called by WalkthroughHost. Calls nothing.
import { useLayoutEffect, useRef } from 'react'

// Without popover support (jsdom) the attribute alone would hide the layer for good.
const POPOVERS = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype

// The layer itself: a manual popover, so the browser shows it in the top layer, above the page and
// any open dialog (jsdom has no popovers; there it is a plain fixed layer).
export function Layer({
  children,
  ref,
}: {
  children: React.ReactNode
  ref: (el: HTMLDivElement | null) => void
}) {
  const own = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = own.current
    // Only a connected element can open: the dialog the layer sat in may have just been removed
    // (the host moves the layer out on its next look), and a throw here would take the app down.
    if (el?.showPopover && el.isConnected && !el.matches(':popover-open')) el.showPopover()
  }, [])
  return (
    <div
      ref={(el) => {
        own.current = el
        ref(el)
      }}
      className="wt-layer"
      popover={POPOVERS ? 'manual' : undefined}
    >
      {children}
    </div>
  )
}

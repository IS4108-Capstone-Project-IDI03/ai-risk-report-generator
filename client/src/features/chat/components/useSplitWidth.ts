// The source panel's width beside the chat (CB-02): a share of the room right of the chat's
// sidebar, so collapsing either sidebar widens the chat and the panel alike. The engineer sets
// it by dragging the handle or with the arrow keys; it is remembered per tab on this browser.
// Used by CitationPanel. Sets --chat-panel-width on the chat screen, which chat.css reads.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

export type SplitMode = 'passage' | 'pdf'

// Jesper (18 Oct): the PDF splits the room half and half with the chat.
const DEFAULTS: Record<SplitMode, number> = { passage: 0.4, pdf: 0.5 }
const KEY = 'chat-panel-share'
const MIN_PANEL = 320
const MIN_CHAT = 360
const STEP = 0.05
const clampShare = (share: number) => Math.min(0.8, Math.max(0.2, share))

// Browser storage can be blocked (private windows) or hold junk; the defaults then hold.
// Without the number check, a stored "x" would make the width NaN and break the layout.
function readShares(): Record<SplitMode, number> {
  const shares = { ...DEFAULTS }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    for (const mode of ['passage', 'pdf'] as const)
      if (Number.isFinite(saved?.[mode])) shares[mode] = clampShare(saved[mode])
  } catch {
    // Unreadable: the defaults stand.
  }
  return shares
}

// The chat's sidebar width, open or collapsed. On a narrow chat OpenUI floats it over the chat
// as a drawer (--mobile); its last width beside the chat still counts then. Without that, the
// panel would grow as soon as OpenUI turned compact, and the chat could never widen back.
const OPEN_SIDEBAR = 272
let lastSidebar = OPEN_SIDEBAR
function sidebarWidth(screen: Element) {
  const docked = screen.querySelector(
    '.openui-agent-container:not(.openui-agent-container--mobile) .openui-agent-sidebar-container',
  )
  if (docked) lastSidebar = docked.getBoundingClientRect().width
  return lastSidebar
}

/** Returns the resize handle's props, and keeps the panel's width in step with the room. */
export function useSplitWidth(screen: HTMLElement | null, mode: SplitMode) {
  const [shares, setShares] = useState(readShares)
  const share = shares[mode]

  const save = useCallback(
    (next: number) =>
      setShares((all) => {
        const updated = { ...all, [mode]: clampShare(next) }
        try {
          localStorage.setItem(KEY, JSON.stringify(updated))
        } catch {
          // Not remembered; the width still applies for this visit.
        }
        return updated
      }),
    [mode],
  )

  // a. Width = share of the room, kept between the panel's and the chat's minimums, and
  //    redone whenever the screen or the chat's sidebar changes size.
  useEffect(() => {
    if (!screen) return
    const apply = () => {
      const room = screen.clientWidth - sidebarWidth(screen)
      const width = Math.max(MIN_PANEL, Math.min(room * share, room - MIN_CHAT))
      screen.style.setProperty('--chat-panel-width', `${Math.round(width)}px`)
    }
    apply()
    // jsdom (tests) has no ResizeObserver; the width is then set once.
    if (typeof ResizeObserver === 'undefined') return
    // The sidebar is found afresh each time: OpenUI may swap it when it turns compact.
    let sidebar: Element | null = null
    const observer = new ResizeObserver(() => {
      watchSidebar()
      apply()
    })
    const watchSidebar = () => {
      const now = screen.querySelector('.openui-agent-sidebar-container')
      if (now === sidebar) return
      if (sidebar) observer.unobserve(sidebar)
      if (now) observer.observe(now)
      sidebar = now
    }
    observer.observe(screen)
    watchSidebar()
    return () => {
      observer.disconnect()
      screen.style.removeProperty('--chat-panel-width')
    }
  }, [screen, share])

  // b. Dragging: the panel's left edge follows the pointer, held within the panel's and the
  //    chat's minimums (so dragging back responds at once). The body class keeps the
  //    col-resize cursor and stops text being selected while dragging (chat.css).
  const stopDrag = useRef<() => void>(() => {})
  // Closing the panel mid-drag ends the drag; otherwise the chat stays unclickable.
  useEffect(() => () => stopDrag.current(), [])
  const onPointerDown = (event: PointerEvent) => {
    if (!screen) return
    event.preventDefault()
    const box = screen.getBoundingClientRect()
    const room = box.width - sidebarWidth(screen)
    const move = (e: globalThis.PointerEvent) => {
      const width = Math.max(MIN_PANEL, Math.min(box.right - e.clientX, room - MIN_CHAT))
      save(width / room)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('chat-resizing')
    }
    stopDrag.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    document.body.classList.add('chat-resizing')
  }

  // c. Keyboard: the handle sits on the panel's left edge, so Left widens the panel.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') save(share + STEP)
    else if (event.key === 'ArrowRight') save(share - STEP)
    else return
    event.preventDefault()
  }

  return {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Resize the source panel',
    'aria-valuenow': Math.round(share * 100),
    'aria-valuemin': 20,
    'aria-valuemax': 80,
    onPointerDown,
    onKeyDown,
  }
}

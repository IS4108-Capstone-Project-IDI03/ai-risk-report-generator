import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../../../design-system'
import type { CommentAnchor } from '../comments/api'
import { passageBlocks, selectionOffsets } from './draftSelection'
import { passageAt, passageIn, type AskPassage, type AskTarget, type PassageText } from './passage'
import { ASK_KEYS, isAskShortcut } from './shortcut'

type Offer = { target: AskTarget; top: number; left: number; pressed: boolean }

// The CSS Custom Highlight API, where the browser has it: the passage is then
// marked word for word; elsewhere its blocks are tinted (review.css).
type Registry = { set(name: string, highlight: unknown): void; delete(name: string): void }
const highlights = () =>
  (globalThis.CSS as unknown as { highlights?: Registry } | undefined)?.highlights ?? null
const HighlightOf = () =>
  (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
const HIGHLIGHT = 'ask-passage'

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// "Ask about this" on text selected in the review workspace's draft editor
// (AS-02 AC1): a button by the selection, or Ctrl+Alt+K (Cmd+Option+K),
// which never clashes with Comment's Ctrl+Alt+M. Where the selection can't be
// asked about, the button is greyed out with the reason, which the shortcut
// says aloud. Also marks a passage asked about earlier, when the Ask tab
// links back to it (AC3). `host` is the draft's positioned box.
export function AskSelection({
  host,
  text,
  label,
  onAsk,
  shown,
}: {
  host: React.RefObject<HTMLElement | null>
  text: PassageText
  label: string
  onAsk: (passage: AskPassage) => void
  // The passage the Ask tab last linked back to, if in this section.
  shown: CommentAnchor | null
}) {
  const [offer, setOffer] = useState<Offer | null>(null)
  // The latest handler, so the listeners below stay put from render to render.
  const asked = useRef(onAsk)
  useEffect(() => {
    asked.current = onAsk
  })

  // The selection, read on each change and on the shortcut. Set up again only
  // when the section's text changes.
  useEffect(() => {
    // What the selection is now, if it is in the draft's text.
    const read = (): Omit<Offer, 'pressed'> | null => {
      const box = host.current
      const selection = window.getSelection()
      if (!box || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null
      const range = selection.getRangeAt(0)
      if (!box.contains(range.commonAncestorContainer)) return null
      const offsets = selectionOffsets(box, range, text)
      if (!offsets) return null
      const target = passageIn(text, offsets.start, offsets.end, label)
      const at = range.getBoundingClientRect()
      const bounds = box.getBoundingClientRect()
      const left = Math.max(0, Math.min(at.left - bounds.left, bounds.width - 168))
      return { target, top: at.bottom - bounds.top + 6, left }
    }
    let frame = 0
    const changed = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const now = read()
        setOffer(now ? { ...now, pressed: false } : null)
      })
    }
    const press = (event: KeyboardEvent) => {
      if (!isAskShortcut(event)) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const now = read()
      if (!now) return
      event.preventDefault()
      if ('passage' in now.target) {
        setOffer(null)
        asked.current(now.target.passage)
      } else setOffer({ ...now, pressed: true })
    }
    document.addEventListener('selectionchange', changed)
    window.addEventListener('keydown', press)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', changed)
      window.removeEventListener('keydown', press)
    }
  }, [host, text, label])

  // A passage linked back to from the Ask tab: marked in the draft and
  // scrolled to, once each time it is chosen.
  const scrolledTo = useRef<CommentAnchor | null>(null)
  useLayoutEffect(() => {
    const box = host.current
    const found = shown && passageAt(text, shown)
    if (!box || !shown || !found) return
    const parts = passageBlocks(box, text, found[0], found[1])
    for (const { element } of parts) element.setAttribute('data-asked', '')
    const registry = highlights()
    const Highlight = HighlightOf()
    if (registry && Highlight) registry.set(HIGHLIGHT, new Highlight(...parts.map((p) => p.range)))
    if (scrolledTo.current !== shown) {
      scrolledTo.current = shown
      parts[0]?.element.scrollIntoView?.({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    }
    return () => {
      for (const { element } of parts) element.removeAttribute('data-asked')
      registry?.delete(HIGHLIGHT)
    }
  }, [host, text, shown])

  if (!offer) return null
  const reason = 'reason' in offer.target ? offer.target.reason : undefined
  return (
    <div className="rv-ask-offer" style={{ top: offer.top, left: offer.left }}>
      <Button
        variant="secondary"
        size="sm"
        iconLeft="message-circle-question"
        aria-keyshortcuts={ASK_KEYS.aria}
        title={reason ? undefined : `Ask about this (${ASK_KEYS.label})`}
        disabledReason={reason}
        // Keeps the selection while the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!('passage' in offer.target)) return
          setOffer(null)
          onAsk(offer.target.passage)
        }}
      >
        Ask about this
      </Button>
      {reason && offer.pressed && (
        <p className="rv-ask-hint" role="status">
          {reason.title}. {reason.text}
        </p>
      )}
    </div>
  )
}

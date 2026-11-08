// Keeps a keyboard user's place when an Inbox row leaves (F-10). Used by components/InboxList.tsx.
// A row that closes up takes the focused tick or bin with it, and the browser drops the focus to
// the top of the page: without this, every tick would mean tabbing back down the list.
import { useLayoutEffect, useRef, type FocusEvent } from 'react'

/** Returns the card's ref and focus listener, for the element that holds the rows. */
export function useKeepRowFocus(ids: string[]) {
  const card = useRef<HTMLElement>(null)
  // The row the focus was last in, and where it sat in the list.
  const place = useRef<{ id: string; index: number } | null>(null)
  const onFocus = (e: FocusEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('.inbox-row')?.dataset.id
    place.current = id ? { id, index: ids.indexOf(id) } : null
  }
  // Layout effect: runs right after the row goes, before the person can press anything else.
  useLayoutEffect(() => {
    const was = place.current
    // Focus anywhere but the page itself means the person has moved on: leave it there.
    if (!was || ids.includes(was.id) || document.activeElement !== document.body) return
    place.current = null
    const rows = card.current?.querySelectorAll<HTMLElement>('.inbox-row__main')
    const next =
      rows?.[Math.min(was.index, rows.length - 1)] ??
      card.current
        ?.closest('.inbox-page')
        ?.querySelector<HTMLElement>('.inbox-tabs [aria-checked="true"]')
    next?.focus({ preventScroll: true })
  })
  return { card, onFocus }
}

// Scroll fade (v2, shared): a row that scrolls sideways (filter pills, tabs, the Settings menu
// on a phone) fades the edge that has more past it, so it reads as scrollable rather than cut
// off by accident; at the end, nothing fades. The fade itself is CSS (.ds-scroll-fade, kit.css).
// Called by Tabs, ListToolbar, the observation and photo filter rows and Settings.
import { useCallback } from 'react'

/** Sets the row's data-more to "start", "end" or "start end" for the edges with more past them. */
export function markMore(row: HTMLElement) {
  const more = [
    row.scrollLeft > 1 && 'start',
    row.scrollLeft + row.clientWidth < row.scrollWidth - 1 && 'end',
  ].filter(Boolean)
  if (more.length) row.dataset.more = more.join(' ')
  else delete row.dataset.more
}

/** Returns a callback ref that keeps a row's data-more current as it scrolls or resizes. */
export function useScrollFade<T extends HTMLElement>() {
  return useCallback((row: T | null) => {
    if (!row) return
    const mark = () => markMore(row)
    mark()
    row.addEventListener('scroll', mark, { passive: true })
    // The row and each item: a pill whose label grows ("Stage: Prepare") widens the content.
    // shortcut: items added after mount are not watched, only the row; watch them if that matters.
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark)
    watch?.observe(row)
    for (const item of row.children) watch?.observe(item)
    return () => {
      row.removeEventListener('scroll', mark)
      watch?.disconnect()
    }
  }, [])
}

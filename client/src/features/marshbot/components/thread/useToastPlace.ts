// Where toasts go while the MarshBot Overview is open (AS-06 rounds 6 and 7): centred on the
// conversation, not the whole window, and 12 px above the scrolled-away bar while it shows.
// Sets a class and two CSS variables on <body> that thread.css reads, and takes them off again
// on leaving, so every other screen keeps the app's own Toaster place.
// Called by ScrolledAway.tsx.
import { useLayoutEffect, type RefObject } from 'react'

/** Keeps the toast place in step with `column` (the conversation) and `bar` while `barShown`. */
export function useToastPlace(
  column: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLElement | null>,
  barShown: boolean,
) {
  useLayoutEffect(() => {
    const el = column.current
    if (!el) return
    const body = document.body
    const place = () => {
      const box = el.getBoundingClientRect()
      body.style.setProperty('--mbt-toast-x', `${Math.round(box.left + box.width / 2)}px`)
      // The bar sits on the conversation's foot, or the window's on a phone where the page scrolls.
      const height = barShown ? bar.current?.offsetHeight : 0
      const foot = Math.min(innerHeight, box.bottom)
      // Without the bar the toast keeps Sonner's own bottom offset (thread.css).
      if (height)
        body.style.setProperty(
          '--mbt-toast-bottom',
          `${Math.round(innerHeight - foot + height + 12)}px`,
        )
      else body.style.removeProperty('--mbt-toast-bottom')
    }
    body.classList.add('mbt-toasts')
    place()
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    watch?.observe(el)
    window.addEventListener('resize', place)
    return () => {
      watch?.disconnect()
      window.removeEventListener('resize', place)
      body.classList.remove('mbt-toasts')
      body.style.removeProperty('--mbt-toast-x')
      body.style.removeProperty('--mbt-toast-bottom')
    }
  }, [column, bar, barShown])
}

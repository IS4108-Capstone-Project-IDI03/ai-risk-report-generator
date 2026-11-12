// Where toasts go while the MarshBot Overview is open (AS-06 round 6): centred on the
// conversation column, not the whole window, and 12 px above the reply tray when there is one.
// Sets a class and two CSS variables on <body> that thread.css reads, and takes them off again
// on leaving, so every other screen keeps the app's own Toaster place.
// Called by screens/MarshBotOverview.tsx.
import { useLayoutEffect, type RefObject } from 'react'

/** Keeps the toast place in step with `column` (the conversation) and its tray, if any. */
export function useToastPlace(column: RefObject<HTMLElement | null>, hasTray: boolean) {
  useLayoutEffect(() => {
    const el = column.current
    if (!el) return
    const body = document.body
    const place = () => {
      const box = el.getBoundingClientRect()
      body.style.setProperty('--mbt-toast-x', `${Math.round(box.left + box.width / 2)}px`)
      const tray = el.querySelector('.mbt-tray')?.getBoundingClientRect()
      // Without a tray the toast keeps Sonner's own bottom offset (thread.css).
      if (tray)
        body.style.setProperty('--mbt-toast-bottom', `${Math.round(innerHeight - tray.top + 12)}px`)
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
  }, [column, hasTray])
}

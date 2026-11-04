// Takes the engineer to the first missing field after a refused Create (CP-23
// AC19, board 17 motion 1): a smooth 450 ms ease-in-out scroll that stops the
// field 96 px under the sticky top bar, then focuses its control. Called by
// screens/NewAssessmentForm.tsx.

// Must match --ease-in-out in design-system/tokens/motion.css.
const EASE: [number, number, number, number] = [0.77, 0, 0.175, 1]
const DURATION = 450
const GAP = 96

// A CSS cubic-bezier as a function of time (0-1): x(t) is solved for t by
// Newton's method, then y(t) is the eased progress.
function bezier([x1, y1, x2, y2]: typeof EASE) {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  const slope = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2
  return (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, t)
      if (Math.abs(d) < 1e-6) break
      t = Math.min(1, Math.max(0, t - (at(x1, x2, t) - x) / d))
    }
    return at(y1, y2, t)
  }
}
const ease = bezier(EASE)

/** Scrolls the field into place and focuses its first control; returns nothing. */
export function scrollToField(field: HTMLElement) {
  // A text box or select first (a date's calendar button comes before its box in the page).
  const control =
    field.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), select') ??
    field.querySelector<HTMLElement>('[role=radio]:not(:disabled), button:not(:disabled)')
  // Focus first without scrolling, so the browser's jump doesn't fight the glide.
  control?.focus({ preventScroll: true })
  const scroller = field.closest<HTMLElement>('.om-scroll') ?? document.scrollingElement
  if (!scroller) return
  const bar = document.querySelector('.na-topbar')?.getBoundingClientRect().bottom ?? 0
  const scrollerTop =
    scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
  const from = scroller.scrollTop
  const to = Math.max(
    0,
    from + field.getBoundingClientRect().top - Math.max(bar, scrollerTop) - GAP,
  )
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (still || typeof requestAnimationFrame === 'undefined' || Math.abs(to - from) < 2) {
    scroller.scrollTop = to
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const x = Math.min(1, (now - start) / DURATION)
    scroller.scrollTop = from + (to - from) * ease(x)
    if (x < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

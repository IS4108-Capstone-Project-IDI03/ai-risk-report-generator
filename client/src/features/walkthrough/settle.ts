// The settle rule (F-12, Architecture 5): a step shows only once its target exists, is visible and
// has kept the same place for 2 animation frames, with no screen transition running.
// Called by step.ts, play.ts, hands.ts and WalkthroughHost. Calls nothing.

export const SETTLE_MS = 4000

/** Returns the visible element tagged data-walk="<tag>", skipping ScreenMotion's fading copy of
    the old page (`.screen-exit`, inert), or null when there is none. */
export function findTarget(tag: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-walk="${CSS.escape(tag)}"]`)) {
    if (el.closest('.screen-exit, [inert]')) continue
    const box = el.getBoundingClientRect()
    if (!box.width || !box.height) continue
    // checkVisibility is missing in jsdom; there the size check above stands alone.
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) continue
    return el
  }
  return null
}

const placeOf = (el: HTMLElement) => {
  const box = el.getBoundingClientRect()
  return `${box.x},${box.y},${box.width},${box.height}`
}

/** Waits until every tag's element is there and still; returns them, or null after `ms`. */
export function settle(tags: string[], ms = SETTLE_MS): Promise<HTMLElement[] | null> {
  return new Promise((resolve) => {
    const end = performance.now() + ms
    let last = ''
    let still = 0
    const look = () => {
      const els = tags.map(findTarget)
      // A running screen change: the old page's copy is still fading out over the new one.
      if (els.every(Boolean) && !document.querySelector('.screen-exit')) {
        const now = (els as HTMLElement[]).map(placeOf).join('|')
        still = now === last ? still + 1 : 0
        last = now
        if (still >= 2) return resolve(els as HTMLElement[])
      } else {
        still = 0
        last = ''
      }
      if (performance.now() >= end) return resolve(null)
      requestAnimationFrame(look)
    }
    look()
  })
}

// Screen changes (CP-23, v2 section 8): the old page fades out, then the new one comes in.
// Rendered by AssessmentApp, draws nothing. The new screen is really mounted at once, so its
// data, focus and guards behave as without motion; a still copy of the old page covers it.
import { Component, type RefObject } from 'react'

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)' // must match --ease-out in tokens/motion.css

type Props = { screenKey: string; depth: number; main: RefObject<HTMLElement | null> }
type Snapshot = { parts: HTMLElement[]; scrollTop: number; box: DOMRect; from: Keyframe }

// The page is the column's header and main: the phone bar stays still.
const pageOf = (main: HTMLElement) =>
  [...(main.parentElement?.children ?? [])].filter(
    (el): el is HTMLElement => !el.matches('.ds-phonebar, .screen-exit'),
  )

// A clone copies attributes, not a select's chosen option or an open dialog's top layer.
function stillCopy(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement
  const picks = el.querySelectorAll('select')
  copy.querySelectorAll('select').forEach((s, n) => (s.selectedIndex = picks[n].selectedIndex))
  copy.querySelectorAll('dialog').forEach((d) => d.remove())
  copy.inert = true
  return copy
}

export class ScreenMotion extends Component<Props> {
  private exit: HTMLElement | null = null
  private exitEnds = 0
  private entering: Animation[] = []

  /** Returns a copy of the old page, read just before React replaces it; null when there is no exit. */
  getSnapshotBeforeUpdate(prev: Props): Snapshot | null {
    const main = this.props.main.current
    // element.animate is missing in jsdom, so tests see the new screen at once.
    if (prev.screenKey === this.props.screenKey || !main?.animate) return null
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null
    // A second navigation during the fade: the same copy keeps fading. Copying the
    // screen under it, still hidden, would flash a page nobody has seen.
    if (performance.now() < this.exitEnds) return null
    this.exit?.remove()
    const page = pageOf(main)
    const top = page[0].getBoundingClientRect().top
    const { left, width, bottom } = main.getBoundingClientRect()
    // During an entrance the page is part way in, so the fade starts from where it is.
    const { opacity, transform } = getComputedStyle(main)
    return {
      parts: page.map(stillCopy),
      scrollTop: main.scrollTop,
      box: new DOMRect(left, top, width, bottom - top),
      from: { opacity, transform },
    }
  }

  componentDidUpdate(prev: Props, _: unknown, snapshot: Snapshot | null) {
    const main = this.props.main.current
    if (prev.screenKey === this.props.screenKey || !main?.animate) return
    const { depth } = this.props
    const sibling = depth === prev.depth
    if (snapshot) this.showExit(main, snapshot, sibling ? 100 : 120)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const from = reduce
      ? 'none'
      : sibling
        ? 'translateY(6px)'
        : `translateX(${depth > prev.depth ? 16 : -16}px)`
    // Without cancelling, the last entrance would still be running on this same <main>.
    this.entering.forEach((a) => a.cancel())
    this.entering = pageOf(main).map((el) =>
      el.animate(
        [
          { opacity: 0, transform: from },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: reduce ? 120 : sibling ? 200 : 240,
          // Hidden until the old page has gone (backwards = the first frame holds while waiting).
          delay: Math.max(0, this.exitEnds - performance.now()),
          easing: EASE,
          fill: 'backwards',
        },
      ),
    )
  }

  componentWillUnmount() {
    this.exit?.remove()
  }

  // Lays the copy over the new page and fades it. The copy's parts are inert, but the layer
  // itself takes clicks: a double click must not land on the new screen while it is hidden.
  private showExit(main: HTMLElement, { parts, scrollTop, box, from }: Snapshot, duration: number) {
    const layer = document.createElement('div')
    layer.className = 'screen-exit'
    layer.setAttribute('aria-hidden', 'true')
    layer.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`
    layer.append(...parts)
    main.parentElement?.append(layer)
    parts[parts.length - 1].scrollTop = scrollTop
    this.exit = layer
    this.exitEnds = performance.now() + duration
    layer.animate([from, { opacity: 0, transform: from.transform }], {
      duration,
      easing: EASE,
    }).onfinish = () => {
      layer.remove()
    }
  }

  render() {
    return null
  }
}

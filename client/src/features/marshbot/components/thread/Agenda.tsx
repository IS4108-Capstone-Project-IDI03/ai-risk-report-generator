// The agenda above the conversation (AS-06, round 8): the stage's name, then its topics in order,
// so the engineer sees the shape of the briefing: what MarshBot has raised, what it waits on now
// and what is still to come. MarshBot still raises one topic at a time; this is the map, and a
// topic already raised is a button that jumps back to it (a skipped To Do is one press away).
// On a phone only the current topic keeps its name, and the steps are not buttons: they would be
// too small to tap, and the thread is one flick long there. Called by
// screens/MarshBotOverview.tsx. Reads the turn ids SessionTurns.tsx puts on the page.
import { useEffect, useRef } from 'react'
import { Icon, useIsPhone } from '../../../../design-system'
import { turnAnchor } from '../../format'
import type { AgendaStep } from '../../types'

const SAID: Record<AgendaStep['state'], string> = {
  done: 'done',
  open: 'still open',
  now: 'now',
  next: 'to come',
}

// Brings the topic's turn to the top of the thread and moves focus to it, so a keyboard user
// carries on from there. No glide for someone who asked for less motion. It also tells the thread
// to let go of the end (Thread.tsx listens): without that, a card growing later would snap the
// thread back down from the topic.
function jumpTo(turnId: string) {
  const turn = document.getElementById(turnAnchor(turnId))
  if (!turn) return
  turn.dispatchEvent(new Event('mbt-jump', { bubbles: true }))
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  turn.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  turn.focus({ preventScroll: true })
}

/** Returns the agenda bar; nothing when the stage has a single topic. */
export function Agenda({ steps, stage }: { steps: AgendaStep[]; stage: string }) {
  const phone = useIsPhone()
  // The steps never wrap: too many for the bar scroll sideways, and the current one is brought into
  // view (an engineer on step 4 of 5 would otherwise open to the first two).
  const list = useRef<HTMLOListElement>(null)
  const nowKey = steps.find((s) => s.state === 'now')?.key
  useEffect(() => {
    const ol = list.current
    if (!ol) return
    const fit = () => {
      // The stage's name goes when the steps don't fit beside it: at some widths it was cut to
      // "CAPT…" while the steps scrolled sideways. Measured with the name shown, then hidden.
      const bar = ol.closest('.mbt-agenda')
      bar?.removeAttribute('data-tight')
      if (ol.scrollWidth > ol.clientWidth) bar?.setAttribute('data-tight', '')
      const current = ol.querySelector<HTMLElement>('[aria-current="step"]')
      if (current) ol.scrollLeft = current.offsetLeft + current.offsetWidth - ol.clientWidth
    }
    fit()
    // Again when the bar's width changes (a resized window, the rail folding away): without this
    // the current step was cut off at the right until the next reload.
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(fit)
    // The bar, not the list: once the steps fit, the list keeps its width however wide the bar
    // gets, and the stage's name would never be measured back in.
    watch.observe(ol.parentElement ?? ol)
    return () => watch.disconnect()
    // `steps.length`: a bar that went away and came back is a new list to fit and to watch.
  }, [nowKey, phone, steps.length])
  if (!steps.length) return null
  return (
    <nav className="mbt-agenda" aria-label={`MarshBot’s topics in ${stage}`}>
      <div className="mbt-agenda-in">
        {/* The steps belong to this stage; a phone leaves the name out (the stage bar has it). */}
        <span className="mbt-agenda-stage">{stage}</span>
        <ol ref={list}>
          {steps.map((step) => {
            const inside = (
              <>
                <span className="mbt-agenda-mark" aria-hidden="true">
                  {step.state === 'done' && <Icon name="check" size={10} />}
                </span>
                <span className="mbt-agenda-name" title={step.title}>
                  {step.title}
                </span>
                <span className="mbt-sr">{`, ${SAID[step.state]}`}</span>
              </>
            )
            const turnId = phone ? null : step.turnId
            return (
              <li
                key={step.key}
                data-state={step.state}
                aria-current={step.state === 'now' ? 'step' : undefined}
              >
                {turnId ? (
                  <button type="button" className="mbt-agenda-step" onClick={() => jumpTo(turnId)}>
                    {inside}
                  </button>
                ) : (
                  <span className="mbt-agenda-step">{inside}</span>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}

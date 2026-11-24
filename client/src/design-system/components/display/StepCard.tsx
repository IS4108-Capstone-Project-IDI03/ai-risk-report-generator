// Step card (GN-13, NEW pattern): one step of a journey. A 36 px round badge with the step's
// number (navy = now, outlined grey = still to come, green = done; it keeps its number), the
// name, a line under it led by one small icon, an optional "3 of 8" with a thin bar, then the
// rows. A step still to come is dashed. Switching state fades its colours over 260 ms.
// `collapsed` (phones) folds it to one line that opens on tap. Used by Generation.
import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { Icon } from '../core/Icon'
import { NumberSwap } from './NumberSwap'
import './steps.css'

export type StepState = 'next' | 'now' | 'done'

export type StepCardProps = {
  number: number
  title: string
  state: StepState
  // The line under the name: one small icon, then a few words ("In Review").
  line?: { icon: string; text: string }
  // "3 of 8" at the right; with `progress` (0 to 1) a thin bar under the header.
  count?: { done: number; of: number }
  progress?: number
  // A drafting run is working through this step: aria-busy on the card.
  busy?: boolean
  // The one-line summary a folded card shows ("3 tasks").
  summary?: string
  collapsed?: boolean
  onExpand?: () => void
  // A help tip beside the title (F-13); left out while folded, where the header is one button.
  help?: React.ReactNode
  // The walkthrough tag of the whole card (F-12), as data-walk.
  walk?: string
  children?: React.ReactNode
}

/** Returns the card; folded, its header is a button that opens it, and focus stays on the
    header once it opens. */
export function StepCard({
  number,
  title,
  state,
  line,
  count,
  progress,
  busy = false,
  summary,
  collapsed = false,
  onExpand,
  help,
  walk,
  children,
}: StepCardProps) {
  // Opening swaps the header's button for a plain header. Without moving focus to it, focus
  // would drop to the page and a keyboard or screen reader user would lose their place.
  const opened = useRef<HTMLDivElement>(null)
  const pressed = useRef(false)
  useEffect(() => {
    if (collapsed || !pressed.current) return
    pressed.current = false
    opened.current?.focus()
  }, [collapsed])
  const head = (
    <>
      <span className="ds-step-badge" aria-hidden="true">
        {number}
      </span>
      {help && !collapsed ? (
        <span className="ds-step-titlerow">
          <h3>{title}</h3>
          {help}
        </span>
      ) : (
        <h3>{title}</h3>
      )}
      {line ? (
        <span className="ds-step-line">
          <Icon name={line.icon} size={13} />
          {line.text}
        </span>
      ) : null}
      <span className="ds-step-end">
        {count && !collapsed ? (
          <span className="ds-step-count">
            <b>
              <NumberSwap value={count.done} />
            </b>
            of {count.of}
          </span>
        ) : null}
        {summary && (collapsed || !count) ? (
          <span className="ds-step-summary">{summary}</span>
        ) : null}
        {collapsed ? <Icon name="chevron-down" size={16} /> : null}
      </span>
    </>
  )
  return (
    <section
      className="ds-step"
      data-state={state}
      aria-label={`Step ${number}: ${title}`}
      aria-busy={busy || undefined}
      data-walk={walk}
    >
      {collapsed ? (
        <button
          type="button"
          className="ds-step-head"
          aria-expanded={false}
          onClick={() => {
            pressed.current = true
            onExpand?.()
          }}
        >
          {head}
        </button>
      ) : (
        <div className="ds-step-head" ref={opened} tabIndex={-1}>
          {head}
        </div>
      )}
      {!collapsed && progress !== undefined ? (
        <div className="ds-step-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} />
        </div>
      ) : null}
      {collapsed ? null : children}
    </section>
  )
}

// Checkpoint header (GN-13, NEW pattern): one card that says who acts now (the tile), what to
// do (title and one line) and offers at most one action, with a bar under it (a SegmentBar).
// Tile tones: ai = blue (with `busy`, a small corner spinner while it works), you = amber
// person, warn = amber, bad = red, ok = green. When `swapKey` changes the old header fades out
// in 120 ms and the new one rises 4 px as it fades in over 180 ms (motion 4).
// Used by Generation. Calls useSwap.
import type * as React from 'react'
import { Icon } from '../core/Icon'
import { useSwap } from './useSwap'
import './steps.css'

export type CheckpointTone = 'ai' | 'you' | 'warn' | 'bad' | 'ok'

export type CheckpointHeaderProps = {
  tone: CheckpointTone
  icon: string
  busy?: boolean
  title: string
  line: React.ReactNode
  action?: React.ReactNode
  // Changes when the checkpoint does; a re-render with the same key changes text in place.
  swapKey: string
  // The bar under the header.
  children?: React.ReactNode
}

type Top = Omit<CheckpointHeaderProps, 'swapKey' | 'children'>

// The tile, title, line and action: drawn for the header now, and for the one fading out.
function HeaderTop({ top, state }: { top: Top; state?: 'in' | 'out' }) {
  return (
    <div
      className="ds-checkpoint-top"
      data-in={state === 'in' ? '' : undefined}
      data-out={state === 'out' ? '' : undefined}
      aria-hidden={state === 'out' ? true : undefined}
      inert={state === 'out' ? true : undefined}
    >
      <span className="ds-checkpoint-tile" data-tone={top.tone}>
        <Icon name={top.icon} size={22} />
        {top.busy ? <span className="ds-checkpoint-busy" /> : null}
      </span>
      <div>
        <h2>{top.title}</h2>
        <p>{top.line}</p>
      </div>
      {top.action ? <div className="ds-checkpoint-action">{top.action}</div> : null}
    </div>
  )
}

/** Returns the header card. Only its title and line are announced (politely) when they
    change: the bar's "N of 11 drafted" moving on would otherwise be read out every time. */
export function CheckpointHeader({ swapKey, children, ...top }: CheckpointHeaderProps) {
  // The header as it was when the previous checkpoint began, while it fades out (120 ms).
  const { was, turn } = useSwap({ key: swapKey, top }, 120, (a, b) => a.key === b.key)
  return (
    <section className="ds-checkpoint">
      {/* A live region (a part of the page screen readers read out when it changes) that is
          always there, holding only the title and line, so the swap's remount is not missed. */}
      <p className="ds-sr-only" aria-live="polite">
        {top.title}. {top.line}
      </p>
      <div className="ds-checkpoint-swap">
        {was ? <HeaderTop key={`was-${turn}`} top={was.top} state="out" /> : null}
        <HeaderTop key={`now-${turn}`} top={top} state={turn > 0 ? 'in' : undefined} />
      </div>
      {children ? <div className="ds-checkpoint-bar">{children}</div> : null}
    </section>
  )
}

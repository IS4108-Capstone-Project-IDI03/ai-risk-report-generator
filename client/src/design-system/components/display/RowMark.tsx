// Row mark (GN-13, NEW pattern; v2 "Reading status cell" family): the ONE 16 px mark at a row's
// right edge. All share one size and one pixel column. A change crossfades (motion 2): the old
// mark out in 100 ms, the new in over 180 ms; spinner to tick pops the green disc from 0.6 and
// draws the stroke. Nothing animates on page load. Used by SectionRow and TaskRow. Calls useSwap.
import { Icon } from '../core/Icon'
import { useSwap } from './useSwap'
import './steps.css'

export type MarkKind = 'waiting' | 'working' | 'done' | 'stale' | 'failed' | 'open'

const SPOKEN: Record<MarkKind, string> = {
  waiting: 'Waiting',
  working: 'Working',
  done: 'Done',
  stale: 'Out of date',
  failed: 'Failed',
  open: 'Open',
}

// One glyph. `state` marks it as the one fading in or out.
function Glyph({ kind, state }: { kind: MarkKind; state?: 'in' | 'out' }) {
  const anim = {
    'data-in': state === 'in' ? '' : undefined,
    'data-out': state === 'out' ? '' : undefined,
  }
  if (kind === 'working') return <span className="ds-mark-ring" {...anim} />
  if (kind === 'waiting') return <span className="ds-mark-circle" {...anim} />
  if (kind === 'done')
    return (
      <svg className="ds-mark-tick" viewBox="0 0 16 16" width="16" height="16" {...anim}>
        <circle cx="8" cy="8" r="8" />
        <path d="M4.6 8.3l2.3 2.3 4.5-4.7" />
      </svg>
    )
  const icon = { stale: 'repeat', failed: 'circle-alert', open: 'chevron-right' }[kind]
  return (
    <span className={`ds-mark-${kind}`} {...anim}>
      <Icon name={icon} size={16} />
    </span>
  )
}

/** Returns the mark, named for screen readers by `label` (default: the kind in words). */
export function RowMark({ kind, label }: { kind: MarkKind; label?: string }) {
  const { was, moved, turn } = useSwap(kind, 100)
  return (
    <span className="ds-mark" role="img" aria-label={label ?? SPOKEN[kind]}>
      {was !== null && <Glyph key={`was-${turn}`} kind={was} state="out" />}
      <Glyph key={`now-${turn}`} kind={kind} state={moved ? 'in' : undefined} />
    </span>
  )
}

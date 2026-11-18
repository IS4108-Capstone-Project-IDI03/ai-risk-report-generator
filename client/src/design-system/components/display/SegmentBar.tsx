// Segmented bar (GN-13, NEW pattern): one segment per part in run order, split into groups with
// a wider gap, then "N of M drafted". Green = done (grows from the left), light blue with a
// sweep = being worked on now, amber outline = out of date, red outline = failed.
// Used by Generation's checkpoint header. Calls NumberSwap.
import { NumberSwap } from './NumberSwap'
import './steps.css'

export type SegmentState = 'empty' | 'working' | 'done' | 'stale' | 'failed'

export type SegmentBarProps = {
  segments: SegmentState[]
  // Segments per group, e.g. [8, 3]; the groups take width in proportion. One group by default.
  groups?: number[]
  // How many are done and of how many, and the word after them ("drafted").
  count: number
  total: number
  word: string
}

/** Returns the bar and its count; the segments are decoration, the count is what is read out. */
export function SegmentBar({
  segments,
  groups = [segments.length],
  count,
  total,
  word,
}: SegmentBarProps) {
  const starts = groups.map((_, i) => groups.slice(0, i).reduce((a, b) => a + b, 0))
  return (
    <div className="ds-segbar">
      <div className="ds-segbar-track" aria-hidden="true">
        {groups.map((size, g) => (
          <div key={g} className="ds-segbar-group" style={{ flex: size }}>
            {segments.slice(starts[g], starts[g] + size).map((state, i) => (
              <i key={i} className="ds-seg" data-state={state}>
                <b />
              </i>
            ))}
          </div>
        ))}
      </div>
      <span className="ds-segbar-label">
        <NumberSwap value={count} /> of {total} <span>{word}</span>
      </span>
    </div>
  )
}

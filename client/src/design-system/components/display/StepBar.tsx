// Step bar (F-12, NEW pattern): one 6 px segment per step on SegmentBar's own track, with no count
// beside it. Steps passed are green; the current one fills green from the left (400 ms) unless it
// is still waiting on the person (`current: 'waiting'`). A screen reader hears "Step 2 of 6".
// Used by the walkthrough bubble. Calls nothing (steps.css holds the track and segments).
import './steps.css'

export type StepBarProps = {
  // This step's place, counting from 1, and how many steps there are.
  at: number
  total: number
  // 'waiting' leaves the current segment empty until its action is done.
  current?: 'filled' | 'waiting'
}

/** Returns the bar; the segments are decoration, "Step N of M" is what is read out. */
export function StepBar({ at, total, current = 'filled' }: StepBarProps) {
  return (
    <div className="ds-stepbar">
      <span className="ds-sr-only">{`Step ${at} of ${total}`}</span>
      <div className="ds-segbar-track" aria-hidden="true">
        <div className="ds-segbar-group">
          {Array.from({ length: total }, (_, i) => (
            <i
              key={i}
              className="ds-seg"
              data-state={i < at - 1 || (i === at - 1 && current === 'filled') ? 'done' : 'empty'}
            >
              <b />
            </i>
          ))}
        </div>
      </div>
    </div>
  )
}

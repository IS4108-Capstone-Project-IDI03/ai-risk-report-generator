// Time in each stage, for an admin (AS-06 board 07): one bar split by the days each reached
// stage took, the current stage in navy, and under it every stage's name and days, so a stage
// too short to label in the bar is still named. Rendered by the StageTime part (library.tsx).
import { STAGE_LABEL } from '../../assessments/format'
import { useMarshBot } from '../context'
import { daysBetween } from '../format'
import { STAGES } from '../types'

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Returns the stacked bar of days per stage and its key; nothing before the first stage date. */
export function StageTime() {
  const { brief } = useMarshBot()
  const now = new Date().toISOString()
  const reached = STAGES.filter((s) => brief.stageDates[s])
  if (!reached.length) return null
  const spans = reached.map((stage, i) => {
    const next = reached[i + 1]
    const end = next ? brief.stageDates[next]! : now
    return {
      stage,
      name: STAGE_LABEL[stage],
      days: Math.max(daysBetween(brief.stageDates[stage]!, end), 0),
    }
  })
  const total = spans.reduce((n, s) => n + s.days, 0)
  return (
    <div className="mb-panel mb-time">
      <div className="mb-time-head">{`Time in each stage · ${total} days so far`}</div>
      {/* The bar is a picture of the key below, so screen readers read the key instead. */}
      <div className="mb-time-bar" aria-hidden="true">
        {spans.map((s) => (
          <span
            key={s.stage}
            data-now={s.stage === brief.stage || undefined}
            // A stage of zero days still shows as a sliver, so none goes missing.
            style={{ flex: `${Math.max(s.days, 0.4)} 1 0` }}
            title={`${s.name}: ${days(s.days)}`}
          >
            {/* The name hides where it wouldn't fit, the days too on a sliver (parts.css). */}
            <span className="mb-time-label">
              <b>{s.name}</b> {`${s.days}d`}
            </span>
          </span>
        ))}
      </div>
      <ul className="mb-time-key">
        {spans.map((s) => (
          <li key={s.stage} data-now={s.stage === brief.stage || undefined}>
            {`${s.name} ${days(s.days)}`}
          </li>
        ))}
      </ul>
    </div>
  )
}

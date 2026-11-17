// Time in each stage, for an admin (AS-06 canvas S9, round 7): "stage steps", one column per stage
// in the rail's order, each with a thin bar sized against the longest stage, its days and its
// name. Finished stages are green, the current one navy, the ones not reached empty with a dash.
// The gateway sends only the stages reached; the rest are filled in here (one jumped over shows
// as passed in 0 days). A stage the gateway marks skipped reads "Skipped", not "0d", so it isn't
// mistaken for a same-day stage. Used by CardView.tsx.
import { STAGE_LABEL } from '../../../assessments/format'
import { STAGES, type Card } from '../../types'
import { CardShell } from './CardShell'

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Returns the time-in-stage card. */
export function StageTimeCard({ card }: { card: Extract<Card, { type: 'stage-time' }> }) {
  // Every stage in order. One with no span from the gateway is "not reached" after the furthest
  // stage with one, and jumped over (passed in 0 days, empty bar) before it.
  const spanOf = (stage: (typeof STAGES)[number]) =>
    card.spans.find((s) => s.label === STAGE_LABEL[stage])
  const furthest = STAGES.findLastIndex((stage) => spanOf(stage))
  const steps = STAGES.map((stage, i) => {
    const label = STAGE_LABEL[stage]
    const jumped = !spanOf(stage) && i < furthest
    return { label, jumped, span: jumped ? { label, days: 0, now: false } : spanOf(stage) }
  })
  const longest = Math.max(1, ...card.spans.map((s) => s.days))
  return (
    <CardShell title={card.title} note={card.note} wide>
      <div className="mbt-time">
        <ol>
          {steps.map(({ label, jumped, span }) => (
            <li
              key={label}
              data-now={span?.now || undefined}
              data-reached={!!span}
              data-skipped={span?.skipped || undefined}
            >
              {/* The picture says nothing a screen reader needs; the sentence below does. */}
              <span className="mbt-time-bar" aria-hidden="true">
                {span && !jumped && !span.skipped && (
                  <i style={{ width: `${Math.max(span.days / longest, 0.04) * 100}%` }} />
                )}
              </span>
              <span className="mbt-time-days" aria-hidden="true">
                {span ? (span.skipped ? 'Skipped' : `${span.days}d`) : '–'}
                {span?.now && <em>Now</em>}
              </span>
              <span className="mbt-time-name" aria-hidden="true">
                {label}
              </span>
              <span className="mbt-sr">
                {!span
                  ? `${label}, not reached`
                  : span.skipped
                    ? `${label}, skipped`
                    : `${label}, ${days(span.days)}${span.now ? ', now' : ''}`}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </CardShell>
  )
}

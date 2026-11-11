// Where each section stands, for an admin (AS-06 board 07): three lanes, each status said once
// in its heading with a count, then one card per section with its date and open comments.
// The lanes stack on a narrow screen. Rendered by the StatusLanes part (library.tsx).
import { Icon } from '../../../design-system'
import { useMarshBot } from '../context'
import { shortDay } from '../format'
import { inOrder, SECTION_LOOK } from '../sections'
import type { SectionState } from '../types'

const LANES: SectionState['state'][] = ['decisions', 'not_started', 'reviewed']

// A section's date: when it was drafted while waiting, when it was reviewed once done.
function when(s: SectionState) {
  if (!s.date) return null
  return s.state === 'not_started' ? `Drafted ${shortDay(s.date)}` : shortDay(s.date)
}

/** Returns the three status lanes; nothing when no section exists yet. */
export function StatusLanes() {
  const bot = useMarshBot()
  const sections = inOrder(bot.brief.sections)
  if (!sections.length) return null
  return (
    <div className="mb-lanes">
      {LANES.map((state) => {
        const lane = sections.filter((s) => s.state === state)
        const look = SECTION_LOOK[state]
        return (
          <section key={state} className="mb-lane" data-state={state} aria-label={look.word}>
            <h2 className="mb-lane-head">
              <span className="mb-state-icon" data-state={state}>
                <Icon name={look.icon} size={16} />
              </span>
              {look.word}
              <span className="mb-count">{lane.length}</span>
            </h2>
            {lane.map((s) => (
              <div key={s.sectionId} className="mb-lane-card">
                <span className="mb-outline-no">{s.sectionId}</span>
                <span className="mb-lane-title">{s.title}</span>
                {s.openComments > 0 && (
                  <span
                    className="mb-lane-comments"
                    title={`${s.openComments} open comment${s.openComments === 1 ? '' : 's'}`}
                  >
                    <Icon name="message-square" size={14} />
                    {s.openComments}
                  </span>
                )}
                {when(s) && <span className="mb-lane-date">{when(s)}</span>}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

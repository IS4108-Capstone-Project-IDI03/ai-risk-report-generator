// The report as it stands (AS-06 board 02): a top bar with one segment per section in three
// colours, then the named sections in two columns, one status icon each, explained once in a
// key. When every section is reviewed it only says so (board 14: never list them all).
// Rendered by the ReportOutline part (library.tsx).
import { useContext } from 'react'
import { Icon } from '../../../design-system'
import { MessageContext, useMarshBot } from '../context'
import { inOrder, SECTION_LOOK } from '../sections'
import type { SectionState } from '../types'

// One section: its number, status icon and title; the one the message links to is marked.
function Row({ s, current }: { s: SectionState; current: boolean }) {
  const look = SECTION_LOOK[s.state]
  return (
    <li className="mb-outline-row" data-state={s.state} data-current={current || undefined}>
      <span className="mb-outline-no">{s.sectionId}</span>
      <span className="mb-state-icon" data-state={s.state} title={look.word}>
        <Icon name={look.icon} size={18} />
      </span>
      <span className="mb-outline-title">
        {s.title}
        <span className="mb-sr">{`, ${look.word}`}</span>
      </span>
    </li>
  )
}

/** Returns the outline of the report's sections; nothing when there are none yet. */
export function ReportOutline() {
  const bot = useMarshBot()
  const message = useContext(MessageContext)
  const sections = inOrder(bot.brief.sections)
  if (!sections.length) return null
  const reviewed = sections.filter((s) => s.state === 'reviewed').length
  const all = reviewed === sections.length
  // The section this message's link opens ("Continue Fire Protection") is the current one.
  const linked = message?.parts.find((p) => p.type === 'link' && p.link.params?.section)
  const current = linked?.type === 'link' ? linked.link.params?.section : undefined
  const half = Math.ceil(sections.length / 2)
  return (
    <div className="mb-panel mb-outline">
      <div className="mb-outline-head">
        <strong>
          {all
            ? `All ${sections.length} sections reviewed`
            : `${reviewed} of ${sections.length} sections reviewed`}
        </strong>
        <span className="mb-segs mb-segs--thin" aria-hidden="true">
          {sections.map((s) => (
            <i key={s.sectionId} data-state={s.state} />
          ))}
        </span>
      </div>
      {!all && (
        <>
          <div className="mb-outline-cols">
            {[sections.slice(0, half), sections.slice(half)].map((col, i) => (
              <ul key={i}>
                {col.map((s) => (
                  <Row key={s.sectionId} s={s} current={s.sectionId === current} />
                ))}
              </ul>
            ))}
          </div>
          <div className="mb-key" aria-hidden="true">
            {Object.entries(SECTION_LOOK).map(([state, look]) => (
              <span key={state}>
                <span className="mb-state-icon" data-state={state}>
                  <Icon name={look.icon} size={15} />
                </span>
                {look.word}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

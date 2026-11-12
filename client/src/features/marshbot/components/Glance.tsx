// "At a Glance" in the rail (AS-06 canvas P6): the stage's 3 facts, sharing the height the packed
// stages leave, each a tile, a label and its value (amber when close, red when late, green when
// complete). Where all 3 can't fit at 40 px each it steps aside entirely (marshbot.css container
// query) rather than squeeze or make the rail scroll. Used by Rail.tsx.
import { Icon } from '../../../design-system'
import type { GlanceFact } from '../types'

/** Returns the glance facts; nothing when there are none. */
export function Glance({ facts }: { facts: GlanceFact[] }) {
  if (!facts.length) return null
  return (
    <section className="mb-glance" aria-label="At a Glance">
      <div className="mb-glance-in">
        <h2>At a Glance</h2>
        <dl>
          {facts.map((f) => (
            <div key={f.label} className="mb-glance-row">
              <span className="mb-glance-tile" aria-hidden="true">
                <Icon name={f.icon} size={14} />
              </span>
              <dt>{f.label}</dt>
              <dd data-tone={f.tone}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

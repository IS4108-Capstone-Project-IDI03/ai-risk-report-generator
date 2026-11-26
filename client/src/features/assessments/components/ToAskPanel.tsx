// The "To ask the client" checklist on the Observations tab (CP-36): the observations tagged Info
// request, each with a checkbox for "asked". Ticking saves at once (optimistic, rolled back if
// refused); ticked rows are muted and sink below the others. Used by screens/Observations.tsx.
// Calls api.ts getToAsk and updateObservation. Shows nothing while there is nothing to ask.
import { useEffect, useState } from 'react'
import { Checkbox, CountPill, Icon } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { getToAsk, updateObservation, type ToAskItem } from '../api'
import './to-ask.css'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const SHOWN = 5

// `refreshKey` changes when the observations do, so the list is read again then.
export function ToAskPanel({ reference, refreshKey }: { reference: string; refreshKey: string }) {
  const [items, setItems] = useState<ToAskItem[]>([])
  const [all, setAll] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getToAsk(reference, controller.signal).then(
      (r) => setItems(Array.isArray(r?.items) ? r.items : []), // not a list: nothing to show
      () => !controller.signal.aborted && setItems([]),
    )
    return () => controller.abort()
  }, [reference, refreshKey])

  // Ticks or unticks at once, then tells the gateway; a refusal puts the tick back.
  async function tick(id: string, asked: boolean) {
    const set = (value: boolean) =>
      setItems((cur) => cur.map((i) => (i.observationId === id ? { ...i, asked: value } : i)))
    set(asked)
    try {
      await updateObservation(id, { asked })
    } catch {
      set(!asked)
    }
  }
  if (!items.length) return null
  // Unticked first, each group keeping the gateway's order (oldest first).
  const sorted = [...items.filter((i) => !i.asked), ...items.filter((i) => i.asked)]
  const shown = all ? sorted : sorted.slice(0, SHOWN)
  const asked = items.filter((i) => i.asked).length
  return (
    <section className="ta" aria-label="To ask the client">
      <div className="ta-head">
        <span className="ta-tile" aria-hidden="true">
          <Icon name="message-circle-question" size={16} color="var(--marsh-navy)" />
        </span>
        <h3 className="ta-title">To ask the client</h3>
        <Tip id="observations.to-ask" />
        <CountPill tone="ink">{`${asked} of ${items.length} asked`}</CountPill>
      </div>
      <ul className="ta-list">
        {shown.map((i) => (
          <li key={i.observationId} className="ta-item" data-asked={i.asked || undefined}>
            <Checkbox
              checked={!!i.asked}
              onChange={(next) => void tick(i.observationId, next)}
              label={
                <span className="ta-text" title={i.text}>
                  {i.text}
                </span>
              }
              style={{ flex: 1, minWidth: 0, gap: 'var(--space-3)' }}
            />
            <span className="ta-meta">
              {[i.location, cap(i.severity)].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      {sorted.length > SHOWN && (
        <button type="button" className="ta-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all (${sorted.length})`}
        </button>
      )}
    </section>
  )
}

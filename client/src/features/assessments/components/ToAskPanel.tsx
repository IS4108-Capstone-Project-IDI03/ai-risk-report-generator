// The "To ask the client" panel on the Observations tab (CP-35): the info requests the engineer
// wrote in split notes, so nothing to ask is forgotten. Read only. Used by screens/Observations.tsx.
// Calls api.ts getToAsk. Shows nothing while there is nothing to ask or the list cannot be read.
import { useEffect, useState } from 'react'
import { Badge, Icon } from '../../../design-system'
import { getToAsk, type ToAskItem } from '../api'
import './to-ask.css'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// `refreshKey` changes when the observations do, so the list is read again then.
export function ToAskPanel({ reference, refreshKey }: { reference: string; refreshKey: string }) {
  const [items, setItems] = useState<ToAskItem[]>([])
  useEffect(() => {
    const controller = new AbortController()
    getToAsk(reference, controller.signal).then(
      (r) => setItems(r.items),
      () => !controller.signal.aborted && setItems([]),
    )
    return () => controller.abort()
  }, [reference, refreshKey])
  if (!items.length) return null
  return (
    <section className="ta" aria-label="To ask the client">
      <h3 className="ta-title">
        <Icon name="message-circle-question" size={16} color="var(--action-primary)" />
        To ask the client <Badge tone="info">{items.length}</Badge>
      </h3>
      <ul className="ta-list">
        {items.map((i, n) => (
          <li key={`${i.observationId}-${n}`} className="ta-item">
            <span>{i.text}</span>
            <span className="ta-meta">
              {[i.location, cap(i.severity)].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

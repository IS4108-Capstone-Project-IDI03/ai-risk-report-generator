// Recordings, photos and handwritten pages removed from an observation
// (CP-08, CP-20), folded away on its page, each with who removed it and
// Restore. A photo or page opens to view. Rendered by screens/ObservationPage.tsx.
import { Icon, IconRegistry } from '../../../design-system'
import type { ObservationRowView } from '../useObservationsView'

type Removed = ObservationRowView['removedMedia'][number]

export function RemovedMedia({
  items,
  onOpen,
}: {
  items: Removed[]
  onOpen: (photo: { name: string; url: string }) => void
}) {
  return (
    <details className="ob-card ob-section">
      <summary className="ob-section-head" style={{ cursor: 'pointer', margin: 0 }}>
        <span>{'Removed media (' + items.length + ')'}</span>
      </summary>
      <ul aria-label="Removed media" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
        {items.map((m) => (
          <li key={m.id} className="ob-item">
            <div className="ob-item-head">
              <Icon
                name={
                  m.kind === 'recordings'
                    ? 'mic'
                    : m.kind === 'pages'
                      ? IconRegistry.evidence.handwriting
                      : 'image'
                }
                size={15}
                color="var(--text-muted)"
              />
              {m.kind !== 'recordings' && m.url ? (
                <button
                  type="button"
                  className="ob-button ob-button--small"
                  style={{ justifyContent: 'flex-start', padding: 0 }}
                  onClick={() => onOpen({ name: m.name, url: m.url! })}
                >
                  {m.name}
                </button>
              ) : (
                <span>{m.name}</span>
              )}
              {!!m.restore && (
                <button
                  type="button"
                  className="ob-button ob-button--tinted ob-button--small"
                  aria-label={'Restore ' + m.name}
                  onClick={m.restore}
                >
                  <Icon name="rotate-ccw" size={14} />
                  {'Restore'}
                </button>
              )}
            </div>
            {m.kind === 'recordings' && !!m.url && (
              <audio
                className="ob-audio"
                controls
                preload="none"
                src={m.url}
                aria-label={'Play ' + m.name}
              />
            )}
            <p className="ob-stamp">{m.removedLabel}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

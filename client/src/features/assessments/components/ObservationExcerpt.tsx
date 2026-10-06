// What a cited observation says, shown in a draft's evidence list (GN-01 AC4).
// Used by screens/SectionDrafts.tsx as an EvidenceCitation excerpt.
import { Icon, IconRegistry } from '../../../design-system'
import type { SavedObservation } from '../api'

const label = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--text-muted)',
} as const

// The note and each voice transcript as separate labelled parts, since the
// draft may take a fact from any of them; the label says which one it was.
export function ObservationExcerpt({ observation: o }: { observation: SavedObservation }) {
  const parts = [
    ...(o.note ? [{ icon: IconRegistry.evidence.note, title: 'Note', text: o.note }] : []),
    ...o.recordings.flatMap((r) =>
      r.transcription.transcript
        ? [
            {
              icon: IconRegistry.evidence.recording,
              title: `Voice transcript · ${r.name}`,
              text: r.transcription.transcript,
            },
          ]
        : [],
    ),
  ]
  return parts.map((p, i) => (
    <span key={i} style={{ display: 'block', marginTop: i ? '8px' : 0 }}>
      <span style={label}>
        <Icon name={p.icon} size={12} />
        <span>{p.title}</span>
      </span>
      <span style={{ display: 'block' }}>{p.text}</span>
    </span>
  ))
}

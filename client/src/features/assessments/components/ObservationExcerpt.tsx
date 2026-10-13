import { PhotoReferences } from './PhotoReferences'
// What a cited observation says, shown in a draft's evidence list (GN-01 AC4).
// Used by screens/SectionDrafts.tsx as an EvidenceCitation excerpt.
import { useState } from 'react'
import { Button, Icon, IconRegistry } from '../../../design-system'
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
  const [original, setOriginal] = useState<string | null>(null)
  const parts = [
    ...(o.note
      ? [
          {
            icon: IconRegistry.evidence.note,
            title: 'Note',
            text: o.note,
            recordingId: null,
            originalText: null,
          },
        ]
      : []),
    ...o.recordings.flatMap((r) =>
      (r.transcription.correction?.text ?? r.transcription.transcript)
        ? [
            {
              icon: IconRegistry.evidence.recording,
              title: `${r.transcription.correction ? 'Corrected voice transcript' : 'Voice transcript'} · ${r.name}`,
              text: r.transcription.correction?.text ?? r.transcription.transcript,
              recordingId: r.id,
              originalText: r.transcription.correction ? r.transcription.transcript : null,
            },
          ]
        : [],
    ),
  ]
  return (
    <>
      {' '}
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'block', marginTop: i ? '8px' : 0 }}>
          <span style={label}>
            <Icon name={p.icon} size={12} />
            <span>{p.title}</span>
          </span>
          <span style={{ display: 'block' }}>{p.text}</span>
          {p.originalText && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={original === p.recordingId}
                onClick={() => setOriginal(original === p.recordingId ? null : p.recordingId)}
              >
                {original === p.recordingId
                  ? 'Hide original transcript'
                  : 'Show original transcript'}
              </Button>
              {original === p.recordingId && (
                <span style={{ display: 'block' }}>
                  <span style={label}>Original voice transcript</span>
                  {p.originalText}
                </span>
              )}
            </>
          )}
        </span>
      ))}
      <PhotoReferences photos={o.deleted ? [] : o.photos} />
    </>
  )
}

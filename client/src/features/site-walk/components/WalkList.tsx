// The walk so far on the Recording screen (CP-22 round 1): recordings and typed
// notes in the order they were made. Used by screens/Recording.tsx.
import { usePhone } from '../usePhone'
import type { WalkItem } from '../walkItems'
import { NoteRow } from './NoteRow'
import { RecordingRow } from './RecordingRow'

// Shows the walk’s recordings and typed notes in sequence.
export function WalkList({
  items,
  onSaveNote,
  onRetry,
  onRemove,
}: {
  items: WalkItem[]
  onSaveNote: (seq: number, text: string) => Promise<boolean>
  onRetry: (seq: number) => void
  onRemove: (item: WalkItem) => void
}) {
  const phone = usePhone()
  // Only a wide screen shows this: the list's column would otherwise sit empty beside the recorder.
  if (!items.length)
    return <p className="sw-list-empty">Recordings and notes appear here as you make them.</p>
  return (
    <ul className="sw-list" aria-label="This walk">
      {items.map((item) =>
        item.kind === 'recording' ? (
          <RecordingRow
            key={'r' + item.seq}
            item={item}
            phone={phone}
            onRetry={() => onRetry(item.seq)}
            onRemove={() => onRemove(item)}
          />
        ) : (
          <NoteRow
            key={'n' + item.seq}
            text={item.text}
            legacy={item.legacy}
            onSave={(text) => onSaveNote(item.seq, text)}
            onRemove={() => onRemove(item)}
          />
        ),
      )}
    </ul>
  )
}

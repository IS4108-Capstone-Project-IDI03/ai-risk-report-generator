// The source type picker for an upload whose type labelling couldn't read
// (IN-19): the document isn't ingested until a type is chosen here. Used by
// UploadedDocuments.tsx, in its Action column.
import { useState } from 'react'
import { Button, Select } from '../../../design-system'
import { chooseSourceType, type KnowledgeDocument, type SourceType } from '../api'
import { SOURCE_LABELS } from '../display'

const OPTIONS = [
  { value: '', label: 'Choose a type' },
  ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
]

/** Returns the type select and Start ingestion button for one document. */
export function ChooseSourceType({
  document,
  onStarted,
  onError,
  walk,
}: {
  document: KnowledgeDocument
  // Called once the gateway has queued it, so the list re-reads.
  onStarted: () => void
  // Called with the gateway's reason when ingestion couldn't start, or null on a new try.
  onError: (reason: string | null) => void
  // The control's data-walk tag (F-12).
  walk?: string
}) {
  const [sourceType, setSourceType] = useState<SourceType | ''>('')
  const [starting, setStarting] = useState(false)

  const start = async () => {
    if (!sourceType) return
    setStarting(true)
    onError(null)
    try {
      await chooseSourceType(document.id, sourceType)
      onStarted()
    } catch (error: unknown) {
      onError(
        error instanceof Error && error.message
          ? error.message
          : 'Ingestion could not be started. Check the connection, then try again.',
      )
    } finally {
      setStarting(false)
    }
  }

  return (
    <span className="kb-choose-type" data-walk={walk}>
      <Select
        aria-label={`Source type for ${document.title}`}
        size="sm"
        options={OPTIONS}
        value={sourceType}
        disabled={starting}
        onChange={(e) => setSourceType(e.target.value as SourceType | '')}
      />
      <Button size="sm" disabled={!sourceType || starting} onClick={start}>
        {starting ? 'Starting…' : 'Start ingestion'}
      </Button>
    </span>
  )
}

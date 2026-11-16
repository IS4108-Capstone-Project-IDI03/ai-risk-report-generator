// A document's passages as search holds them (IN-17): one row per passage in
// reading order, with its heading trail and pages; opening a row shows its full
// text, formulas rendered (sources/PassageBody.tsx). Read-only for everyone.
// Opened by screens/KnowledgeDocuments.tsx from a document's details.
import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  Icon,
  IconRegistry,
} from '../../../design-system'
import { PassageBody } from '../../sources/PassageBody'
import { listDocumentPassages, type DocumentPassage, type KnowledgeDocument } from '../api'

/** Returns the Passages dialog for one document. */
export function PassagesDialog({
  document: d,
  onClose,
}: {
  document: KnowledgeDocument
  onClose: () => void
}) {
  const [passages, setPassages] = useState<DocumentPassage[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listDocumentPassages(d.id, controller.signal).then(setPassages, () => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => controller.abort()
  }, [d.id, attempt])

  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Passages"
      description={d.title}
      width={720}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {failed ? (
        <Callout
          tone="danger"
          title="Passages not loaded"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailed(false)
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          }
        >
          The knowledge base could not be reached. Try again shortly.
        </Callout>
      ) : passages === null ? (
        <p className="kb-list-note" role="status">
          Loading passages…
        </p>
      ) : passages.length === 0 ? (
        <EmptyState
          icon="library"
          title="No passages in search"
          description="This document has no passages yet, for example while it is still being ingested."
        />
      ) : (
        <ol className="kb-passages">
          {passages.map((p) => {
            const open = openId === p.id
            const panel = `kb-passage-${p.id}`
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="kb-passage-toggle"
                  aria-expanded={open}
                  aria-controls={panel}
                  onClick={() => setOpenId(open ? null : p.id)}
                >
                  <Icon
                    name={open ? IconRegistry.action.expand : IconRegistry.action.forward}
                    size={15}
                  />
                  <span className="kb-passage-head">
                    <strong>{p.headings.length ? p.headings.join(' › ') : 'No heading'}</strong>
                    <small>{pages(p)}</small>
                  </span>
                  {p.status && p.status !== 'active' && (
                    <Badge tone={p.status === 'withdrawn' ? 'danger' : 'moderate'}>
                      {p.status === 'withdrawn' ? 'Withdrawn' : 'Needs review'}
                    </Badge>
                  )}
                </button>
                {open ? (
                  <div id={panel} className="kb-passage-text">
                    <PassageBody text={p.text} quote="" className="kb-passage-body" />
                  </div>
                ) : (
                  <p className="kb-passage-excerpt">{p.text}</p>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Dialog>
  )
}

// "Page 14", "Pages 12–13", or nothing when the passage has no page.
function pages(p: DocumentPassage): string {
  if (p.pageStart == null) return ''
  if (p.pageEnd == null || p.pageEnd === p.pageStart) return `Page ${p.pageStart}`
  return `Pages ${p.pageStart}–${p.pageEnd}`
}

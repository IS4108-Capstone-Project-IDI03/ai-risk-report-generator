// A document's Review page (IN-07). The main column holds Confirm details
// (what labelling left Unconfirmed; saving can create or change the match,
// AC5) and the passages side by side; the side panel says what the document
// matches and applies the admin's choice. Opened at
// /admin/knowledge-base/review/<id> from a Needs review row or the review
// banner; shown by KnowledgeBase.tsx. Calls api.ts.
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Callout, IconRegistry } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  decide,
  getComparison,
  listIngestedDocuments,
  type Comparison,
  type DecisionChoice,
  type KnowledgeDocument,
} from '../api'
import { ComparisonTable } from '../components/ComparisonTable'
import { ConfirmDetailsStep } from '../components/ConfirmDetailsStep'
import { ReviewPanel } from '../components/ReviewPanel'
import { named, outcomeMessage } from '../decisions'
import { needsReview } from '../display'
import '../review-document.css'

/** Returns the Review page for the document with this id. */
export function ReviewDocument({
  id,
  onBack,
  onDecided,
}: {
  id: string
  // Back to the list.
  onBack: () => void
  // The decision was applied: back to the list with this sentence as a toast.
  onDecided: (message: string) => void
}) {
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null)
  // Whether the document had Unconfirmed details when the page opened: step 1
  // stays on the page, as a summary, after they are saved.
  const [hadUnconfirmed, setHadUnconfirmed] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'gone' | 'unreachable'>('loading')
  // Retry counters: one re-runs the document load, one only the comparison.
  const [attempt, setAttempt] = useState(0)
  const [comparisonAttempt, setComparisonAttempt] = useState(0)
  // The match the load already fetched a comparison for.
  const loadedKey = useRef<string | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [comparisonProblem, setComparisonProblem] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // Focus lands on the page heading, so a screen reader starts at the title.
  useEffect(() => heading.current?.focus(), [])

  // Loads the document. The comparison carries the document and its match, so
  // it is asked first. 404 means the document is gone. 409 means it has no
  // match to compare (the Confirm details step may still create one), so the
  // list is read to find it.
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const show = (found: KnowledgeDocument) => {
      setDoc(found)
      setHadUnconfirmed(found.unconfirmed.length > 0)
    }
    const fromList = () =>
      listIngestedDocuments(signal).then((list) => {
        const found = list.find((d) => d.id === id)
        if (found) show(found)
        else setLoadState('gone')
      })
    getComparison(id, signal)
      .then((result) => {
        show(result.document)
        // Details still Unconfirmed: the comparison is read again once saved.
        if (result.document.unconfirmed.length === 0) {
          loadedKey.current = `${result.document.match?.kind}:${result.matched.id}`
          setComparison(result)
        }
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        const status = error instanceof GatewayError ? error.status : null
        if (status === 404) setLoadState('gone')
        else if (status === 409)
          fromList().catch(() => !signal.aborted && setLoadState('unreachable'))
        else setLoadState('unreachable')
      })
    return () => controller.abort()
  }, [id, attempt])

  // The comparison is read once the details are saved, and again if saving
  // changes what the document matches. Not read twice for the one the load
  // already brought.
  const matchKey = doc ? keyOf(doc) : null
  useEffect(() => {
    if (!matchKey) return
    if (loadedKey.current === matchKey) {
      loadedKey.current = null
      return
    }
    const controller = new AbortController()
    getComparison(id, controller.signal).then(
      (result) => {
        setComparison(result)
        setComparisonProblem(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setComparisonProblem(
            error instanceof Error
              ? error.message
              : 'The comparison could not be loaded. Try again.',
          )
      },
    )
    return () => controller.abort()
  }, [id, matchKey, comparisonAttempt])

  const submit = async (choice: DecisionChoice) => {
    if (!doc) return
    await decide(id, choice)
    onDecided(outcomeMessage(doc, choice))
  }

  const locked = !!doc && doc.unconfirmed.length > 0

  return (
    <section className="kb-review" aria-labelledby="kb-review-title">
      <header className="kb-review-head">
        <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={onBack}>
          All documents
        </Button>
        <div className="kb-review-title">
          <h2 id="kb-review-title" ref={heading} tabIndex={-1}>
            {doc?.title ?? 'Review document'}
          </h2>
          {doc && needsReview(doc) && (
            <Badge tone="moderate" icon={IconRegistry.status.flagged.icon}>
              Needs review
            </Badge>
          )}
        </div>
        {doc && <p className="kb-review-meta">{identity(doc)}</p>}
      </header>

      {!doc && loadState === 'loading' && (
        <p className="kb-list-note" role="status">
          Loading the document…
        </p>
      )}
      {loadState === 'gone' && !doc && (
        <Callout tone="info" title="This document is no longer in the knowledge base">
          It was discarded or removed. Go back to the list to see what is left.
        </Callout>
      )}
      {loadState === 'unreachable' && !doc && (
        <Callout
          tone="danger"
          title="Could not load this document"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoadState('loading')
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          }
        >
          The server could not be reached. Check your connection, then try again.
        </Callout>
      )}

      {doc && (
        <div className="kb-review-body">
          <div className="kb-review-main">
            {hadUnconfirmed && (
              <ConfirmDetailsStep
                document={doc}
                onSaved={(updated) => {
                  // Nothing left to decide: back to the list, with a toast,
                  // as every other outcome on this page ends.
                  if (!updated.match && updated.unconfirmed.length === 0) {
                    onDecided(
                      `Details saved. ${named(updated.title, updated.edition)} is now active.`,
                    )
                    return
                  }
                  // Only a changed match needs new passages; clearing them for
                  // the same match would leave "Loading" up for good, since the
                  // load runs when the match changes.
                  if (keyOf(updated) !== matchKey) setComparison(null)
                  setDoc(updated)
                }}
              />
            )}
            {doc.match && !locked && comparison && <ComparisonTable rows={comparison.rows} />}
            {doc.match && !locked && !comparison && (
              <section className="kb-step-panel" aria-label="Passages">
                {comparisonProblem ? (
                  <Callout
                    tone="warning"
                    title="Could not load the passages"
                    actions={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setComparisonAttempt((n) => n + 1)}
                      >
                        Try again
                      </Button>
                    }
                  >
                    {comparisonProblem}
                  </Callout>
                ) : (
                  <p className="kb-list-note" role="status">
                    Loading the passages…
                  </p>
                )}
              </section>
            )}
          </div>
          <aside className="kb-review-panel" aria-label="Decision">
            <ReviewPanel document={doc} onDecide={submit} onBack={onBack} />
          </aside>
        </div>
      )}
    </section>
  )
}

// What the document is, e.g. "NFPA 13 · 2019 edition · scan.pdf", so the
// admin can tell it from the one it matches at a glance.
function identity(d: KnowledgeDocument): string {
  const standard = [d.issuingBody, d.standardNumber].filter(Boolean).join(' ')
  return [standard || null, d.edition ? `${d.edition} edition` : null, d.fileName]
    .filter(Boolean)
    .join(' · ')
}

// Which comparison a document needs: its match, once its details are saved.
function keyOf(d: KnowledgeDocument): string | null {
  return d.unconfirmed.length === 0 && d.match ? `${d.match.kind}:${d.match.document.id}` : null
}

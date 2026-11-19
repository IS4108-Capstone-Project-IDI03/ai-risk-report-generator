// A manual document's clauses (IN-18): the list in order, and an editor for the
// clause chosen (or a new one). Each save indexes the clause at once; one that
// failed to embed says so and offers Re-embed. The editor is part of the page,
// never a dialog, so a stray click can't lose typed text; choosing another clause
// or leaving with unsaved changes asks first. Shown by KnowledgeBase.tsx at
// /admin/knowledge-base/manual/<id>; talks to the gateway through api.ts.
import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  IconButton,
  Input,
  StatusPill,
  Textarea,
  toast,
} from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  addManualSection,
  changeManualSection,
  deleteManualSection,
  getKnowledgeDocument,
  listManualSections,
  reembedManualSection,
  type ClauseInput,
  type KnowledgeDocument,
  type ManualSection,
} from '../api'
import { ClauseScreenshots } from '../components/ClauseScreenshots'
import { isDraft } from '../display'
import '../review-document.css'
import '../manual-sections.css'

// What the editor holds: the heading trail as typed, "Chapter 8 > 8.6 Hangers", and
// the screenshots with their corrected text.
type Form = { clause: string; trail: string; text: string; images: ClauseInput['images'] }
const BLANK: Form = { clause: '', trail: '', text: '', images: [] }
const TRAIL = ' > '

const formOf = (s: ManualSection): Form => ({
  clause: s.clause,
  trail: s.headings.join(TRAIL),
  text: s.text,
  images: s.images,
})
const inputOf = (form: Form): ClauseInput => ({
  clause: form.clause.trim(),
  headings: form.trail
    .split('>')
    .map((h) => h.trim())
    .filter(Boolean),
  text: form.text,
  images: form.images,
})
const byOrder = (a: ManualSection, b: ManualSection) => a.order - b.order || a.seq - b.seq

// Where a clause stands: in search as saved, copied and not yet checked, or not embedded.
function ClauseState({ section: s }: { section: ManualSection }) {
  if (!s.indexed) return <Badge tone="critical">Failed to embed</Badge>
  if (!s.checked) return <Badge tone="moderate">To check</Badge>
  return <Badge tone="low">Ready</Badge>
}

/** Returns the clauses page of one manual document. */
export function ManualSections({
  id,
  onBack,
  notify,
}: {
  id: string
  onBack: () => void
  notify: (message: string) => void
}) {
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null)
  const [sections, setSections] = useState<ManualSection[] | null>(null)
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  // The clause in the editor, or null for a new one.
  const [selected, setSelected] = useState<ManualSection | null>(null)
  const [form, setForm] = useState<Form>(BLANK)
  const [errors, setErrors] = useState<Partial<Record<'clause' | 'text', string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // An action waiting on "Discard your changes?", and a delete waiting on its confirm.
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [deleting, setDeleting] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getKnowledgeDocument(id, controller.signal),
      listManualSections(id, controller.signal),
    ]).then(
      ([document, list]) => {
        setDoc(document)
        setSections([...list].sort(byOrder))
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadProblem(
            error instanceof Error ? error.message : 'The clauses could not be loaded.',
          )
      },
    )
    return () => controller.abort()
  }, [id])
  useEffect(() => heading.current?.focus(), [])

  const baseline = selected ? formOf(selected) : BLANK
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  // Runs `action` now, or once the admin agrees to drop the changes in the editor.
  const guard = (action: () => void) => (dirty ? setPending(() => action) : action())
  const edit = (section: ManualSection | null) => {
    setSelected(section)
    setForm(section ? formOf(section) : BLANK)
    setErrors({})
    setProblem(null)
  }
  const put = (section: ManualSection) =>
    setSections((list) =>
      [...(list ?? []).filter((s) => s.id !== section.id), section].sort(byOrder),
    )

  const save = async () => {
    const missing: typeof errors = {
      ...(!form.clause.trim() && { clause: 'Enter the clause number.' }),
      // A clause that is only a screenshot is searched by the screenshot's text.
      ...(!form.text.trim() && !form.images.some((i) => i.text.trim())
        ? { text: 'Enter the clause text, or add a screenshot.' }
        : {}),
    }
    setErrors(missing)
    if (Object.keys(missing).length) return
    setBusy(true)
    setProblem(null)
    try {
      const input = inputOf(form)
      const saved = selected
        ? await changeManualSection(id, selected.id, input, selected.updatedAt)
        : await addManualSection(id, input)
      put(saved)
      if (saved.indexed) notify(`Clause ${saved.clause} saved.`)
      else
        toast.error(`Clause ${saved.clause} saved, not searchable`, {
          description: 'Search couldn’t be updated. Use Re-embed to try again.',
        })
      // A new clause clears the editor for the next one; a change stays open.
      edit(selected ? saved : null)
    } catch (error: unknown) {
      const field = error instanceof GatewayError ? error.fields.clause : undefined
      if (field) setErrors({ clause: field })
      else
        setProblem(
          error instanceof GatewayError && error.status === null
            ? 'The gateway could not be reached, so the clause was not saved. Try again.'
            : error instanceof Error
              ? error.message
              : 'The clause was not saved. Try again.',
        )
    } finally {
      setBusy(false)
    }
  }

  const reembed = async (section: ManualSection) => {
    try {
      const saved = await reembedManualSection(id, section.id)
      put(saved)
      if (selected?.id === saved.id) setSelected(saved)
      if (!saved.indexed)
        toast.error(`Clause ${saved.clause} still not searchable`, {
          description: 'Search couldn’t be updated. Try again shortly.',
        })
    } catch (error: unknown) {
      toast.error('Not re-embedded', {
        description: error instanceof Error ? error.message : 'Try again shortly.',
      })
    }
  }

  const remove = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await deleteManualSection(id, selected.id)
      setSections((list) => (list ?? []).filter((s) => s.id !== selected.id))
      notify(`Clause ${selected.clause} deleted.`)
      edit(null)
    } catch (error: unknown) {
      toast.error('Not deleted', {
        description: error instanceof Error ? error.message : 'Try again shortly.',
      })
    } finally {
      setBusy(false)
      setDeleting(false)
    }
  }

  const label = selected ? `Clause ${selected.clause}` : 'New clause'
  return (
    <section className="kb-review kb-manual" aria-labelledby="kb-manual-title">
      <header className="kb-review-head">
        <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={() => guard(onBack)}>
          All documents
        </Button>
        <div className="kb-review-title">
          <h2 id="kb-manual-title" ref={heading} tabIndex={-1}>
            {doc?.title ?? 'Clauses'}
          </h2>
          {doc && isDraft(doc) && <StatusPill status="draft" />}
        </div>
        {doc && (
          <p className="kb-review-meta">
            {[doc.issuingBody, doc.standardNumber].filter(Boolean).join(' ')}
            {doc.edition && ` · ${doc.edition} edition`} · Entered manually
          </p>
        )}
      </header>

      {loadProblem && (
        <div role="alert">
          <Callout tone="danger" title="Clauses not loaded">
            {loadProblem}
          </Callout>
        </div>
      )}

      {sections && (
        <div className="kb-manual-body">
          <section className="kb-manual-list" aria-label="Clauses">
            <div className="kb-manual-list-head">
              <Button
                variant="secondary"
                size="sm"
                iconLeft="plus"
                disabled={!selected && !dirty}
                onClick={() => guard(() => edit(null))}
              >
                New clause
              </Button>
              <span className="kb-count">
                <b>{sections.length}</b> {sections.length === 1 ? 'clause' : 'clauses'}
              </span>
            </div>
            {sections.length === 0 ? (
              <p className="kb-list-note">No clauses yet. Add the first one in the editor.</p>
            ) : (
              <ol className="kb-manual-rows">
                {sections.map((s) => (
                  <li key={s.id} data-selected={selected?.id === s.id || undefined}>
                    <button
                      type="button"
                      className="kb-manual-row"
                      aria-current={selected?.id === s.id || undefined}
                      onClick={() => selected?.id !== s.id && guard(() => edit(s))}
                    >
                      <strong>{s.clause}</strong>
                      <span>{s.headings.at(-1) ?? s.text.slice(0, 80)}</span>
                    </button>
                    <span className="kb-manual-state">
                      <ClauseState section={s} />
                      {!s.indexed && (
                        <IconButton
                          icon="rotate-ccw"
                          size="sm"
                          label={`Re-embed ${s.clause}`}
                          tooltip="Re-embed"
                          onClick={() => reembed(s)}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <form
            className="kb-manual-editor"
            aria-label={label}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <h3>{label}</h3>
            {selected?.copiedFrom && (
              <p className="kb-edit-note">
                Copied from an earlier edition. Check it against this edition, then save.
              </p>
            )}
            {problem && (
              <div role="alert">
                <Callout tone="warning" title="Clause not saved">
                  {problem}
                </Callout>
              </div>
            )}
            <Input
              label="Clause number"
              required
              placeholder="e.g. 8.6.1"
              value={form.clause}
              error={errors.clause}
              onChange={(e) => setForm({ ...form, clause: e.target.value })}
            />
            <Input
              label="Heading trail"
              placeholder="e.g. Chapter 8 Installation > 8.6 Hangers"
              value={form.trail}
              onChange={(e) => setForm({ ...form, trail: e.target.value })}
            />
            <Textarea
              label="Text"
              required
              rows={10}
              value={form.text}
              error={errors.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
            />
            <ClauseScreenshots
              documentId={id}
              images={form.images}
              context={form.trail}
              onChange={(change) =>
                setForm((current) => ({ ...current, images: change(current.images) }))
              }
            />
            <div className="kb-manual-actions">
              {selected && (
                <IconButton
                  icon="trash-2"
                  label="Delete clause"
                  tooltip="Delete clause"
                  variant="outline"
                  style={{ color: 'var(--red-600)' }}
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                />
              )}
              <Button variant="secondary" disabled={busy || !dirty} onClick={() => edit(selected)}>
                Undo changes
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Save clause
              </Button>
            </div>
          </form>
        </div>
      )}

      {pending && (
        <Dialog
          title="Discard your changes?"
          width={420}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const action = pending
                  setPending(null)
                  action()
                }}
              >
                Discard
              </Button>
            </>
          }
        >
          <p>The clause in the editor has changes that aren’t saved.</p>
        </Dialog>
      )}

      {deleting && selected && (
        <Dialog
          title={`Delete clause ${selected.clause}?`}
          width={420}
          onClose={busy ? undefined : () => setDeleting(false)}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={remove}>
                Delete
              </Button>
            </>
          }
        >
          <p>Its text leaves search. A report that cites it stops it being deleted.</p>
        </Dialog>
      )}
    </section>
  )
}

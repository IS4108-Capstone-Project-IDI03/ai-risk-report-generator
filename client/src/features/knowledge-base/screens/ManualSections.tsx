// A manual document's clauses (IN-18): the list in order, and an editor for the
// clause chosen (or a new one). Each save indexes the clause at once; one that
// failed to embed says so and offers Re-embed. The editor is part of the page,
// never a dialog, so a stray click can't lose typed text; choosing another clause
// or leaving with unsaved changes asks first. Shown by KnowledgeBase.tsx at
// /admin/knowledge-base/manual/<id>; talks to the gateway through api.ts.
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  Callout,
  Dialog,
  StatusPill,
  toast,
  TopBar,
  useIsPhone,
} from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  addManualSection,
  changeManualSection,
  deleteManualSection,
  getKnowledgeDocument,
  listManualSections,
  publishManualDocument,
  reembedManualSection,
  type KnowledgeDocument,
  type ManualSection,
} from '../api'
import { ClauseEditor } from '../components/ClauseEditor'
import { ClauseList } from '../components/ClauseList'
import { isDraft } from '../display'
import {
  BLANK,
  byOrder,
  formOf,
  inputOf,
  publishWait,
  type Form,
  type Show,
} from '../manualClauses'
import { Tip } from '../../help/Tip'
import { useFocusHeading } from '../useFocusHeading'
import '../review-document.css'
import '../manual-sections.css'

/** Returns the clauses page of one manual document. */
export function ManualSections({
  id,
  onBack,
  notify,
  bell,
}: {
  id: string
  onBack: () => void
  notify: (message: string) => void
  // The activity and notification icons, drawn in the top bar on desktop.
  bell?: ReactNode
}) {
  const phone = useIsPhone()
  const page = useFocusHeading<HTMLElement>()
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
  const [show, setShow] = useState<Show>('all')
  const [publishing, setPublishing] = useState(false)

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
          setLoadProblem(error instanceof Error ? error.message : "Couldn't load the clauses.")
      },
    )
    return () => controller.abort()
  }, [id])

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
          description: "Search couldn't be updated. Try it again from the list.",
        })
      // A new clause clears the editor for the next one; a change stays open.
      edit(selected ? saved : null)
    } catch (error: unknown) {
      const field = error instanceof GatewayError ? error.fields.clause : undefined
      if (field) setErrors({ clause: field })
      else
        setProblem(
          error instanceof GatewayError && error.status === null
            ? "Can't reach the server, so the clause wasn't saved. Try again."
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
          description: "Search couldn't be updated. Try again shortly.",
        })
    } catch (error: unknown) {
      toast.error("Couldn't try again", {
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

  // Publish (IN-18): the draft becomes searchable, or Needs review if it matches its PDF.
  const publish = async () => {
    if (!doc) return
    setPublishing(true)
    try {
      setDoc(await publishManualDocument(doc.id))
      notify(`${doc.title} published.`)
    } catch (error: unknown) {
      toast.error("Can't publish yet", {
        description: error instanceof Error ? error.message : 'Try again shortly.',
      })
    } finally {
      setPublishing(false)
    }
  }
  const wait = sections ? publishWait(sections) : null

  const meta = doc
    ? [
        [doc.issuingBody, doc.standardNumber].filter(Boolean).join(' ') || null,
        doc.edition ? `${doc.edition} edition` : null,
        'Entered manually',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined
  return (
    <section ref={page} className="kb-review kb-manual" aria-label="Manual standard">
      <TopBar
        eyebrow={phone ? undefined : 'Knowledge base'}
        title={doc?.title ?? 'Clauses'}
        helper={meta}
        titleItems={doc && isDraft(doc) ? <StatusPill status="manual_draft" /> : undefined}
        back={{ label: 'Back to Knowledge base', onClick: () => guard(onBack) }}
        // On a phone the title takes its own row and Publish wraps under it.
        stack
        action={
          doc && isDraft(doc) && sections ? (
            <span className="kb-manual-publish">
              <Button
                variant="create"
                iconLeft="check"
                loading={publishing}
                disabledReason={wait ? { title: "Can't publish yet", text: wait } : undefined}
                onClick={publish}
              >
                Publish
              </Button>
              <Tip id="knowledge-manual.publish" align="right" />
            </span>
          ) : undefined
        }
        bell={bell}
      />
      <div className="kb-content">
        {loadProblem && (
          <div role="alert">
            <Callout tone="danger" title="Couldn't load the clauses">
              {loadProblem}
            </Callout>
          </div>
        )}

        {sections && (
          <div className="kb-manual-body">
            <ClauseList
              sections={sections}
              selected={selected}
              dirty={dirty}
              show={show}
              onShow={setShow}
              onNew={() => guard(() => edit(null))}
              onOpen={(section) => selected?.id !== section.id && guard(() => edit(section))}
              onRetry={reembed}
            />
            <ClauseEditor
              documentId={id}
              sections={sections}
              selected={selected}
              form={form}
              errors={errors}
              problem={problem}
              busy={busy}
              dirty={dirty}
              onChange={(change) => setForm(change)}
              onSave={() => void save()}
              onUndo={() => edit(selected)}
              onDelete={() => setDeleting(true)}
            />
          </div>
        )}
      </div>

      {pending && (
        <Dialog
          title="Discard your changes?"
          width={420}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="secondary" pill onClick={() => setPending(null)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                pill
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
              <Button variant="secondary" pill disabled={busy} onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button variant="danger" pill loading={busy} onClick={remove}>
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

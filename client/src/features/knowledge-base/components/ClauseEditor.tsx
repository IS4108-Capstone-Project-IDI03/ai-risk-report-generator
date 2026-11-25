// The clauses page's editor (IN-18): the clause number, heading trail, text and screenshots of
// the clause chosen (or a new one), with Delete, Undo changes and Save. It is part of the page,
// never a dialog, so a stray click can't lose typed text. Used by screens/ManualSections.tsx.
import {
  Button,
  Callout,
  ChipInput,
  IconButton,
  Input,
  Textarea,
  Tooltip,
} from '../../../design-system'
import type { ManualSection } from '../api'
import { headingsAt, type Form } from '../manualClauses'
import { ClauseScreenshots } from './ClauseScreenshots'

/** Returns the clause editor form. */
export function ClauseEditor({
  documentId,
  sections,
  selected,
  form,
  errors,
  problem,
  busy,
  dirty,
  onChange,
  onSave,
  onUndo,
  onDelete,
}: {
  documentId: string
  sections: ManualSection[]
  selected: ManualSection | null
  form: Form
  errors: Partial<Record<'clause' | 'text', string>>
  // Why a save failed, above the fields.
  problem: string | null
  busy: boolean
  dirty: boolean
  onChange: (change: (form: Form) => Form) => void
  onSave: () => void
  onUndo: () => void
  onDelete: () => void
}) {
  const label = selected ? `Clause ${selected.clause}` : 'New clause'
  return (
    <form
      className="kb-manual-editor cl-card"
      aria-label={label}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
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
        hint="This clause's own number, e.g. 8.6.1. Put its title, if it has one, as the last heading in the trail."
        value={form.clause}
        error={errors.clause}
        onChange={(e) => onChange((f) => ({ ...f, clause: e.target.value }))}
      />
      <ChipInput
        label="Heading trail"
        itemName="heading"
        placeholder="Type a heading and press Enter"
        hint="Press Enter after each heading to add it. One per level, outermost first, e.g. Chapter 8 Installation, then 8.6 Hangers."
        value={form.headings}
        onChange={(headings) => onChange((f) => ({ ...f, headings }))}
        // The other clauses' headings; the clause being edited doesn't suggest its own.
        suggest={(level, before) =>
          headingsAt(
            sections.filter((s) => s.id !== selected?.id),
            level,
            before,
          )
        }
      />
      <Textarea
        label="Text"
        required
        rows={10}
        value={form.text}
        error={errors.text}
        onChange={(e) => onChange((f) => ({ ...f, text: e.target.value }))}
      />
      <ClauseScreenshots
        documentId={documentId}
        images={form.images}
        context={form.headings.join(' > ')}
        onChange={(change) => onChange((f) => ({ ...f, images: change(f.images) }))}
      />
      <div className="kb-manual-actions">
        {selected && (
          <Tooltip label="Delete clause">
            <IconButton
              icon="trash-2"
              label="Delete clause"
              title={undefined}
              variant="outline"
              style={{ borderRadius: 999, color: 'var(--red-600)' }}
              disabled={busy}
              onClick={onDelete}
            />
          </Tooltip>
        )}
        <Button variant="secondary" pill disabled={busy || !dirty} onClick={onUndo}>
          Undo changes
        </Button>
        <Button type="submit" variant="primary" pill loading={busy}>
          Save clause
        </Button>
      </div>
    </form>
  )
}

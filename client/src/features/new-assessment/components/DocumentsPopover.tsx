// The client card's documents button and popover (CP-23 AC12, board 09,
// motion 6): "Add documents", or "Documents · N" once there are some; each
// document with its Tag and a bin, then a dashed "Add documents" row. Files
// added here are tagged to the whole client and uploaded only on Create.
// Used by ClientCard.tsx. Calls DocumentRow.tsx and the form's actions.
import { useRef, useState } from 'react'
import { AddRow, Icon, Popover, toast, useIsPhone } from '../../../design-system'
import { plural } from '../../clients/formatClient'
import { tagOptions } from '../form'
import { ACCEPT, refusedType } from '../reading'
import type { NewAssessmentForm } from '../useNewAssessment'
import { DocumentRow } from './DocumentRow'

// Must match the gateway's upload limit (client-intake and client-document routes).
const LIMIT = 100_000_000

export function DocumentsPopover({ f }: { f: NewAssessmentForm }) {
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  const picker = useRef<HTMLInputElement>(null)
  const docs = f.form.documents
  const options = tagOptions(f.form, f.sitesOf)
  // Only accepted types under the limit are added; the rest are told why.
  const add = (files: File[]) => {
    const wrong = refusedType(files)
    const ok = files.filter((x) => !wrong.includes(x))
    const total = [...docs, ...ok].reduce((n, d) => n + d.size, 0)
    if (wrong.length) {
      const ext = wrong[0].name.split('.').pop()
      toast.error(`Can't read .${ext} files.`, {
        description: 'Add PDF, Word, Outlook (.msg) or .eml files.',
      })
    }
    if (total > LIMIT) {
      toast.error('Over 100 MB in total.', { description: 'Add fewer at once.' })
      return
    }
    if (!ok.length) return
    f.addDocuments(ok)
    toast.success(plural(ok.length, 'document') + ' added')
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Client documents"
      align="right"
      className="na-docs-anchor"
      surfaceClassName="na-docs-menu"
      trigger={
        <button
          type="button"
          className="na-docs-btn"
          aria-label={docs.length ? 'Documents · ' + docs.length : undefined}
          onClick={() => setOpen(!open)}
        >
          <Icon name="paperclip" size={16} />
          <span className="na-docs-word">{'Documents'}</span>
          {!!docs.length && <span className="na-count">{docs.length}</span>}
          <Icon name="chevron-down" size={16} className="na-docs-chev" />
        </button>
      }
    >
      <div className="na-docs-pop">
        {/* A phone's sheet already has this as its title. */}
        {!phone && (
          <h3>
            {'Client documents'}
            {!!docs.length && <span className="na-count">{docs.length}</span>}
          </h3>
        )}
        {!docs.length && <p className="na-docs-empty">{'No documents added yet'}</p>}
        {!!docs.length && (
          <ul className="na-doc-list">
            {docs.map((d, at) => (
              <DocumentRow
                key={d.fileId}
                doc={d}
                options={options}
                onTag={(p) => f.setPlacement(d.fileId, p)}
                onRemove={() => {
                  f.removeDocument(d.fileId)
                  toast.success('Document removed', {
                    action: { label: 'Undo', onClick: () => f.restoreDocument(d, at) },
                  })
                }}
              />
            ))}
          </ul>
        )}
        <AddRow onClick={() => picker.current?.click()}>{'Add documents'}</AddRow>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          aria-label="Add documents"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) add(files)
          }}
        />
      </div>
    </Popover>
  )
}

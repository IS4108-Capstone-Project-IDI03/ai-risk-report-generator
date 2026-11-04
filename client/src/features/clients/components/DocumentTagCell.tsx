// The Tag column of a document row (CP-23 AC14, board 07): the Tag pill, which
// opens the Tag picker in a Popover. Called by DocumentRow. Calls TagPill,
// TagPicker; the choice goes back to screens/DocumentsTab, which saves it.
import { useState } from 'react'
import { Popover, TagPicker, TagPill, type TagOption } from '../../../design-system'
import type { ClientDocument } from '../api'

export function DocumentTagCell({
  doc,
  options,
  onChoose,
}: {
  doc: ClientDocument
  options: TagOption[]
  // The chosen option's value.
  onChoose: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={`Tag for ${doc.name}`}
      align="left"
      surfaceClassName="cl-filter-menu"
      trigger={
        <TagPill
          label={doc.tag}
          aria-label={`Tag of ${doc.name}: ${doc.tag}`}
          onClick={() => setOpen(!open)}
        />
      }
    >
      <TagPicker
        options={options}
        value={options.find((o) => o.label === doc.tag)?.value}
        onChange={(value) => {
          setOpen(false)
          onChoose(value)
        }}
      />
    </Popover>
  )
}

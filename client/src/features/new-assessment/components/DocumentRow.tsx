// One document in the client card's Documents popover (CP-23 AC9, AC12,
// boards 08, 23): file tile, name and size, its Tag (Whole client, a site or an
// assessment) and a bin; on a phone the tag shows under the name and a tag icon opens
// the "Tag this document" sheet. Used by DocumentsPopover.tsx. Calls the design
// system's TagPill and TagPicker. On desktop the tag menu is drawn in the Documents popover,
// outside the scrolling list, so it hangs over the list instead of scrolling it.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FileTile,
  IconButton,
  Popover,
  useIsPhone,
  TagPicker,
  TagPill,
  type TagOption,
} from '../../../design-system'
import { fileSize } from '../../clients/formatClient'
import { placementOf, tagOf, type FormDocument } from '../form'
import type { Placement } from '../api'

export function DocumentRow({
  doc,
  options,
  onTag,
  onRemove,
}: {
  doc: FormDocument
  options: TagOption[]
  onTag: (placement: Placement) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Where the desktop tag menu hangs, from the Documents popover's top and right edges.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  // The Documents popover's box, found when the menu opens (not during render).
  const [host, setHost] = useState<HTMLElement | null>(null)
  const toggle = () => {
    const b = anchor.current?.getBoundingClientRect()
    const box = anchor.current?.closest<HTMLElement>('.na-docs-menu') ?? null
    setHost(box)
    const h = box?.getBoundingClientRect()
    if (b && h) setAt({ top: b.bottom - h.top + 4, right: h.right - b.right })
    setOpen(!open)
  }
  // Outside click or Escape closes the desktop menu (the phone sheet does its own).
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false)
    }
    // Escape closes only this menu, not the Documents popover under it.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const phone = useIsPhone()
  const value = tagOf(doc.placement)
  const label = options.find((o) => o.value === value)?.label ?? 'Whole client'
  const picker = (
    <TagPicker
      options={options}
      value={value}
      onChange={(v) => {
        setOpen(false)
        onTag(placementOf(v))
      }}
    />
  )
  return (
    <li className="na-doc">
      <FileTile name={doc.name} />
      <span className="na-doc-text">
        <span className="na-doc-name" dir="auto" title={doc.name}>
          {doc.name}
        </span>
        {phone ? (
          <span className="na-doc-size">{label}</span>
        ) : (
          doc.size > 0 && <span className="na-doc-size">{fileSize(doc.size)}</span>
        )}
      </span>
      {phone ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          ariaLabel="Tag this document"
          align="right"
          className="na-doc-tag"
          surfaceClassName="na-tag-menu"
          trigger={
            <IconButton
              icon="tag"
              label={`Tag of ${doc.name}: ${label}`}
              tooltip="Change tag"
              onClick={() => setOpen(!open)}
            />
          }
        >
          {picker}
        </Popover>
      ) : (
        <span ref={anchor} className="na-doc-tag">
          <TagPill
            wide
            label={label}
            aria-label={`Tag of ${doc.name}: ${label}`}
            aria-expanded={open}
            onClick={toggle}
          />
          {open &&
            createPortal(
              <div
                ref={menu}
                role="dialog"
                aria-label={'Tag for ' + doc.name}
                className="na-tag-menu na-tag-float"
                style={at ? { top: at.top, right: at.right } : undefined}
              >
                {picker}
              </div>,
              host ?? document.body,
            )}
        </span>
      )}
      <IconButton
        icon="trash-2"
        label={'Remove ' + doc.name}
        tooltip="Remove document"
        onClick={onRemove}
      />
    </li>
  )
}

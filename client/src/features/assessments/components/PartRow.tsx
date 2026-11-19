// One proposed part of a split note (CP-35): its editable text, what the engineer wrote, an
// Inferred chip, its flags, and Move to / Split / Merge with next / Delete.
// Called by SplitNotePanel. Calls PartFlag.
import { useLayoutEffect, useRef } from 'react'
import { Button, Select } from '../../../design-system'
import type { Part, PartKind } from '../api'
import { KIND_LABEL, splitPoint } from '../noteParts'
import { PartFlag } from './PartFlag'

type Props = {
  part: Part
  hasNext: boolean
  onText: (text: string) => void
  onMove: (kind: PartKind) => void
  onSplit: () => void
  onMerge: () => void
  onDelete: () => void
  onClearFlag: (flag: Part['flags'][number]) => void
  onAddTerm: (term: string, meaning: string) => Promise<void>
}

export function PartRow(p: Props) {
  const { part } = p
  const box = useRef<HTMLTextAreaElement>(null)
  // Grows the box to fit its text, so nothing hides behind a scroll bar.
  useLayoutEffect(() => {
    const el = box.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [part.text])
  return (
    <li className="sp-part">
      <textarea
        ref={box}
        className="sp-text"
        aria-label="Part text"
        rows={1}
        maxLength={5000}
        value={part.text}
        onChange={(e) => p.onText(e.target.value)}
      />
      {part.shorthand && <span className="sp-wrote">You wrote: {part.shorthand}</span>}
      {part.inferred && <span className="sp-inferred">Inferred</span>}
      {part.flags.map((f) => (
        <PartFlag
          key={f.type + f.detail}
          flag={f}
          onClear={() => p.onClearFlag(f)}
          onAddTerm={p.onAddTerm}
        />
      ))}
      <div className="sp-actions">
        <Select
          label="Move to"
          size="lg"
          value={part.kind}
          options={(Object.keys(KIND_LABEL) as PartKind[]).map((k) => ({
            value: k,
            label: KIND_LABEL[k],
          }))}
          onChange={(e) => p.onMove(e.target.value as PartKind)}
        />
        <Button variant="secondary" size="lg" disabled={!splitPoint(part.text)} onClick={p.onSplit}>
          Split
        </Button>
        {p.hasNext && (
          <Button variant="secondary" size="lg" onClick={p.onMerge}>
            Merge with next
          </Button>
        )}
        <Button variant="ghost" size="lg" onClick={p.onDelete}>
          Delete
        </Button>
      </div>
    </li>
  )
}

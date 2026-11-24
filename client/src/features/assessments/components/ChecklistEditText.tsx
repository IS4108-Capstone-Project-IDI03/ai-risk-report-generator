// The inline editor for a checklist question (CP-37): looks like the row's own text, grows with
// it, saves on blur or Enter, cancels on Escape. Called by ChecklistRow.
import { useLayoutEffect, useRef, useState } from 'react'
import { WORDS_MAX, WORDS_MESSAGE, wordCount } from '../checklistChecks'
import '../checklist.css'

/** Returns the borderless text box; onSave resolves when saved, onDone closes the editor. */
export function ChecklistEditText({
  initial,
  label,
  onSave,
  onDone,
}: {
  initial: string
  label: string
  onSave: (text: string) => Promise<void>
  onDone: () => void
}) {
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  // Set once Enter, Escape or blur has decided, so the blur that follows doesn't save twice.
  const decided = useRef(false)
  // Grow to fit the text; without this a long question would scroll inside one line.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [text])
  const finish = async () => {
    if (decided.current) return
    decided.current = true
    const next = text.trim()
    // Empty or unchanged: nothing to save, show the old text.
    if (!next || next === initial) return onDone()
    // Over the limit: stay open and say why; the message below the box shows it.
    if (wordCount(next) > WORDS_MAX) {
      decided.current = false
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      onDone()
    } catch {
      // The parent says why; stay open to try again.
      decided.current = false
      setSaving(false)
    }
  }
  const tooLong = wordCount(text) > WORDS_MAX
  return (
    <div className="cl-edit-wrap">
      <textarea
        ref={box}
        className="cl-edit"
        aria-label={label}
        rows={1}
        autoFocus
        value={text}
        readOnly={saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void finish()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void finish()
          }
          if (e.key === 'Escape') {
            decided.current = true
            onDone()
          }
        }}
      />
      {tooLong && (
        <p role="alert" className="cl-note cl-error">
          {WORDS_MESSAGE}
        </p>
      )}
    </div>
  )
}

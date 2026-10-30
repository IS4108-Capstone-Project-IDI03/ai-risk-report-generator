// The box that adds or edits one fact in "My preferences" (CB-05). Used by components/PreferencesPanel.tsx
// (add) and components/FactRow.tsx (edit). Calls the `onSubmit` it is given; it knows no API.
import { useState } from 'react'
import { Button, Textarea } from '../../../design-system'

type Props = {
  initial?: string
  max: number
  label: string
  submitLabel: string
  // Saves the text; a thrown error's message is shown under the box.
  onSubmit: (text: string) => Promise<void>
  onCancel?: () => void
}

/** A short text box with a character count. Enter saves; Shift+Enter adds a line, which the gateway folds into one line. */
export function FactForm({ initial = '', max, label, submitLabel, onSubmit, onCancel }: Props) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const clean = text.trim()
  const save = async () => {
    if (!clean || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(clean)
      // An edit closes itself; an add clears the box for the next fact.
      if (!initial) setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fact-form">
      <Textarea
        label={label}
        rows={3}
        // Editing a fact puts the cursor in the box; the add box keeps the dialog's own focus.
        autoFocus={!!initial}
        value={text}
        maxLength={max}
        error={error || undefined}
        hint={`${text.length} of ${max} characters`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void save()
          }
        }}
      />
      {/* Read out when a fact is refused: the error under the box is not announced by itself. */}
      <p role="alert" className="preferences__sr-only">
        {error}
      </p>
      <div className="fact-form__actions">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={!clean || busy} onClick={() => void save()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

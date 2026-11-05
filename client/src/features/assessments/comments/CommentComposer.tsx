// Writing a comment (RV-03): a new thread's first comment, a reply, or an
// edit. Ctrl+Enter (Cmd+Enter) posts; Escape cancels.
import { useState } from 'react'
import { Button, Textarea } from '../../../design-system'
import type { CommentInput } from './api'

export function CommentComposer({
  label,
  placeholder = 'Add a comment',
  submitLabel,
  initial,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  // The field's accessible name.
  label: string
  placeholder?: string
  submitLabel: string
  // An edited comment's words.
  initial?: string
  // Posts; resolves to a problem to show, or null once posted.
  onSubmit: (input: CommentInput) => Promise<string | null>
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [body, setBody] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setProblem(null)
    const failed = await onSubmit({ body: text })
    setBusy(false)
    if (failed) setProblem(failed)
    else if (initial === undefined) setBody('')
  }

  return (
    <div className="cm-composer">
      <Textarea
        aria-label={label}
        placeholder={placeholder}
        rows={2}
        value={body}
        autoFocus={autoFocus}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        style={{ resize: 'none', fontSize: 'var(--text-small-size)' }}
      />
      {problem && (
        <p className="cm-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="cm-composer-actions">
        {onCancel && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          pill
          disabled={!body.trim()}
          loading={busy}
          onClick={() => void submit()}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

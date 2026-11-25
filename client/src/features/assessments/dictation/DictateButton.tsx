// A microphone button beside an assessment's text field (CP-27): the engineer speaks, and the
// words, tidied by S5 (no "um", stumbles or taken-back words), go into the field to check
// before saving. The clip is stored nowhere.
import { useCallback } from 'react'
import { Icon, IconButton } from '../../../design-system'
import { dictate, withDictated } from './dictate'
import { useRecorder } from './useRecorder'
import './dictation.css'

type Props = {
  // The assessment the field belongs to: its client details are masked before any model reads it.
  reference: string
  // The field the words go into, found when they arrive (the shared Textarea takes no ref).
  field: () => HTMLTextAreaElement | HTMLInputElement | null | undefined
  // Called with the field's new value, as typing would.
  onChange: (value: string) => void
}

export function DictateButton({ reference, field, onChange }: Props) {
  const onClip = useCallback(
    async (clip: Blob) => {
      const text = await dictate(reference, clip)
      const box = field()
      if (!box) return onChange(text)
      // The cursor or selection is still on the field after the button took focus.
      const end = box.selectionEnd ?? box.value.length
      const next = withDictated(box.value, box.selectionStart ?? end, end, text)
      onChange(next.value)
      // After the new value is drawn, so the cursor isn't moved back to the end.
      requestAnimationFrame(() => {
        box.focus()
        box.setSelectionRange(next.caret, next.caret)
      })
    },
    [reference, field, onChange],
  )
  const { state, stop, start, note } = useRecorder({ onClip })
  const live = state === 'recording' || state === 'paused'
  return (
    <span className="dictate">
      {live ? (
        <IconButton icon="square" label="Stop dictating" onClick={stop} />
      ) : (
        <IconButton
          icon="mic"
          label="Dictate"
          disabled={state === 'working' || state === 'starting'}
          onClick={() => void start()}
        />
      )}
      {/* Errors follow design system v2: a red icon and short problem, then the fix in grey. */}
      {note && (
        <span className="dictate__note" role="alert">
          <Icon name="circle-alert" size={16} />
          <strong>{note.problem}</strong>
          {note.fix && <span>{note.fix}</span>}
        </span>
      )}
    </span>
  )
}

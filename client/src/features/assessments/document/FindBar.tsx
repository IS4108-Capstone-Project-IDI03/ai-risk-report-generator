import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Button, IconButton, IconRegistry, Input } from '../../../design-system'
import { replaceAll, replaceCurrent, searchOf, setQuery, step } from './findReplace'

// Find and replace across every section (AC8): typing highlights each match,
// Enter and Shift+Enter step through them, and each can be replaced on its
// own or all at once. Escape closes it and returns to the document.
export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [replacement, setReplacement] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const { query, current, count } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = searchOf(e)
      return { query: s.query, current: s.current, count: s.matches.length }
    },
  })

  const close = () => {
    setQuery(editor, '')
    onClose()
    editor.commands.focus()
  }
  const status = !query
    ? 'Type to find text in every section.'
    : count
      ? `${current + 1} of ${count} match${count === 1 ? '' : 'es'}`
      : 'No matches'
  return (
    <div
      role="search"
      aria-label="Find and replace"
      className="dm-find"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <div className="dm-find-fields">
        <Input
          label="Find"
          autoFocus
          size="sm"
          value={query}
          onChange={(event) => {
            setDone(null)
            setQuery(editor, event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              step(editor, event.shiftKey ? -1 : 1)
            }
          }}
        />
        <Input
          label="Replace with"
          size="sm"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </div>
      <div className="dm-find-actions">
        <p className="dm-find-status" aria-live="polite">
          {done ?? status}
        </p>
        <IconButton
          icon={IconRegistry.editor.previous}
          size="sm"
          label="Previous match"
          disabled={!count}
          onClick={() => step(editor, -1)}
        />
        <IconButton
          icon={IconRegistry.editor.next}
          size="sm"
          label="Next match"
          disabled={!count}
          onClick={() => step(editor, 1)}
        />
        <Button
          variant="secondary"
          size="sm"
          iconLeft={IconRegistry.editor.replace}
          disabled={!count}
          onClick={() => replaceCurrent(editor, replacement)}
        >
          Replace
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={IconRegistry.editor.replaceAll}
          disabled={!count}
          onClick={() => {
            const n = replaceAll(editor, replacement)
            setDone(`Replaced ${n} match${n === 1 ? '' : 'es'}.`)
          }}
        >
          Replace all
        </Button>
        <IconButton icon={IconRegistry.action.close} size="sm" label="Close find" onClick={close} />
      </div>
    </div>
  )
}

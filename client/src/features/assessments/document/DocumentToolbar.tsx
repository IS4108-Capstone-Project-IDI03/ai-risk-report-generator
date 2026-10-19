import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { IconButton, IconRegistry } from '../../../design-system'
import { toggleSubheading } from './commands'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
// A shortcut as the engineer's keyboard names it, and as aria-keyshortcuts does.
const shortcut = (keys: string[]) => ({
  label: keys.map((k) => (k === 'Mod' ? (MAC ? 'Cmd' : 'Ctrl') : k)).join('+'),
  aria: keys.map((k) => (k === 'Mod' ? (MAC ? 'Meta' : 'Control') : k)).join('+'),
})

type Tool = {
  name: string
  icon: string
  keys: string[]
  active?: boolean
  disabled?: boolean
  title?: string
  run: () => void
}

// The document editor's formatting toolbar (AC6) with undo and redo (AC7),
// each with its keyboard shortcut in its name.
export function DocumentToolbar({ editor, onFind }: { editor: Editor; onFind: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      heading: e.isActive('heading'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()
  const groups: Tool[][] = [
    [
      {
        name: 'Bold',
        icon: IconRegistry.editor.bold,
        keys: ['Mod', 'B'],
        active: state.bold,
        run: () => chain().toggleBold().run(),
      },
      {
        name: 'Italic',
        icon: IconRegistry.editor.italic,
        keys: ['Mod', 'I'],
        active: state.italic,
        run: () => chain().toggleItalic().run(),
      },
      {
        name: 'Underline',
        icon: IconRegistry.editor.underline,
        keys: ['Mod', 'U'],
        active: state.underline,
        run: () => chain().toggleUnderline().run(),
      },
    ],
    [
      {
        name: 'Sub-heading',
        icon: IconRegistry.editor.subheading,
        keys: ['Mod', 'Alt', '4'],
        active: state.heading,
        run: () => {
          editor.commands.focus()
          toggleSubheading(editor)
        },
      },
      {
        name: 'Bulleted list',
        icon: IconRegistry.editor.bulletList,
        keys: ['Mod', 'Shift', '8'],
        active: state.bullet,
        run: () => chain().toggleBulletList().run(),
      },
      {
        name: 'Numbered list',
        icon: IconRegistry.editor.orderedList,
        keys: ['Mod', 'Shift', '7'],
        active: state.ordered,
        run: () => chain().toggleOrderedList().run(),
      },
    ],
    [
      {
        name: 'Undo',
        icon: IconRegistry.editor.undo,
        keys: ['Mod', 'Z'],
        disabled: !state.undo,
        run: () => chain().undo().run(),
      },
      {
        name: 'Redo',
        icon: IconRegistry.editor.redo,
        keys: ['Mod', 'Shift', 'Z'],
        disabled: !state.redo,
        run: () => chain().redo().run(),
      },
    ],
    [
      {
        name: 'Find and replace',
        icon: IconRegistry.action.search,
        keys: ['Mod', 'F'],
        run: onFind,
      },
    ],
  ]
  return (
    <div role="toolbar" aria-label="Formatting" className="dm-tools">
      {groups.map((group, i) => (
        <div key={i} className="dm-tool-group">
          {group.map((tool) => {
            const keys = shortcut(tool.keys)
            const pressable = tool.active !== undefined
            return (
              <IconButton
                key={tool.name}
                icon={tool.icon}
                size="sm"
                label={`${tool.name} (${keys.label})`}
                title={tool.title ?? `${tool.name} (${keys.label})`}
                aria-keyshortcuts={keys.aria}
                aria-pressed={pressable ? !!tool.active : undefined}
                selected={!!tool.active}
                disabled={tool.disabled}
                // Keeps the selection in the document while the button is pressed.
                onMouseDown={(event) => event.preventDefault()}
                onClick={tool.run}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

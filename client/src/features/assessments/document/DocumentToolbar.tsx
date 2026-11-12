import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { IconButton, IconRegistry, type Reason } from '../../../design-system'
import { editorPassage } from '../ask/passage'
import { commentTarget } from '../comments/anchor'
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
  // Greyed out, with a reason box saying why (design system v2).
  reason?: Reason
  title?: string
  run: () => void
}

// Commenting (RV-03): starting a thread on the selected text, and the
// comments list with how many threads are open.
export type CommentTools = {
  // Absent for someone who can only read the threads.
  onComment?: () => void
  onList: () => void
  listOpen: boolean
  open: number
}

// Asking about the selected text (AS-02): Ask about this, and the panel with
// the questions asked and their answers. `labelOf` heads a section as the
// report does.
export type AskTools = {
  onAsk: () => void
  onPanel: () => void
  panelOpen: boolean
  labelOf: (sectionId: string) => string
}

// The document editor's formatting toolbar (AC6) with undo and redo (AC7),
// each with its keyboard shortcut in its name; then Comment and the comments
// list (RV-03), and Ask about this and the Ask panel (AS-02). Read only, it
// keeps Find, Comment, Ask and the lists.
export function DocumentToolbar({
  editor,
  onFind,
  readOnly = false,
  comments,
  ask,
}: {
  editor: Editor
  onFind: () => void
  readOnly?: boolean
  // Offered to anyone who can comment on the report (RV-03 AC7).
  comments?: CommentTools
  // Offered to anyone with reports:ask (AS-02).
  ask?: AskTools
}) {
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
      from: e.state.selection.from,
      to: e.state.selection.to,
    }),
  })
  // Why the selection can't take a comment, if it can't (AC1).
  const target = comments?.onComment ? commentTarget(editor.state.doc, state.from, state.to) : null
  // Why it can't be asked about, if it can't (AS-02 AC1).
  const askTarget = ask ? editorPassage(editor.state.doc, state.from, state.to, ask.labelOf) : null
  const chain = () => editor.chain().focus()
  const formatting: Tool[][] = [
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
  ]
  const find: Tool[] = [
    {
      name: readOnly ? 'Find' : 'Find and replace',
      icon: IconRegistry.action.search,
      keys: ['Mod', 'F'],
      run: onFind,
    },
  ]
  const onComment = comments?.onComment
  const commenting: Tool[] = comments
    ? [
        ...(onComment
          ? [
              {
                name: 'Comment',
                icon: IconRegistry.editor.comment,
                keys: ['Mod', 'Alt', 'M'],
                reason: target && 'reason' in target ? target.reason : undefined,
                run: onComment,
              },
            ]
          : []),
        {
          name: comments.open ? `Comments, ${comments.open} open` : 'Comments',
          icon: IconRegistry.editor.comments,
          keys: [],
          active: comments.listOpen,
          run: comments.onList,
        },
      ]
    : []
  const asking: Tool[] = ask
    ? [
        {
          name: 'Ask about this',
          icon: IconRegistry.editor.ask,
          keys: ['Mod', 'Alt', 'K'],
          reason: askTarget && 'reason' in askTarget ? askTarget.reason : undefined,
          run: ask.onAsk,
        },
        {
          name: 'Ask about this assessment',
          icon: IconRegistry.editor.askPanel,
          keys: [],
          active: ask.panelOpen,
          run: ask.onPanel,
        },
      ]
    : []
  const groups = [...(readOnly ? [] : formatting), find, commenting, asking].filter((g) => g.length)
  return (
    <div role="toolbar" aria-label={readOnly ? 'Tools' : 'Formatting'} className="dm-tools">
      {groups.map((group, i) => (
        <div key={i} className="dm-tool-group">
          {group.map((tool) => {
            const keys = shortcut(tool.keys)
            const pressable = tool.active !== undefined
            const name = tool.keys.length ? `${tool.name} (${keys.label})` : tool.name
            return (
              <IconButton
                key={tool.icon}
                icon={tool.icon}
                size="sm"
                label={name}
                title={tool.reason ? undefined : (tool.title ?? name)}
                aria-keyshortcuts={tool.keys.length ? keys.aria : undefined}
                aria-pressed={pressable ? !!tool.active : undefined}
                selected={!!tool.active}
                disabled={tool.disabled}
                disabledReason={tool.reason}
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

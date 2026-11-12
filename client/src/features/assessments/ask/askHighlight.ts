// Asking about a passage in the document editor (AS-02). Ctrl+Alt+K
// (Cmd+Option+K) asks about the selected text, as the toolbar's Ask about this
// does. The passage in the question box, and one an answer went back to, are
// marked with decorations only: nothing is added to the text, so asking never
// changes a section's text, version or review state (AC5), and the export's
// editor knows nothing of it. Each mark moves with the text as it is edited.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

type Range = { from: number; to: number }
// `pending`: the passage in the question box; `shown`: the one gone back to.
export type AskMarks = { pending: Range | null; shown: Range | null }
type AskState = AskMarks & { decorations: DecorationSet }

const askKey = new PluginKey<AskState>('dmAsk')

function decorate(doc: PMNode, marks: AskMarks) {
  const decorations: Decoration[] = []
  if (marks.shown)
    decorations.push(Decoration.inline(marks.shown.from, marks.shown.to, { class: 'dm-asked' }))
  if (marks.pending)
    decorations.push(
      Decoration.inline(marks.pending.from, marks.pending.to, { class: 'dm-asked is-pending' }),
    )
  return DecorationSet.create(doc, decorations)
}

// Changes what is marked, outside the undo history and not as a change to
// the text: the editor neither saves for it nor counts it as unsaved.
export function setAskMarks(view: EditorView, change: Partial<AskMarks>) {
  view.dispatch(
    view.state.tr
      .setMeta(askKey, change)
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true),
  )
}

const mapped = (range: Range | null, tr: Transaction) => {
  if (!range) return null
  const from = tr.mapping.map(range.from, 1)
  const to = tr.mapping.map(range.to, -1)
  return to > from ? { from, to } : null
}

// `onAsk` is Ask about this's shortcut; it says whether it asked, so the key
// press goes on as usual for someone who can't ask.
export const AskHighlight = Extension.create<{ onAsk: () => boolean }>({
  name: 'askHighlight',
  addOptions: () => ({ onAsk: () => false }),
  addKeyboardShortcuts() {
    return { 'Mod-Alt-k': () => this.options.onAsk() }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<AskState>({
        key: askKey,
        state: {
          init: (_, state) => {
            const marks: AskMarks = { pending: null, shown: null }
            return { ...marks, decorations: decorate(state.doc, marks) }
          },
          apply: (tr, value) => {
            const change = tr.getMeta(askKey) as Partial<AskMarks> | undefined
            if (!change && !tr.docChanged) return value
            const marks: AskMarks = {
              pending:
                change && 'pending' in change
                  ? (change.pending ?? null)
                  : mapped(value.pending, tr),
              shown: change && 'shown' in change ? (change.shown ?? null) : mapped(value.shown, tr),
            }
            return { ...marks, decorations: decorate(tr.doc, marks) }
          },
        },
        props: { decorations: (state) => askKey.getState(state)?.decorations },
      }),
    ]
  },
})

// Find and replace across the whole document (RV-08 AC8). Matches are found
// in the editable text only, never across a citation marker, and ignoring
// case. Every match is highlighted and the current one marked; a replacement
// keeps the formatting where the match starts, and Replace all is one undo.
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type Match = { from: number; to: number }
type SearchState = { query: string; current: number; matches: Match[]; set: DecorationSet }

const searchKey = new PluginKey<SearchState>('dmSearch')
// A citation marker in the searched text, so no match spans one.
const MARKER = '￼'

export function findMatches(doc: PMNode, query: string): Match[] {
  const needle = query.toLocaleLowerCase()
  if (!needle) return []
  const matches: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? child.text! : MARKER.repeat(child.nodeSize)
    })
    const haystack = text.toLocaleLowerCase()
    // Lower-casing keeps the length of the text the report holds; if a
    // character changes length, the block is searched as written.
    const searched = haystack.length === text.length ? haystack : text
    for (
      let at = searched.indexOf(needle);
      at !== -1;
      at = searched.indexOf(needle, at + needle.length)
    )
      matches.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length })
    return false
  })
  return matches
}

function decorate(doc: PMNode, matches: Match[], current: number) {
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === current ? 'dm-match is-current' : 'dm-match',
      }),
    ),
  )
}

function searchState(doc: PMNode, query: string, current: number): SearchState {
  const matches = findMatches(doc, query)
  const index = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1
  return { query, current: index, matches, set: decorate(doc, matches, index) }
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: (_, state) => searchState(state.doc, '', -1),
          apply: (tr, previous) => {
            const set = tr.getMeta(searchKey) as Partial<SearchState> | undefined
            if (set) return searchState(tr.doc, set.query ?? previous.query, set.current ?? 0)
            return tr.docChanged ? searchState(tr.doc, previous.query, previous.current) : previous
          },
        },
        props: { decorations: (state) => searchKey.getState(state)?.set },
      }),
    ]
  },
})

export function searchOf(editor: Editor) {
  const state = searchKey.getState(editor.state)
  return { query: state?.query ?? '', current: state?.current ?? -1, matches: state?.matches ?? [] }
}

// Shows the match, selecting it so the document scrolls to it, while the
// focus stays in the find bar.
function reveal(editor: Editor, query: string, current: number) {
  const { tr } = editor.state
  tr.setMeta(searchKey, { query, current })
  const match = findMatches(editor.state.doc, query)[current]
  if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView()
  editor.view.dispatch(tr)
}

export function setQuery(editor: Editor, query: string) {
  reveal(editor, query, 0)
}

export function step(editor: Editor, by: 1 | -1) {
  const { query, current, matches } = searchOf(editor)
  if (!matches.length) return
  reveal(editor, query, (current + by + matches.length) % matches.length)
}

export function replaceCurrent(editor: Editor, replacement: string) {
  const { query, current, matches } = searchOf(editor)
  const match = matches[current]
  if (!match) return
  const tr = editor.state.tr
  if (replacement) tr.insertText(replacement, match.from, match.to)
  else tr.delete(match.from, match.to)
  tr.setMeta(searchKey, { query, current })
  editor.view.dispatch(tr)
  // On to the next match after the replacement, which may itself match.
  const next = searchOf(editor).matches.findIndex((m) => m.from >= match.from + replacement.length)
  reveal(editor, query, Math.max(next, 0))
}

// Replaces every match, last first so earlier positions hold; one undo step.
export function replaceAll(editor: Editor, replacement: string): number {
  const { query, matches } = searchOf(editor)
  if (!matches.length) return 0
  const tr = editor.state.tr
  for (const match of [...matches].reverse()) {
    if (replacement) tr.insertText(replacement, match.from, match.to)
    else tr.delete(match.from, match.to)
  }
  tr.setMeta(searchKey, { query, current: 0 })
  editor.view.dispatch(tr)
  return matches.length
}

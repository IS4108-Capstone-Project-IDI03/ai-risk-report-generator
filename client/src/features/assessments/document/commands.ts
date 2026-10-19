// The document editor's own commands (RV-08).
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

// Sets every paragraph in the selection as a sub-heading, or, when they all
// are already, back to paragraphs (AC6). Unlike TipTap's toggleHeading, each
// block keeps its own finding, so a drafted finding set as a sub-heading is
// still that finding, wherever the selection starts and ends. List items
// stay paragraphs, as a list holds one paragraph per item.
export function toggleSubheading(editor: Editor): boolean {
  const { state } = editor
  const { heading, paragraph } = state.schema.nodes
  const blocks: { node: PMNode; pos: number }[] = []
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos, parent) => {
    if (!node.isTextblock) return true
    if (parent?.type.name !== 'listItem') blocks.push({ node, pos })
    return false
  })
  if (!blocks.length) return false
  const target = blocks.every(({ node }) => node.type === heading) ? paragraph : heading
  const tr = state.tr
  for (const { node, pos } of blocks) {
    if (node.type === target) continue
    tr.setNodeMarkup(pos, target, {
      ...(target === heading && { level: 4 }),
      finding: node.attrs.finding ?? null,
    })
  }
  if (!tr.docChanged) return false
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

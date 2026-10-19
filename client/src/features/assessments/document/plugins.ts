// The document editor's review plugins (RV-08):
// - the structure guard keeps the report's sections, fixed headings, notices
//   and locked parts where they are, whatever is typed, deleted or pasted;
// - the tidy-up keeps each finding in one paragraph of its own section, and
//   a paragraph to write in in every section without subsections;
// - the review decorations draw citation numbers, AI styling on passages
//   still in the draft's words (AC12) and the flag on a passage that is
//   unsupported, cites a withdrawn source, or has lost a citation (AC10, AC11).
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { citesOf, signature } from '../documentContent'
import { inlineOf } from './convert'

const inBlockGroup = (node: PMNode) => (node.type.spec.group ?? '').split(' ').includes('block')

// What the engineer cannot change: each section's id and the order of its
// fixed parts, down to its subsections' headings and locked parts.
function skeleton(doc: PMNode): string {
  const sections: string[] = []
  doc.forEach((section) => {
    const parts: string[] = [section.attrs.id as string]
    section.forEach((child) => {
      if (inBlockGroup(child)) return
      if (child.type.name === 'subsection') {
        const fixed: string[] = []
        child.forEach((c) => {
          if (!inBlockGroup(c)) fixed.push(`${c.type.name}:${c.attrs.label ?? c.attrs.kind ?? ''}`)
        })
        parts.push(`subsection:${child.attrs.heading as string}[${fixed.join(',')}]`)
      } else
        parts.push(
          `${child.type.name}:${child.attrs.label ?? ''}:${child.attrs.kind ?? ''}:${child.attrs.title ?? ''}`,
        )
    })
    sections.push(parts.join('|'))
  })
  return sections.join('\n')
}

// Set on a transaction allowed to change the structure: none in the editor;
// replacing the whole document on reload is done by a new editor.
export const STRUCTURE_META = 'dmStructure'

const structureGuard = new Plugin({
  key: new PluginKey('dmStructureGuard'),
  filterTransaction: (tr: Transaction, state) =>
    !tr.docChanged ||
    tr.getMeta(STRUCTURE_META) === 'allow' ||
    skeleton(tr.doc) === skeleton(state.doc),
})

const tidyUp = new Plugin({
  key: new PluginKey('dmTidyUp'),
  appendTransaction: (transactions, _old, state) => {
    if (!transactions.some((t) => t.docChanged)) return null
    const tr = state.tr
    const seen = new Set<string>()
    const empty: number[] = []
    state.doc.forEach((section, offset) => {
      let subsections = 0
      let blocks = 0
      section.forEach((child) => {
        if (child.type.name === 'subsection') subsections += 1
        else if (inBlockGroup(child)) blocks += 1
      })
      if (!subsections && !blocks) empty.push(offset + section.nodeSize - 1)
      section.descendants((node, pos) => {
        // Paragraphs and sub-headings, wherever they are.
        if (!node.isTextblock) return true
        const finding = node.attrs.finding as string | null
        if (finding) {
          // Pasted into another section, or a second copy: the words are kept
          // as the engineer's own text.
          if (!finding.startsWith(`${section.attrs.id as string}:`) || seen.has(finding))
            tr.setNodeAttribute(offset + 1 + pos, 'finding', null)
          else seen.add(finding)
        }
        return false
      })
    })
    for (const at of empty.reverse()) tr.insert(at, state.schema.nodes.paragraph.create())
    return tr.docChanged ? tr : null
  },
})

// Why a passage is flagged: a short label for its badge and what it means.
export type PassageFlag = { label: string; detail: string }
// What the review decorations know of each finding, by its `finding` value.
export type PassageInfo = {
  // The passage's content signature while it reads as the draft wrote it and
  // no one has decided on it; null when it is not AI styled.
  aiSignature: string | null
  // Its citations when the editor opened.
  citations: string[]
  // Whether deleting one of those citations flags it (sections 4-12).
  watchCitations: boolean
  // Why it is flagged when the editor opened, if it is.
  flag: PassageFlag | null
}
export type ReviewContext = {
  passages: Map<string, PassageInfo>
  // A citation in words, for its marker's accessible name.
  describe: (sectionId: string, citation: string) => string
}

const DELETED_CITATION: PassageFlag = {
  label: 'Citation deleted',
  detail:
    'You deleted a citation this finding was drafted with. Once saved, it is flagged Unsupported in the review workspace until resolved there. Undo to put the citation back.',
}

function flagWidget(flag: PassageFlag) {
  const wrap = document.createElement('span')
  wrap.className = 'dm-flag'
  wrap.contentEditable = 'false'
  wrap.title = flag.detail
  const badge = document.createElement('span')
  badge.className = 'dm-flag-badge'
  badge.textContent = flag.label
  const detail = document.createElement('span')
  detail.className = 'dm-visually-hidden'
  detail.textContent = `: ${flag.detail}`
  wrap.append(badge, detail)
  return wrap
}

function reviewDecorations(doc: PMNode, context: ReviewContext): DecorationSet {
  const decorations: Decoration[] = []
  doc.forEach((section, offset) => {
    const sectionId = section.attrs.id as string
    const numbers = new Map<string, number>()
    section.descendants((node, pos, parent) => {
      const at = offset + 1 + pos
      if (node.type.name === 'citation') {
        const id = node.attrs.id as string
        if (!numbers.has(id)) numbers.set(id, numbers.size + 1)
        const label = `Citation ${numbers.get(id)}: ${context.describe(sectionId, id)}`
        decorations.push(
          Decoration.node(at, at + node.nodeSize, {
            'data-n': String(numbers.get(id)),
            'aria-label': label,
            title: label,
            role: 'img',
          }),
        )
        return false
      }
      if (!node.isTextblock || !node.attrs.finding) return true
      const info = context.passages.get(node.attrs.finding as string)
      // Its citation markers are numbered as its children are visited.
      if (!info) return true
      const content = inlineOf(node)
      // Still as drafted: a plain paragraph, in the draft's words. Set as a
      // sub-heading or a list item, it is the engineer's.
      const plain = node.type.name === 'paragraph' && parent?.type.name !== 'listItem'
      if (plain && info.aiSignature !== null && signature(content) === info.aiSignature)
        decorations.push(Decoration.node(at, at + node.nodeSize, { class: 'dm-ai' }))
      const now = citesOf(content)
      const deleted = info.watchCitations && info.citations.some((c) => !now.includes(c))
      const flag = deleted ? DELETED_CITATION : info.flag
      if (flag) {
        decorations.push(Decoration.node(at, at + node.nodeSize, { class: 'dm-flagged' }))
        decorations.push(
          Decoration.widget(at + node.nodeSize - 1, () => flagWidget(flag), {
            side: 1,
            ignoreSelection: true,
            key: `${node.attrs.finding as string}:${flag.label}`,
          }),
        )
      }
      return true
    })
  })
  return DecorationSet.create(doc, decorations)
}

const reviewKey = new PluginKey<DecorationSet>('dmReview')

// The plugins above, with what the review decorations need to know.
export const ReviewPlugins = Extension.create<{ context: ReviewContext }>({
  name: 'reviewPlugins',
  addOptions: () => ({ context: { passages: new Map(), describe: () => 'Source' } }),
  addProseMirrorPlugins() {
    const { context } = this.options
    return [
      structureGuard,
      tidyUp,
      new Plugin<DecorationSet>({
        key: reviewKey,
        state: {
          init: (_, state) => reviewDecorations(state.doc, context),
          apply: (tr, set) => (tr.docChanged ? reviewDecorations(tr.doc, context) : set),
        },
        props: { decorations: (state) => reviewKey.getState(state) },
      }),
    ]
  },
})

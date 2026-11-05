// Section 6's Management Programs in Marsh's page layout (GN-11, EX-01 AC7):
// the subsection's rows, "<Program>: <Rank>. <comment>", are written as
// paragraphs, one per finding; on the page they read as Marsh's two tables,
// each rank coloured (ProgramsTable in ReportParts.tsx, drawn by the
// subsection's `programs` locked part). The rows that table shows are hidden
// in the page layout; text the engineer wrote around them stays where it is.
// The continuous view shows the paragraphs as they are, to edit.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { citesOf, plainText } from '../../documentContent'
import { MANAGEMENT_PROGRAMS, programRow } from '../../reviewDisplay'
import { inlineOf } from '../convert'
import { citationNumbers } from '../plugins'

export const PROGRAMS_SECTION = '6'
export const PROGRAMS_SUBSECTION = 'Management Programs'

export const isProgramsSubsection = (sectionId: string, heading: string) =>
  sectionId === PROGRAMS_SECTION && heading === PROGRAMS_SUBSECTION

// One row the table shows: its program, rank and comment, and the numbers of
// the citations it carries, as its section numbers them.
export type ProgramRow = {
  program: string
  rank: string | null
  comment: string
  cites: number[]
}

const PROGRAMS = new Set(MANAGEMENT_PROGRAMS)

// The subsection's paragraphs the table shows, by their position in the
// subsection: the first naming each of Marsh's programs. Any other is the
// engineer's text and stays a paragraph.
export function programRowsOf(
  section: PMNode,
  subsection: PMNode,
): { rows: ProgramRow[]; placed: Set<number> } {
  const numbers = citationNumbers(section)
  const rows: ProgramRow[] = []
  const placed = new Set<number>()
  const seen = new Set<string>()
  subsection.forEach((child, offset) => {
    if (child.type.name !== 'paragraph') return
    const content = inlineOf(child)
    const { program, rank, comment } = programRow(plainText(content))
    if (!program || !PROGRAMS.has(program) || seen.has(program)) return
    seen.add(program)
    placed.add(offset)
    rows.push({
      program,
      rank,
      comment,
      cites: citesOf(content).flatMap((id) => (numbers.has(id) ? [numbers.get(id)!] : [])),
    })
  })
  return { rows, placed }
}

const key = new PluginKey<DecorationSet>('dmProgramRows')

// The rows the table shows, marked (exported for its test).
export function programRowDecorations(doc: PMNode): DecorationSet {
  const found: Decoration[] = []
  doc.forEach((section, sectionOffset) => {
    if (section.attrs.id !== PROGRAMS_SECTION) return
    section.forEach((child, childOffset) => {
      if (child.type.name !== 'subsection') return
      if (!isProgramsSubsection(PROGRAMS_SECTION, child.attrs.heading as string)) return
      const start = sectionOffset + 1 + childOffset + 1
      const { placed } = programRowsOf(section, child)
      child.forEach((row, rowOffset) => {
        if (!placed.has(rowOffset)) return
        const at = start + rowOffset
        found.push(Decoration.node(at, at + row.nodeSize, { class: 'pg-program-row' }))
      })
    })
  })
  return DecorationSet.create(doc, found)
}

// Marks the rows the table shows, so the page layout hides them (pages.css).
export const ProgramRows = Extension.create({
  name: 'programRows',
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => programRowDecorations(state.doc),
        apply: (tr, set) => (tr.docChanged ? programRowDecorations(tr.doc) : set),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
  ],
})

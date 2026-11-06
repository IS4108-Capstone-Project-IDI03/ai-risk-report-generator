// What the export lays out (EX-01): the report as the document editor holds
// it (RV-08), as it reads in Marsh's page layout (RV-12), with none of the
// review screen's marks (AC10) and the engineer's two choices (AC6):
// - citations: each marker stays, numbered as the section numbers it, and
//   References after the report list what each number cites; without them,
//   no marker is left;
// - the photo appendix: Appendix A is left out without it, and when no
//   photo is chosen for it.
// Pure, so the rules are tested without a browser.
import type { JSONContent } from '@tiptap/core'
import type { ReviewWorkspace } from '../../api'
import { toEditorJSON } from '../convert'
import type { ReportDocument } from '../sections'
import { referenceGroups, type ReferenceGroup } from './references'

export type ExportOptions = {
  citations: boolean
  photos: boolean
}

export type ExportPart = { id: string; number: string; title: string }

export type ExportContent = {
  // The editor's content for the export render.
  content: JSONContent
  // The parts in report order, for the contents.
  parts: ExportPart[]
  references: ReferenceGroup[]
}

// The part after the report that lists the references.
export const REFERENCES_ID = 'R'
export const REFERENCES_TITLE = 'References'

// Every node of a tree but the citation markers.
function withoutCitations(node: JSONContent): JSONContent {
  if (!node.content) return node
  return {
    ...node,
    content: node.content.filter((c) => c.type !== 'citation').map(withoutCitations),
  }
}

export function exportContent(
  report: ReportDocument,
  workspace: ReviewWorkspace,
  options: ExportOptions & { appendixPhotos: number },
): ExportContent {
  const keepAppendix = options.photos && options.appendixPhotos > 0
  const kept = report.sections.filter((s) => s.id !== 'A' || keepAppendix)
  // Notes for the engineer are not part of the report (AC10).
  let sections: JSONContent[] = (toEditorJSON(kept).content ?? []).map((section) => ({
    ...section,
    content: section.content?.filter((c) => c.type !== 'sectionNotice'),
  }))
  if (!options.citations) sections = sections.map(withoutCitations)

  const parts: ExportPart[] = report.parts
    .filter((p) => p.id !== 'A' || keepAppendix)
    .map(({ id, number, title }) => ({ id, number, title }))
  const labels = new Map(kept.map((s) => [s.id, s.label]))
  const titles = new Map(report.parts.map((p) => [p.id, p.title]))
  const references = options.citations ? referenceGroups(sections, labels, workspace, titles) : []
  if (references.length) {
    sections.push({
      type: 'reportSection',
      attrs: { id: REFERENCES_ID },
      content: [
        { type: 'sectionHeading', attrs: { label: REFERENCES_TITLE } },
        { type: 'lockedBlock', attrs: { kind: 'references', section: REFERENCES_ID } },
      ],
    })
    parts.push({ id: REFERENCES_ID, number: '', title: REFERENCES_TITLE })
  }
  return { content: { type: 'doc', content: sections }, parts, references }
}

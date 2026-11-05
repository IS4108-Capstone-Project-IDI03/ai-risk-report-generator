// The export's references (EX-01 AC6): each citation marker becomes a number,
// as the section's markers already count (plugins.ts citationNumbers), and
// the References at the end of the report list what each number cites:
// - a standard by its title, edition, heading and page;
// - an observation by its location and capture date;
// - a past Marsh report by its facility type and year only, never another
//   client's name, site or reference;
// - a section of this report, which the Executive Summary cites, by its title.
import type { JSONContent } from '@tiptap/core'
import type { FieldObservation, ReviewSection, ReviewWorkspace, SourcePassage } from '../../api'
import { pageLocator } from '../../reviewDisplay'
import { marshDay } from '../page/frontMatter'

export type ReferenceEntry = { number: number; text: string }
export type ReferenceGroup = { sectionId: string; label: string; entries: ReferenceEntry[] }

// "26 February 2026", from a timestamp, as the report writes a day.
function dayOf(at: string | null | undefined): string | null {
  if (!at) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  const iso = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  return marshDay(iso)
}

const sentence = (parts: (string | null | undefined)[]) =>
  `${parts.filter((p): p is string => !!p && !!p.trim()).join(', ')}.`

// "2022 edition", unless the edition says so itself.
const edition = (text: string | null | undefined) =>
  !text?.trim() ? null : /edition|ed\./i.test(text) ? text.trim() : `${text.trim()} edition`

export function describeStandard(passage: SourcePassage): string {
  const document = passage.document
  return sentence([
    document?.title ?? 'Standard no longer in the knowledge base',
    edition(document?.edition),
    passage.headings.length ? passage.headings.join(' › ') : null,
    pageLocator(passage),
  ])
}

// A past report names nothing that could identify its client (AC6).
export function describePrecedent(passage: SourcePassage): string {
  const year = /^(\d{4})/.exec(passage.document?.effectiveDate ?? '')?.[1] ?? null
  const facility = passage.document?.facilityType?.trim()
  const type = facility && facility.toLowerCase() !== 'all' ? facility : null
  return sentence([
    type
      ? `Marsh report on ${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type.toLowerCase()} facility`
      : 'Marsh report',
    year ?? 'year not recorded',
  ])
}

export function describeObservation(observation: FieldObservation): string {
  const day = dayOf(observation.capturedAt)
  return sentence(['Site observation', observation.location, day ? `captured ${day}` : null])
}

// What a citation names, read from any section of the workspace that knows
// it: its own section first, since a marker pasted elsewhere keeps its source.
export function describeCitation(
  citation: string,
  sectionId: string,
  workspace: ReviewWorkspace,
  titles: Map<string, string>,
): string {
  if (citation.startsWith('S:')) {
    const id = citation.slice(2)
    return sentence([`Section ${id}${titles.has(id) ? `. ${titles.get(id)}` : ''}, this report`])
  }
  const own = workspace.sections.find((s) => s.id === sectionId)
  const order: ReviewSection[] = own
    ? [own, ...workspace.sections.filter((s) => s !== own)]
    : workspace.sections
  for (const section of order) {
    const passage = section.sources[citation]
    if (passage)
      return passage.kind === 'precedent' ? describePrecedent(passage) : describeStandard(passage)
    if (citation.startsWith('O:')) {
      const observation = section.observations.find((o) => o.id === citation.slice(2))
      if (observation) return describeObservation(observation)
    }
  }
  if (citation.startsWith('O:')) return 'Site observation no longer in the assessment.'
  if (citation.startsWith('P:')) return 'Marsh report, no longer in the knowledge base.'
  return 'Source no longer in the knowledge base.'
}

// The citations in a section, in the order its markers number them.
export function citationOrder(section: JSONContent): string[] {
  const order: string[] = []
  const visit = (node: JSONContent) => {
    if (node.type === 'citation') {
      const id = node.attrs?.id as string | undefined
      if (id && !order.includes(id)) order.push(id)
      return
    }
    node.content?.forEach(visit)
  }
  visit(section)
  return order
}

// The References: each section that cites anything, under its heading, with
// its numbered sources.
export function referenceGroups(
  sections: JSONContent[],
  labels: Map<string, string>,
  workspace: ReviewWorkspace,
  titles: Map<string, string>,
): ReferenceGroup[] {
  return sections.flatMap((section) => {
    const sectionId = (section.attrs?.id as string) ?? ''
    const order = citationOrder(section)
    if (!order.length) return []
    return [
      {
        sectionId,
        label: labels.get(sectionId) ?? sectionId,
        entries: order.map((citation, i) => ({
          number: i + 1,
          text: describeCitation(citation, sectionId, workspace, titles),
        })),
      },
    ]
  })
}

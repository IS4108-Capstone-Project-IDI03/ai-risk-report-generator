// An Ask answer's cited sources (AS-01, AS-08): numbering them in the order the answer first
// cites them, naming them, and where a cited part of the report template goes.
// Used by the Ask tab's turns (components/AnswerTurn.tsx, ProposalTurn.tsx, SourceList.tsx).
import type { FieldObservation, SourcePassage } from '../api'
import type { AskCitation, GapLink, TemplatePart } from './api'
import type { AskItem } from './useAsk'

export const KIND_LABEL: Record<AskCitation['kind'], string> = {
  observation: 'Site observation',
  standard: 'External standard',
  report: 'Past report',
  template: 'Report template',
}

// What a template part is, as its source line says it.
export const PART_KIND: Record<TemplatePart['kind'], string> = {
  section: 'The whole section',
  narrative: 'Written text',
  fields: 'Fields',
  table: 'Table',
}

// A cited source of an answer, as the evidence panel opens it; a part of the
// report template (AS-08) opens where it sits in the section instead.
export type AskSource =
  | { ref: string; kind: 'observation'; observation: FieldObservation }
  | { ref: string; kind: 'standard' | 'report'; passage: SourcePassage }
  | { ref: string; kind: 'template'; part: TemplatePart }

/** An answer's cited sources by citation ID, once its result has arrived. */
export function sourcesOf(item: AskItem): Map<string, AskSource> {
  const found = new Map<string, AskSource>()
  for (const p of item.passages)
    found.set(p.id, { ref: p.id, kind: p.kind === 'precedent' ? 'report' : 'standard', passage: p })
  for (const o of item.observations)
    found.set(`O:${o.id}`, { ref: `O:${o.id}`, kind: 'observation', observation: o })
  for (const t of item.template ?? []) found.set(t.id, { ref: t.id, kind: 'template', part: t })
  return found
}

/** Returns where a template citation (`T:9` or `T:9.3`) goes: its section, at the part. */
export function templateLink(ref: string, part?: TemplatePart): GapLink {
  const [sectionId, index] = ref.slice(2).split('.')
  const subsection = part?.subsection ?? (index === undefined ? null : Number(index))
  return {
    to: 'section',
    sectionId: part?.sectionId ?? sectionId,
    ...(subsection !== null && !Number.isNaN(subsection) && { subsection }),
  }
}

/** A quote nowhere in its source: one only in a picture's AI description is cited, not lost. */
export const notFound = (c: AskCitation) => !c.verified && !c.described

/** Returns the answer's sources in the order its statements first cite them, numbered from 1. */
export function citedOrder(item: AskItem): AskCitation[] {
  const seen = new Map<string, AskCitation>()
  for (const s of item.statements)
    for (const c of s.citations) {
      const known = seen.get(c.ref)
      // A source is unverified if any of its quotes was not found in it; else it
      // is marked as the AI's reading if any quote is from a picture's
      // description (KB-02).
      if (!known) seen.set(c.ref, c)
      else if (notFound(c)) seen.set(c.ref, { ...known, verified: false, described: false })
      else if (c.described && !notFound(known))
        seen.set(c.ref, { ...known, verified: false, described: true })
    }
  return [...seen.values()]
}

/** Returns a cited source's name: an observation's location, a template part, or a document's title. */
export function sourceName(source: AskSource | undefined, citation: AskCitation): string {
  if (!source) return KIND_LABEL[citation.kind]
  if (source.kind === 'observation') return source.observation.location ?? 'Location not recorded'
  if (source.kind === 'template')
    return source.part.heading ? `${source.part.label} › ${source.part.heading}` : source.part.label
  return source.passage.document?.title ?? source.passage.documentId ?? 'Document not found'
}

/** Returns an answer's citations numbered, its sources, and each citation mark's spoken label. */
export function citationsOf(item: AskItem) {
  const order = citedOrder(item)
  const number = new Map(order.map((c, n) => [c.ref, n + 1]))
  const sources = sourcesOf(item)
  const label = (c: AskCitation) => `${KIND_LABEL[c.kind]}, ${sourceName(sources.get(c.ref), c)}`
  return { order, number, sources, label }
}

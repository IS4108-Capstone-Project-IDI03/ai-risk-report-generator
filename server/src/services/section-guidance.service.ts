// Writing guidance for one section of the report (AS-08), asked from the Ask
// tab with two buttons: "What should this section cover?" and "What is missing
// from this section?". The first is answered by S4 from the template's
// definition of the section and the selected standards, with citations, as an
// Ask question is (assessment-ask.service). The second is worked out here,
// from what is saved, with no AI call: each gap is a fact naming the section
// (AC4), with where it is finished (AC2). Gaps that block the export are the
// export check's own (`detailedBlockers`), so the Ask tab and the Export tab
// never disagree (AC3). Nothing here writes to the report (AC5).
// Called by assessment-ask.service.ts.
import type { GapLink, ISectionGap } from '../models/assistant-conversation.model'
import { blockerInputs, detailedBlockers, type DetailedBlocker } from './export.service'
import { locationText } from './location.service'
import { listObservations, type ObservationDto } from './observation.service'
import type { TemplateSection, TemplateSubsection } from './rag.service'
import type { ReviewSectionDto } from './review.service'
import { isUsable, loadSections, UnknownSectionError } from './section.service'
import { writtenSubsections } from './section-document'

export type { GapLink }
export type SectionGap = ISectionGap

// Which parts each question can be asked about. "What should it cover?" needs
// the template's definition, which S4 holds for Sections 4 to 12; "What is
// missing?" also answers for Sections 2 and 3, from the export check. Section 1
// is filled in from the assessment's details and Appendix A from its photos.
export const COVER_SECTIONS = /^(1[0-2]|[4-9])$/
export const MISSING_SECTIONS = /^(1[0-2]|[2-9])$/

// How the report heads the parts the template doesn't list.
const PART_LABELS: Record<string, string> = {
  '1': '1. Purpose and Scope',
  '2': '2. Executive Summary',
  '3': '3. Opportunities for Improvement',
  A: 'Appendix A. Site Photos',
}

/** Returns the part as the report heads it, e.g. "9. Fire Protection". */
export function sectionLabel(sectionId: string, sections: readonly TemplateSection[]): string {
  const section = sections.find((s) => s.id === sectionId)
  return section ? `${section.id}. ${section.title}` : (PART_LABELS[sectionId] ?? sectionId)
}

/** Returns the question a guidance button asks, as the conversation keeps it. */
export function guidanceQuestion(kind: 'cover' | 'missing', label: string): string {
  return kind === 'cover' ? `What should ${label} cover?` : `What is missing from ${label}?`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

// At most this many observations are listed one by one; the rest are counted.
export const MAX_OBSERVATION_GAPS = 20

// The finding a blocker is about, so Go to section lands on it: the first
// pending, unsupported, or citing a withdrawn source, by its key (`0.2`).
function findingFor(blocker: DetailedBlocker, section: ReviewSectionDto | null) {
  const draft = section?.draft
  if (!draft) return undefined
  const withdrawn = (ref: string) => !!section.sources[ref]?.document?.withdrawnAt
  for (const [i, sub] of draft.subsections.entries())
    for (const [j, st] of sub.statements.entries()) {
      const kept = st.review.state !== 'rejected'
      const hit =
        blocker.kind === 'pending_findings'
          ? st.review.state === 'pending'
          : blocker.kind === 'unsupported_findings'
            ? kept && !st.supported
            : blocker.kind === 'withdrawn_sources'
              ? kept && st.citations.some(withdrawn)
              : false
      if (hit) return `${i}.${j}`
    }
  return undefined
}

function blockerGap(blocker: DetailedBlocker, section: ReviewSectionDto | null): SectionGap {
  const finding = findingFor(blocker, section)
  return {
    kind: blocker.kind,
    fact: blocker.fact,
    blocksExport: true,
    link: { to: 'section', sectionId: blocker.sectionId, ...(finding && { finding }) },
  }
}

// The section's parts: the template's, or, from an S4 older than AS-08, the
// saved draft's (an undrafted section's are then not known).
function partsOf(
  template: TemplateSection,
  section: ReviewSectionDto | null,
): TemplateSubsection[] {
  if (template.subsections?.length) return template.subsections
  return (section?.draft?.subsections ?? []).map(({ heading, kind }) => ({ heading, kind }))
}

// Parts with no text (AC2: what is still to write): only once the section has
// some, as one not written at all is an export blocker already. A part has text
// when a finding in it is still in the draft, or the engineer wrote into it in
// the document editor (AI-drafted text awaiting Accept included). Tables are
// listed apart.
function noTextGaps(section: ReviewSectionDto, parts: readonly TemplateSubsection[]): SectionGap[] {
  if (section.completion.state === 'not_started') return []
  const own = section.document?.current ? section.document.document : null
  const typed = own ? writtenSubsections(own) : new Set<number>()
  const gaps: SectionGap[] = []
  parts.forEach((part, i) => {
    if (part.kind === 'table') return
    const drafted = section.draft?.subsections[i]?.statements.some(
      (st) => st.review.state !== 'rejected',
    )
    if (drafted || typed.has(i)) return
    gaps.push({
      kind: 'no_text',
      fact: `Section ${section.id} has no text under ${part.heading}.`,
      blocksExport: false,
      link: { to: 'section', sectionId: section.id, subsection: i },
    })
  })
  return gaps
}

// Tables reading "Not entered" (AC2). Nothing fills Sections 7 to 10's tables
// yet, so the report prints "Not entered" in each (document/LockedBlockView.tsx);
// Sections 4 and 5's figures are export blockers, listed above.
function tableGaps(sectionId: string, parts: readonly TemplateSubsection[]): SectionGap[] {
  const gaps: SectionGap[] = []
  parts.forEach((part, i) => {
    if (part.kind !== 'table') return
    const named = /\btable$/i.test(part.heading) ? part.heading : `${part.heading} table`
    gaps.push({
      kind: 'table',
      fact: `Section ${sectionId}'s ${named} reads Not entered.`,
      blocksExport: false,
      link: { to: 'section', sectionId, subsection: i },
    })
  })
  return gaps
}

// Why an observation tagged with one of the section's categories is left out
// of its draft, or null when drafting uses it: still to check (CP-24), or
// nothing recorded yet (a recording or page still being transcribed counts as
// nothing yet).
function leftOutBecause(o: ObservationDto): string | null {
  if (o.toCheck) return 'is still to check'
  if (isUsable(o)) return null
  const transcribing = [...o.recordings, ...o.pages].some(
    (m) => m.transcription.status === 'transcribing',
  )
  return transcribing
    ? 'is still being transcribed'
    : 'has no note, finished transcript or transcribed page'
}

// An observation tagged with the section's categories that its draft leaves
// out, and why, with Go to observation.
function leftOutGap(name: string, o: ObservationDto, tags: string[], why: string): SectionGap {
  const which = o.location
    ? `The observation at ${locationText(o.location)}`
    : 'An observation with no location'
  return {
    kind: 'observation',
    fact: `${which} is tagged ${listed(tags)} but ${why}, so ${name}'s draft leaves it out.`,
    blocksExport: false,
    link: { to: 'observation', observationId: o.id },
  }
}

// COPE categories with no observation (AC2), and the observations tagged with
// the section's categories that its draft leaves out, oldest first, each with
// Go to observation.
function observationGaps(
  template: TemplateSection,
  observations: readonly ObservationDto[],
): SectionGap[] {
  const name = `Section ${template.id}`
  const ofSection = (o: ObservationDto) =>
    (o.copeDimensions ?? []).filter((c) => template.cope_dimensions.includes(c))
  const categories: SectionGap[] = []
  for (const category of template.cope_dimensions) {
    const tagged = observations.filter((o) => o.copeDimensions?.some((c) => c === category))
    if (tagged.some((o) => leftOutBecause(o) === null)) continue
    const many = tagged.length === 1 ? 'is' : 'are'
    categories.push({
      kind: 'category',
      fact: tagged.length
        ? `${name} has no observation tagged ${category} that its draft can use: ${plural(tagged.length, 'observation')} tagged ${category} ${many} left out.`
        : `${name} has no observation tagged ${category}.`,
      blocksExport: false,
      link: { to: 'observation', observationId: tagged.length ? tagged[0].id : null },
    })
  }
  const leftOut = observations.flatMap((o) => {
    const tags = ofSection(o)
    const why = tags.length ? leftOutBecause(o) : null
    return why ? [{ o, tags, why }] : []
  })
  const each = leftOut
    .slice(0, MAX_OBSERVATION_GAPS)
    .map(({ o, tags, why }) => leftOutGap(name, o, tags, why))
  const more = leftOut.length - each.length
  return [
    ...categories,
    ...each,
    ...(more > 0
      ? [
          {
            kind: 'observation' as const,
            fact: `${plural(more, 'more observation')} tagged with ${name}'s categories ${more === 1 ? 'is' : 'are'} left out of its draft.`,
            blocksExport: false,
            link: { to: 'observation' as const, observationId: null },
          },
        ]
      : []),
  ]
}

/**
 * Returns what is missing from one part of the report (AS-08 AC2), from data
 * already loaded: first what blocks its export, the export check's own
 * (`blockers`, AC3), in that check's order; then its parts with no text, its
 * tables reading "Not entered", its COPE categories with no observation and
 * the observations its draft leaves out. Each is a fact (AC4) with a link.
 * `template` is null for Sections 2 and 3; `observations` newest first, as
 * listObservations gives them.
 */
export function gapsFrom({
  sectionId,
  template,
  section,
  blockers,
  observations,
}: {
  sectionId: string
  template: TemplateSection | null
  section: ReviewSectionDto | null
  blockers: readonly DetailedBlocker[]
  observations: readonly ObservationDto[]
}): SectionGap[] {
  const gaps = blockers.filter((b) => b.sectionId === sectionId).map((b) => blockerGap(b, section))
  if (!template) return gaps
  const parts = partsOf(template, section)
  return [
    ...gaps,
    ...(section ? noTextGaps(section, parts) : []),
    ...tableGaps(sectionId, parts),
    // Oldest first, in the order they were captured.
    ...observationGaps(template, [...observations].reverse()),
  ]
}

/**
 * Returns what is missing from one part of the report (AS-08 AC2), as it is
 * saved now, and how the report heads it (see gapsFrom). Reads only: no AI
 * call, and nothing in the report changes (AC5). Throws UnknownSectionError for
 * a part it can't answer for (Section 1, Appendix A, or one S4's template
 * doesn't list).
 */
export async function sectionGaps(
  reference: string,
  sectionId: string,
): Promise<{ label: string; gaps: SectionGap[] }> {
  if (!MISSING_SECTIONS.test(sectionId)) throw new UnknownSectionError(sectionId)
  const loaded = await loadSections(reference)
  const template = loaded.find((l) => l.section.id === sectionId)?.section ?? null
  if (!template && sectionId !== '2' && sectionId !== '3') throw new UnknownSectionError(sectionId)
  const [inputs, observations] = await Promise.all([
    blockerInputs(reference, loaded),
    template ? listObservations(reference) : Promise.resolve([]),
  ])
  return {
    label: sectionLabel(
      sectionId,
      loaded.map((l) => l.section),
    ),
    gaps: gapsFrom({
      sectionId,
      template,
      section: inputs.workspace.sections.find((s) => s.id === sectionId) ?? null,
      blockers: detailedBlockers(inputs),
      observations,
    }),
  }
}

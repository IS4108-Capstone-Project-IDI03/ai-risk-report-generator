// The whole report as the document editor opens it (RV-08 AC1): every part
// in report order under its fixed heading, with what each section's text is
// built on (for saving), why an undrafted section was not drafted (AC3), and
// what the review decorations need to know of each drafted passage.
import type {
  ReportSection,
  ReviewSection,
  ReviewWorkspace,
  SectionDraft,
  SectionVersion,
  Summary,
} from '../api'
import {
  asDrafted,
  partContent,
  sectionContent,
  signature,
  summaryContent,
} from '../documentContent'
import { formatDayTime } from '../format'
import { describeCitation, plural } from '../reviewDisplay'
import type { EditorSection } from './convert'
import type { PassageFlag, PassageInfo, ReviewContext } from './plugins'

export const LOSS_LEVEL_IDS = ['I', 'II', 'III']

// One part of the report in the document: what the outline lists and what
// saving it is built on.
export type DocumentPart = {
  id: string
  number: string
  title: string
  // The saved draft its finding keys name, and its newest version (0: none).
  draftId: string | null
  baseVersion: number
}

export type ReportDocument = {
  parts: DocumentPart[]
  sections: EditorSection[]
  // When any section was last saved from the document editor, for the save
  // status as it opens (AC13); null if never.
  lastSavedAt: string | null
  context: ReviewContext
}

const LOCKED: Record<string, string[]> = {
  '1': ['purpose'],
  '3': ['ofis'],
  '4': ['risk-quality'],
  '5': ['loss-estimates'],
  A: ['appendix'],
}

const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

// A saved version set aside because the section was drafted again since.
function setAside(version: SectionVersion | null | undefined): EditorSection['notices'] {
  if (!version || version.current) return []
  return [
    {
      tone: 'warning',
      title: 'Drafted again since your edits.',
      text: `Your text saved ${formatDayTime(new Date(version.savedAt))} was written on an earlier draft. Findings you edited were carried into this draft; text you wrote yourself is kept in that saved version.`,
    },
  ]
}

// Why one of sections 4-12 has no draft (AC3), from the Generation tab's
// evidence counts when they could be read.
function notDrafted(listedSection: ReportSection | undefined): EditorSection['notices'][number] {
  const write = 'Write it here yourself, or'
  if (!listedSection)
    return { tone: 'info', title: 'Not drafted.', text: `${write} draft it on the Generation tab.` }
  const {
    inputsMissing,
    usableObservations: usable,
    minObservations: min,
    copeDimensions,
  } = listedSection
  if (inputsMissing)
    return {
      tone: 'info',
      title: 'Not drafted:',
      text: `${inputsMissing} ${write} draft it on the Generation tab once they are entered.`,
    }
  if (usable < min)
    return {
      tone: 'info',
      title: 'Not drafted:',
      text: `it needs ${plural(min, 'usable observation')} filed under ${copeDimensions.join(' or ')}, and ${usable} ${usable === 1 ? 'is' : 'are'} captured. ${write} capture more and draft it on the Generation tab.`,
    }
  return {
    tone: 'info',
    title: 'Not drafted yet:',
    text: `there is enough evidence, but it has not been drafted. ${write} draft it on the Generation tab.`,
  }
}

const UNSUPPORTED: PassageFlag = {
  label: 'Unsupported',
  detail:
    'It rests on no evidence from this assessment or its standards. Its flag stays until it is resolved in the review workspace.',
}
const CITATION_DELETED: PassageFlag = {
  label: 'Unsupported',
  detail:
    'A citation it was drafted with was deleted, so it is flagged until it is resolved in the review workspace.',
}
const WITHDRAWN: PassageFlag = {
  label: 'Withdrawn source',
  detail:
    'It cites a source that has since been withdrawn. Its flag stays until it is resolved in the review workspace.',
}

// What the decorations know of a reviewed section's findings (4-12).
function reviewedPassages(section: ReviewSection): [string, PassageInfo][] {
  return (section.draft?.subsections ?? []).flatMap((sub, i) =>
    sub.statements.flatMap((st, j): [string, PassageInfo][] => {
      if (st.review.state === 'rejected') return []
      const withdrawn = st.citations.some((c) => section.sources[c]?.document?.withdrawnAt)
      return [
        [
          `${section.id}:${i}.${j}`,
          {
            // Only a finding no one has decided on is still the AI's.
            aiSignature: st.review.state === 'pending' ? signature(asDrafted(st)) : null,
            citations: st.citations,
            watchCitations: true,
            flag: !st.supported
              ? st.citationsRemoved?.length
                ? CITATION_DELETED
                : UNSUPPORTED
              : withdrawn
                ? WITHDRAWN
                : null,
          },
        ],
      ]
    }),
  )
}

// Section 2's statements: AI styled while they read as drafted.
function summaryPassages(draft: SectionDraft | null): [string, PassageInfo][] {
  return (draft?.subsections ?? []).flatMap((sub, i) =>
    sub.statements.map((st, j): [string, PassageInfo] => [
      `2:${i}.${j}`,
      {
        aiSignature: signature(asDrafted(st)),
        citations: st.citations,
        watchCitations: false,
        flag: st.supported ? null : UNSUPPORTED,
      },
    ]),
  )
}

export function buildReportDocument({
  workspace,
  summary,
  listedSections,
}: {
  workspace: ReviewWorkspace
  summary: Summary | null
  // Sections 4-12 as the Generation tab lists them, for why one is not drafted.
  listedSections: ReportSection[] | null
}): ReportDocument {
  const executive = summary?.executiveSummary ?? null
  const summaryDraft = executive?.draft ?? null
  const parts: DocumentPart[] = []
  const sections: EditorSection[] = []
  const add = (
    part: Omit<DocumentPart, 'number'> & { number?: string },
    editor: Omit<EditorSection, 'id' | 'label' | 'locked'>,
  ) => {
    const number = part.number ?? part.id
    parts.push({ ...part, number })
    sections.push({
      ...editor,
      id: part.id,
      label: part.id === 'A' ? `Appendix A. ${part.title}` : `${number}. ${part.title}`,
      locked: LOCKED[part.id] ?? [],
    })
  }
  const { parts: written } = workspace
  const version = (id: '1' | '2' | '3' | 'A') => written?.[id] ?? null

  add(
    { id: '1', title: 'Purpose and Scope', draftId: null, baseVersion: version('1')?.version ?? 0 },
    { notices: [], content: partContent(version('1')), kinds: [] },
  )
  const summaryNotices: EditorSection['notices'] = summaryDraft
    ? executive!.staleSections.length
      ? [
          {
            tone: 'warning',
            title: 'Out of date:',
            text: `${listed(executive!.staleSections.map((s) => `${s.id}. ${s.title}`))} changed since it was drafted.`,
          },
        ]
      : []
    : [
        executive?.missing.length
          ? {
              tone: 'info',
              title: 'Not drafted:',
              text: `the Executive Summary is drafted once ${listed(executive.missing.map((s) => `Section ${s.id}`))} ${executive.missing.length === 1 ? 'is' : 'are'} complete. Write it here yourself, or draft it on the Generation tab then.`,
            }
          : {
              tone: 'info',
              title: 'Not drafted yet.',
              text: 'Write it here yourself, or draft it on the Generation tab.',
            },
      ]
  add(
    {
      id: '2',
      title: 'Executive Summary',
      draftId: summaryDraft?.id ?? null,
      baseVersion: version('2')?.version ?? 0,
    },
    {
      notices: [...summaryNotices, ...setAside(version('2'))],
      content: summaryContent(summaryDraft, version('2')),
      kinds: summaryDraft?.subsections.map((s) => s.kind) ?? [],
    },
  )
  add(
    {
      id: '3',
      title: 'Opportunities for Improvement',
      draftId: null,
      baseVersion: version('3')?.version ?? 0,
    },
    { notices: [], content: partContent(version('3')), kinds: [] },
  )
  for (const section of workspace.sections) {
    const listedSection = listedSections?.find((s) => s.id === section.id)
    add(
      {
        id: section.id,
        title: section.title,
        draftId: section.draft?.id ?? null,
        baseVersion: section.document?.version ?? 0,
      },
      {
        notices: section.draft ? setAside(section.document) : [notDrafted(listedSection)],
        content: sectionContent(section),
        kinds: section.draft?.subsections.map((s) => s.kind) ?? [],
      },
    )
  }
  add(
    { id: 'A', title: 'Site Photos', draftId: null, baseVersion: version('A')?.version ?? 0 },
    { notices: [], content: partContent(version('A')), kinds: [] },
  )

  const bySection = new Map(workspace.sections.map((s) => [s.id, s]))
  const savedAt = [
    ...Object.values(written ?? {}),
    ...workspace.sections.map((s) => s.document),
  ].flatMap((v) => (v ? [v.savedAt] : []))
  return {
    parts,
    sections,
    lastSavedAt: savedAt.length
      ? savedAt.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
      : null,
    context: {
      passages: new Map([
        ...summaryPassages(summaryDraft),
        ...workspace.sections.flatMap(reviewedPassages),
      ]),
      describe: (sectionId, citation) => {
        const section = bySection.get(sectionId)
        if (section) return describeCitation(section, citation)
        return citation.startsWith('S:') ? `Section ${citation.slice(2)}` : 'Source'
      },
    },
  }
}

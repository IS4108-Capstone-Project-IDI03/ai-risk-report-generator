import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import type {
  ReviewSection,
  ReviewStatement,
  ReviewWorkspace,
  SourcePassage,
  Summary,
} from '../../api'
import { buildReportDocument } from '../sections'
import { exportContent, REFERENCES_ID } from './exportDocument'
import {
  citationOrder,
  describeCitation,
  describeObservation,
  describePrecedent,
  describeStandard,
} from './references'

// What the export lays out (EX-01): the report as the document editor holds
// it, without the review screen's notes (AC10), with the engineer's choices
// of citations and the photo appendix (AC6).

const PROVENANCE = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  effort: 'high',
  prompt_version: 'gn01-v2.4',
  template_version: 'global-pre-v2.0-2026-02',
  generated_at: '2026-10-03T06:00:00.000Z',
}
const finding = (text: string, citations: string[]): ReviewStatement => ({
  text,
  generatedText: text,
  citations,
  supported: true,
  citationsRemoved: [],
  review: { state: 'accepted', at: '2026-10-04T00:00:00.000Z', by: { id: 'u', name: 'Alex Rowe' } },
})
const STANDARD: SourcePassage = {
  id: 'C:doc1:4',
  kind: 'standard',
  text: 'Fire-stop all penetrations.',
  headings: ['Fire stopping', 'Penetrations'],
  pageStart: 12,
  pageEnd: 13,
  documentId: 'doc1',
  document: {
    title: 'FM Global Data Sheet 1-21',
    issuingBody: 'FM Global',
    sourceType: 'fm_standard',
    edition: '2022',
    effectiveDate: '2022-04-01',
    facilityType: 'all',
    withdrawnAt: null,
    fileUrl: '/api/knowledge-documents/doc1/file',
  },
}
const PRECEDENT: SourcePassage = {
  id: 'P:doc2:9',
  kind: 'precedent',
  text: 'The Jurong Logistics Hub roof is of steel deck.',
  headings: ['Construction'],
  pageStart: 6,
  pageEnd: null,
  documentId: 'doc2',
  document: {
    title: 'Jurong Logistics Hub PRE 2024 for Acme Holdings',
    issuingBody: 'Marsh',
    sourceType: 'marsh_report',
    edition: null,
    effectiveDate: '2024-03-12',
    facilityType: 'Warehouse',
    withdrawnAt: null,
    fileUrl: '/api/knowledge-documents/doc2/file',
  },
}
const counts = { total: 2, pending: 0, accepted: 2, edited: 0, rejected: 0 }
const CONSTRUCTION: ReviewSection = {
  id: '7',
  title: 'Construction',
  copeDimensions: ['Construction'],
  completion: { state: 'complete', written: 1, total: 1, tables: 0 },
  review: {
    state: 'reviewed',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
  },
  draft: {
    id: 'd7',
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [
          finding('Riser penetrations were not fire-stopped.', ['O:o1', 'C:doc1:4']),
          finding('The roof is steel deck, as at similar sites.', ['P:doc2:9', 'C:doc1:4']),
        ],
      },
    ],
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: PROVENANCE,
    createdAt: '2026-10-03T06:00:00.000Z',
  },
  findings: counts,
  sources: { 'C:doc1:4': STANDARD, 'P:doc2:9': PRECEDENT },
  observations: [
    {
      id: 'o1',
      copeDimensions: ['Construction'],
      note: 'Riser on L3 not fire-stopped.',
      transcripts: [],
      severity: 'high',
      location: 'Riser, Level 3',
      standard: null,
      capturedAt: '2026-04-11T03:20:00.000Z',
    },
  ],
  replacement: null,
  history: [],
  document: null,
}
const WORKSPACE: ReviewWorkspace = {
  sections: [CONSTRUCTION],
  parts: { '1': null, '2': null, '3': null, A: null },
  summary: counts,
  asOf: '2026-10-19T02:00:00.000Z',
}
const SUMMARY: Summary = {
  purposeAndScope: ['This report was prepared for Straits Logistics.'],
  executiveSummary: { draft: null, missing: [], staleSections: [] },
}
const report = () =>
  buildReportDocument({ workspace: WORKSPACE, summary: SUMMARY, listedSections: [] })

// Every node of the content, of a type.
function nodesOf(node: JSONContent, type: string): JSONContent[] {
  return [
    ...(node.type === type ? [node] : []),
    ...(node.content ?? []).flatMap((c) => nodesOf(c, type)),
  ]
}
const sectionIds = (content: JSONContent) =>
  (content.content ?? []).map((s) => s.attrs?.id as string)

describe('the export content (EX-01)', () => {
  it('leaves out the notes for the engineer (AC10)', () => {
    const { content } = exportContent(report(), WORKSPACE, {
      citations: true,
      photos: true,
      appendixPhotos: 2,
    })
    // Section 2 has no draft, so the editor says why; the export does not.
    expect(report().sections.find((s) => s.id === '2')!.notices.length).toBeGreaterThan(0)
    expect(nodesOf(content, 'sectionNotice')).toEqual([])
    expect(nodesOf(content, 'sectionHeading').length).toBe(sectionIds(content).length)
  })

  it('numbers citations as the section does, with References after the report (AC6)', () => {
    const { content, parts, references } = exportContent(report(), WORKSPACE, {
      citations: true,
      photos: true,
      appendixPhotos: 2,
    })
    expect(nodesOf(content, 'citation').length).toBe(4)
    expect(sectionIds(content).at(-1)).toBe(REFERENCES_ID)
    expect(parts.at(-1)).toEqual({ id: REFERENCES_ID, number: '', title: 'References' })
    expect(references).toEqual([
      {
        sectionId: '7',
        label: '7. Construction',
        entries: [
          { number: 1, text: 'Site observation, Riser, Level 3, captured 11 April 2026.' },
          {
            number: 2,
            text: 'FM Global Data Sheet 1-21, 2022 edition, Fire stopping › Penetrations, pp. 12–13.',
          },
          { number: 3, text: 'Marsh report on a warehouse facility, 2024.' },
        ],
      },
    ])
  })

  it('leaves no marker without citations, and no References (AC6)', () => {
    const { content, parts, references } = exportContent(report(), WORKSPACE, {
      citations: false,
      photos: true,
      appendixPhotos: 2,
    })
    expect(nodesOf(content, 'citation')).toEqual([])
    expect(references).toEqual([])
    expect(sectionIds(content)).not.toContain(REFERENCES_ID)
    expect(parts.map((p) => p.id)).not.toContain(REFERENCES_ID)
    // The words stay.
    expect(JSON.stringify(content)).toContain('Riser penetrations were not fire-stopped.')
  })

  it('includes Appendix A only when chosen and holding photos (AC6, AC8)', () => {
    const ids = (photos: boolean, appendixPhotos: number) =>
      sectionIds(
        exportContent(report(), WORKSPACE, { citations: false, photos, appendixPhotos }).content,
      )
    expect(ids(true, 3)).toContain('A')
    expect(ids(false, 3)).not.toContain('A')
    expect(ids(true, 0)).not.toContain('A')
  })
})

describe('the references (EX-01 AC6)', () => {
  it('names a standard by its title, edition, heading and page', () => {
    expect(describeStandard(STANDARD)).toBe(
      'FM Global Data Sheet 1-21, 2022 edition, Fire stopping › Penetrations, pp. 12–13.',
    )
  })

  it("names a past Marsh report by facility type and year only, never its client's", () => {
    const text = describePrecedent(PRECEDENT)
    expect(text).toBe('Marsh report on a warehouse facility, 2024.')
    expect(text).not.toMatch(/Jurong|Acme|PRE/)
    // Without a facility type, the year alone.
    expect(
      describePrecedent({ ...PRECEDENT, document: { ...PRECEDENT.document!, facilityType: null } }),
    ).toBe('Marsh report, 2024.')
    expect(
      describePrecedent({
        ...PRECEDENT,
        document: { ...PRECEDENT.document!, facilityType: 'Office' },
      }),
    ).toBe('Marsh report on an office facility, 2024.')
  })

  it('names an observation by its location and capture date', () => {
    expect(describeObservation(CONSTRUCTION.observations[0])).toBe(
      'Site observation, Riser, Level 3, captured 11 April 2026.',
    )
    expect(
      describeObservation({ ...CONSTRUCTION.observations[0], location: null, capturedAt: null }),
    ).toBe('Site observation.')
  })

  it('names a section of this report, and a source no longer found', () => {
    const titles = new Map([['7', 'Construction']])
    expect(describeCitation('S:7', '2', WORKSPACE, titles)).toBe(
      'Section 7. Construction, this report.',
    )
    expect(describeCitation('C:gone:1', '7', WORKSPACE, titles)).toBe(
      'Source no longer in the knowledge base.',
    )
    // A marker pasted into another section keeps its source.
    expect(describeCitation('C:doc1:4', '1', WORKSPACE, titles)).toBe(describeStandard(STANDARD))
  })

  it('orders a section’s citations as its markers number them', () => {
    expect(
      citationOrder({
        type: 'reportSection',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'citation', attrs: { id: 'B' } },
              { type: 'citation', attrs: { id: 'A' } },
            ],
          },
          { type: 'paragraph', content: [{ type: 'citation', attrs: { id: 'B' } }] },
        ],
      }),
    ).toEqual(['B', 'A'])
  })
})

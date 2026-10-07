// The review workspace (RV-01): every report section with its completion and
// review states, and each newest draft beside its evidence: the passages it
// cites, with their documents' current details, and the observations it was
// drafted from. Called by routes/assessment.routes.ts.
import type { IReportSection } from '../models/report-section.model'
import { findKnowledgeDocuments, type KnowledgeDocumentDto } from './knowledge-document.service'
import {
  loadSections,
  toDraftDto,
  type ChangeCounts,
  type SectionDraftDto,
} from './section.service'

// How much of the section the draft writes. Tables are not counted: measured
// values fill them (GN-03), so a draft never writes them.
export type CompletionState = 'not_started' | 'partial' | 'complete'
// Where the section stands in review, from the draft's own checks. The
// engineer's decisions (accepted, edited, rejected) come with RV-02.
export type ReviewState = 'not_drafted' | 'ai_draft' | 'needs_review'

// One passage a draft cites, as the draft was given it (AC7), with where it
// sits in its document (AC8) and the document's details (AC9-AC12).
export type SourcePassageDto = {
  // The citation ID: `C:<chunk id>` for a standard, `P:<chunk id>` for a past report.
  id: string
  kind: 'standard' | 'precedent'
  text: string
  // The heading trail above the passage, outermost first (IN-04).
  headings: string[]
  pageStart: number | null
  pageEnd: number | null
  documentId: string | null
  // From the knowledge base now, so a correction or withdrawal since drafting
  // shows; null when the document has no record there.
  document: {
    title: string
    issuingBody: string
    sourceType: string
    edition: string | null
    // YYYY-MM-DD: a standard's effective date, or a past report's date.
    effectiveDate: string
    withdrawnAt: Date | null
    fileUrl: string
  } | null
}

// An observation as the draft was given it (GN-01 AC11).
export type FieldObservationDto = {
  id: string
  copeDimension: string
  note: string | null
  transcripts: string[]
  severity: string
  location: string | null
  standard: string | null
}

export type ReviewSectionDto = {
  id: string
  title: string
  copeDimensions: string[]
  // `written` of `total` subsections have statements; `tables` are left to GN-03.
  completion: { state: CompletionState; written: number; total: number; tables: number }
  // What makes a draft need review; all 0 for an AI draft with nothing flagged.
  review: {
    state: ReviewState
    unsupportedStatements: number
    withdrawnSources: number
    changesSinceDraft: number
    // The same changes by kind: added, changed and removed (CP-08).
    changeCounts: ChangeCounts
  }
  // The newest draft, without its raw sources: `sources` below resolves them.
  draft: Omit<SectionDraftDto, 'sources'> | null
  sources: Record<string, SourcePassageDto>
  // The section's own observations and any other the draft cites, as drafted from.
  observations: FieldObservationDto[]
}

export type ReviewWorkspaceDto = { sections: ReviewSectionDto[] }

// The chunk metadata S4 saves with each cited passage (see rag-service orchestrator).
type SavedPassage = {
  text?: unknown
  doc_id?: unknown
  headings?: unknown
  page_start?: unknown
  page_end?: unknown
}

// A chunk ID is `<document id>:<n>`, should a passage lack its `doc_id`.
function documentIdOf(citation: string, passage: SavedPassage): string | null {
  if (typeof passage.doc_id === 'string') return passage.doc_id
  const chunkId = citation.slice(2)
  return chunkId.includes(':') ? chunkId.slice(0, chunkId.lastIndexOf(':')) : null
}

const pageOf = (value: unknown) => (typeof value === 'number' ? value : null)

function toPassage(
  citation: string,
  saved: unknown,
  documents: Map<string, KnowledgeDocumentDto>,
): SourcePassageDto {
  const passage = (saved ?? {}) as SavedPassage
  const documentId = documentIdOf(citation, passage)
  const record = documentId ? documents.get(documentId) : undefined
  return {
    id: citation,
    kind: citation.startsWith('P:') ? 'precedent' : 'standard',
    text: typeof passage.text === 'string' ? passage.text : '',
    headings: Array.isArray(passage.headings) ? passage.headings.map(String) : [],
    pageStart: pageOf(passage.page_start),
    pageEnd: pageOf(passage.page_end),
    documentId,
    document: record
      ? {
          title: record.title,
          issuingBody: record.issuingBody,
          sourceType: record.sourceType,
          edition: record.edition,
          effectiveDate: record.effectiveDate,
          withdrawnAt: record.withdrawn?.at ?? null,
          fileUrl: record.fileUrl,
        }
      : null,
  }
}

function completionOf(draft: IReportSection | null): ReviewSectionDto['completion'] {
  if (!draft) return { state: 'not_started', written: 0, total: 0, tables: 0 }
  const writable = draft.subsections.filter((s) => s.kind !== 'table')
  const written = writable.filter((s) => s.statements.length > 0).length
  return {
    state: written === 0 ? 'not_started' : written < writable.length ? 'partial' : 'complete',
    written,
    total: writable.length,
    tables: draft.subsections.length - writable.length,
  }
}

const citationsOf = (draft: IReportSection) =>
  new Set(draft.subsections.flatMap((s) => s.statements.flatMap((st) => st.citations)))

// Sections 7-12 for reviewing, in template order.
export async function getReviewWorkspace(reference: string): Promise<ReviewWorkspaceDto> {
  const loaded = await loadSections(reference)
  // One lookup for every document any draft cites.
  const documentIds = loaded.flatMap(({ latest }) =>
    Object.entries(latest?.sources ?? {}).flatMap(([citation, saved]) => {
      const id = documentIdOf(citation, (saved ?? {}) as SavedPassage)
      return id ? [id] : []
    }),
  )
  const documents = new Map(
    (await findKnowledgeDocuments(documentIds)).map((document) => [document.id, document]),
  )

  const sections = loaded.map(
    ({ section, latest, changesSinceDraft, changeCounts }): ReviewSectionDto => {
      const base = { id: section.id, title: section.title, copeDimensions: section.cope_dimensions }
      if (!latest) {
        return {
          ...base,
          completion: completionOf(null),
          review: {
            state: 'not_drafted',
            unsupportedStatements: 0,
            withdrawnSources: 0,
            changesSinceDraft: 0,
            changeCounts: { added: 0, changed: 0, removed: 0 },
          },
          draft: null,
          sources: {},
          observations: [],
        }
      }
      const { sources: saved, ...draft } = toDraftDto(latest)
      const sources = Object.fromEntries(
        Object.entries(saved).map(([citation, passage]) => [
          citation,
          toPassage(citation, passage, documents),
        ]),
      )
      const unsupportedStatements = latest.subsections
        .flatMap((s) => s.statements)
        .filter((s) => !s.supported).length
      const withdrawnSources = Object.values(sources).filter((p) => p.document?.withdrawnAt).length
      const cited = citationsOf(latest)
      return {
        ...base,
        completion: completionOf(latest),
        review: {
          state:
            unsupportedStatements || withdrawnSources || changesSinceDraft
              ? 'needs_review'
              : 'ai_draft',
          unsupportedStatements,
          withdrawnSources,
          changesSinceDraft,
          changeCounts,
        },
        draft,
        sources,
        observations: (latest.evidence ?? [])
          .filter(
            (e) => cited.has(`O:${e.id}`) || section.cope_dimensions.includes(e.COPE_dimension),
          )
          .map((e) => ({
            id: e.id,
            copeDimension: e.COPE_dimension,
            note: e.note ?? null,
            transcripts: e.transcripts ?? [],
            severity: e.severity,
            location: e.location ?? null,
            standard: e.standard ?? null,
          })),
      }
    },
  )
  return { sections }
}

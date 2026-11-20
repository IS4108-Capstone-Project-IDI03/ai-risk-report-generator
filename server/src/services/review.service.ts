// The review workspace (RV-01): every report section with its completion and
// review states, and each saved draft beside its evidence: the passages it
// cites, with their documents' current details, and the observations it was
// drafted from. With RV-02, each finding's review decision, the section's
// counts and review history, any replacement draft waiting for a decision,
// and the report's review summary. With RV-08, each section's newest version
// from the document editor, which adds the `edited` review state (Edited by
// you). With AS-04, text drafted from the Ask tab and inserted, awaiting the
// engineer's Accept: each section's AI drafts and their unsupported sentences,
// which put it back in Needs review, and the passages and observations that
// text cites. Called by routes/assessment.routes.ts.
import type { Types } from 'mongoose'
import {
  ReportTextProposalModel,
  type IReportTextProposal,
} from '../models/report-text-proposal.model'
import type { ReviewAction } from '../models/review-audit.model'
import { findKnowledgeDocuments, type KnowledgeDocumentDto } from './knowledge-document.service'
import {
  assessmentHistory,
  countFindings,
  foldFindings,
  type Finding,
  type FindingCounts,
  type FindingState,
  type ReviewEntry,
} from './review-decision.service'
import {
  filedUnder,
  loadSections,
  savedEvidence,
  toDraftDto,
  type ChangeCounts,
  type Draft,
  type LoadedSection,
  type SectionDraftDto,
} from './section.service'
import { captureTimes } from './observation.service'
import type { TemplateSection } from './rag.service'
import {
  assessmentIdOf,
  latestVersions,
  summaryDraft,
  type SectionVersionDto,
} from './report-document.service'
import {
  aiIdsIn,
  hasOwnText,
  hasWrittenText,
  unsupportedAiText,
  writtenSubsections,
} from './section-document'

// How much of the section the draft writes. Tables are not counted: measured
// values fill them (GN-03), so a draft never writes them.
export type CompletionState = 'not_started' | 'partial' | 'complete'
// Where the section stands in review. `needs_review` comes from the draft's
// own checks and wins over the rest; otherwise it follows the engineer's
// decisions (RV-02): `ai_draft` while every finding is pending, `in_review`
// once some are decided, `reviewed` once none is pending. `edited` (RV-08)
// comes next after `needs_review`: the engineer has changed the section in the
// document editor, or written it there.
export type ReviewState =
  'not_drafted' | 'ai_draft' | 'in_review' | 'reviewed' | 'edited' | 'needs_review'

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
  // GN-16: found by the jurisdiction-only fallback search, so a broader match; absent otherwise.
  broader?: true
  documentId: string | null
  // From the knowledge base now, so a correction or withdrawal since drafting
  // shows; null when the document has no record there.
  document: {
    title: string
    issuingBody: string | null
    sourceType: string | null
    edition: string | null
    // YYYY-MM-DD: a standard's effective date, or a past report's date.
    effectiveDate: string | null
    // A past report's facility type, which is all a reference to it names
    // with its year (EX-01 AC6); null while Unconfirmed.
    facilityType: string | null
    withdrawnAt: Date | null
    // Null for a manually entered standard, which has no file (IN-18).
    fileUrl: string | null
  } | null
}

// An observation as the draft was given it (GN-01 AC11).
export type FieldObservationDto = {
  id: string
  // Its categories in C-O-P-E order, one or more.
  copeDimensions: string[]
  note: string | null
  transcripts: string[]
  // Its transcribed handwritten pages (CP-19 AC15).
  handwriting: string[]
  severity: string
  location: string | null
  standard: string | null
  // When it was captured, for the report's references (EX-01 AC6); null if
  // the observation can no longer be found.
  capturedAt: Date | null
}

// One finding of a draft (RV-02): a statement, with the engineer's decision.
export type ReviewStatementDto = {
  // The text now: the engineer's wording once edited (AC2).
  text: string
  // What the draft says, kept for comparison.
  generatedText: string
  citations: string[]
  supported: boolean
  // Drafted citations deleted in the document editor (RV-08), which leave the
  // finding unsupported.
  citationsRemoved: string[]
  // The decision and who made it when; at and by are null while none was made.
  review: {
    state: FindingState
    at: Date | null
    by: { id: string; name: string } | null
  }
}

// A draft as review shows it: every finding with its decision, rejected ones
// included, so the client can show the visible draft and offer Restore.
// Without its raw sources: `sources` beside it resolves them.
export type ReviewDraftDto = Omit<SectionDraftDto, 'sources' | 'subsections'> & {
  subsections: {
    heading: string
    kind: 'narrative' | 'fields' | 'table'
    statements: ReviewStatementDto[]
  }[]
}

// A regenerated draft waiting to be accepted or discarded (RV-02 AC10-AC12),
// shown beside the saved one.
export type ReplacementDto = {
  draft: ReviewDraftDto
  sources: Record<string, SourcePassageDto>
  observations: FieldObservationDto[]
  // What the engineer asked to change, if anything, and who asked when.
  instruction: string | null
  requestedBy: { id: string; name: string } | null
  requestedAt: Date
}

// One entry of the immutable review audit log (RV-02 AC3, AC4, AC6).
export type ReviewHistoryEntryDto = {
  id: string
  // The draft decided on: the saved one, a replacement, or an earlier draft.
  draftId: string
  action: ReviewAction
  // `<subsection>.<statement>` of the finding; null for a whole draft.
  finding: string | null
  heading: string | null
  before: string | null
  after: string | null
  citations: string[]
  // Its citations after an edit in the document editor, or null (RV-08).
  citationsAfter: string[] | null
  instruction: string | null
  bulk: boolean
  // Made in the document editor (RV-08), or by a version restore.
  inDocument: boolean
  // Made by restoring an earlier version (RV-06): what was restored,
  // `version:<n>` or `draft:<_id>`; null otherwise.
  restoredFrom: string | null
  by: { id: string; name: string }
  at: Date
}

// A section's newest version from the document editor (RV-08). `current` is
// false once the section has been drafted again since: its finding keys name
// an earlier draft, so the review workspace and the editor leave it aside.
export type SectionDocumentDto = SectionVersionDto & { current: boolean }

// Text drafted from the Ask tab and inserted into the section, still awaiting
// the engineer's Accept (AS-04): its proposal, what was asked, its sentences
// proposed with no supporting source (the browser marks those still in the
// text, as `unsupportedAiText` does), and who inserted it when.
export type AiDraftDto = {
  id: string
  kind: 'draft' | 'rewrite'
  request: string
  unsupported: string[]
  insertedAt: Date
  insertedBy: { id: string; name: string }
}

export type ReviewSectionDto = {
  id: string
  title: string
  copeDimensions: string[]
  // `written` of `total` subsections have a finding not rejected; `tables`
  // are left to GN-03.
  completion: { state: CompletionState; written: number; total: number; tables: number }
  // What makes a draft need review; all 0 for a draft with nothing flagged.
  // Unsupported statements and withdrawn sources count only findings still in
  // the draft: rejecting one clears its flag.
  review: {
    state: ReviewState
    unsupportedStatements: number
    withdrawnSources: number
    changesSinceDraft: number
    // The same changes by kind: added, changed and removed (CP-08).
    changeCounts: ChangeCounts
    // Changed or written in the document editor (RV-08 AC12), shown as Edited
    // by you even while the state is needs_review.
    editedInDocument: boolean
    // AI-drafted text awaiting Accept (AS-04): how many insertions, and how
    // many of their sentences are still unsupported. Either is Needs review.
    aiText: { pending: number; unsupported: number }
  }
  // How many of the saved draft's findings stand in each state (RV-02 AC9).
  findings: FindingCounts
  // The saved draft, the section's content.
  draft: ReviewDraftDto | null
  sources: Record<string, SourcePassageDto>
  // The section's own observations and any other the draft cites, as drafted from.
  observations: FieldObservationDto[]
  replacement: ReplacementDto | null
  // The section's review audit log, newest first: every draft's entries.
  history: ReviewHistoryEntryDto[]
  // Its newest version from the document editor (RV-08), or null.
  document: SectionDocumentDto | null
  // Text drafted from the Ask tab awaiting Accept, in the order it is in the text (AS-04).
  aiDrafts: AiDraftDto[]
}

export type ReviewWorkspaceDto = {
  sections: ReviewSectionDto[]
  // The newest version of Sections 1, 2 and 3 and Appendix A from the
  // document editor (RV-08), or null: what the engineer wrote into them.
  parts: Record<'1' | '2' | '3' | 'A', SectionDocumentDto | null>
  // The saved drafts' findings across the report, by state (RV-02 AC9).
  summary: FindingCounts
  // When the gateway read it, so the browser can keep the newest of several.
  asOf: Date
}

// The chunk metadata S4 saves with each cited passage (see rag-service orchestrator).
type SavedPassage = {
  text?: unknown
  doc_id?: unknown
  headings?: unknown
  page_start?: unknown
  page_end?: unknown
  broader?: unknown
}

// A chunk ID is `<document id>:<n>`, should a passage lack its `doc_id`.
function documentIdOf(citation: string, passage: SavedPassage): string | null {
  if (typeof passage.doc_id === 'string') return passage.doc_id
  const chunkId = citation.slice(2)
  return chunkId.includes(':') ? chunkId.slice(0, chunkId.lastIndexOf(':')) : null
}

const pageOf = (value: unknown) => (typeof value === 'number' ? value : null)

export function toPassage(
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
    ...(passage.broader === true && { broader: true as const }),
    documentId,
    document: record
      ? {
          title: record.title,
          issuingBody: record.issuingBody,
          sourceType: record.sourceType,
          edition: record.edition,
          effectiveDate: record.effectiveDate,
          facilityType: record.facilityType,
          withdrawnAt: record.withdrawn?.at ?? null,
          fileUrl: record.fileUrl,
        }
      : null,
  }
}

// A finding still in the draft: not rejected.
const kept = (f: Finding) => f.state !== 'rejected'

// A subsection is written when a finding in it is still in the draft, or when
// the engineer wrote text into it in the document editor (RV-08). A section
// with no draft is complete once the engineer has written it.
function completionOf(
  draft: Draft | null,
  findings: readonly Finding[],
  document: SectionDocumentDto | null,
): ReviewSectionDto['completion'] {
  const own = document?.current ? document.document : null
  if (!draft)
    return own && hasWrittenText(own)
      ? { state: 'complete', written: 0, total: 0, tables: 0 }
      : { state: 'not_started', written: 0, total: 0, tables: 0 }
  const headings = new Set(findings.filter(kept).map((f) => f.heading))
  const typed = own ? writtenSubsections(own) : new Set<number>()
  const writable = draft.subsections.flatMap((s, i) => (s.kind === 'table' ? [] : [{ ...s, i }]))
  const written = writable.filter((s) => headings.has(s.heading) || typed.has(s.i)).length
  return {
    state: written === 0 ? 'not_started' : written < writable.length ? 'partial' : 'complete',
    written,
    total: writable.length,
    tables: draft.subsections.length - writable.length,
  }
}

const NO_FINDINGS: FindingCounts = { total: 0, pending: 0, accepted: 0, edited: 0, rejected: 0 }

// A draft with each finding's decision, in the template's order.
function reviewDraft(draft: Draft, findings: readonly Finding[]): ReviewDraftDto {
  const { id, sectionId, title, questions, guardrail, provenance, createdAt } = toDraftDto(draft)
  const byKey = new Map(findings.map((f) => [f.key, f]))
  return {
    id,
    sectionId,
    title,
    questions,
    guardrail,
    provenance,
    createdAt,
    subsections: draft.subsections.map((sub, i) => ({
      heading: sub.heading,
      kind: sub.kind,
      statements: sub.statements.map((_, j) => {
        const f = byKey.get(`${i}.${j}`)!
        return {
          text: f.text,
          generatedText: f.generatedText,
          citations: f.citations,
          supported: f.supported,
          citationsRemoved: f.citationsRemoved,
          review: {
            state: f.state,
            at: f.decided?.at ?? null,
            by: f.decided?.by ?? null,
          },
        }
      }),
    })),
  }
}

// A draft's cited passages resolved, and the observations shown with it: the
// section's own, and any other the draft cites, as drafted from.
function evidenceOf(
  draft: Draft,
  section: TemplateSection,
  documents: Map<string, KnowledgeDocumentDto>,
  captured: Map<string, Date>,
) {
  const sources = Object.fromEntries(
    Object.entries(draft.sources ?? {}).map(([citation, passage]) => [
      citation,
      toPassage(citation, passage, documents),
    ]),
  )
  const cited = new Set(
    draft.subsections.flatMap((s) => s.statements.flatMap((st) => st.citations)),
  )
  const observations: FieldObservationDto[] = savedEvidence(draft.evidence)
    .filter((e) => cited.has(`O:${e.id}`) || filedUnder(section, e.COPE_dimension))
    .map((e) => ({
      id: e.id,
      copeDimensions: e.COPE_dimension,
      note: e.note ?? null,
      transcripts: e.transcripts ?? [],
      handwriting: e.handwriting ?? [],
      severity: e.severity,
      location: e.location ?? null,
      standard: e.standard ?? null,
      capturedAt: captured.get(e.id) ?? null,
    }))
  return { sources, observations }
}

type InsertedProposal = Pick<
  IReportTextProposal,
  'sectionId' | 'kind' | 'request' | 'sentences' | 'sources' | 'insertion'
> & { _id: Types.ObjectId }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [])
const stringOr = (v: unknown) => (typeof v === 'string' ? v : null)

// The passages and observations text inserted from the Ask tab cites (AS-04),
// as its proposals saved them, added to the section's own: whatever the
// section's text cites can then be opened. The draft's own come first.
function withInserted(
  evidence: { sources: Record<string, SourcePassageDto>; observations: FieldObservationDto[] },
  inserted: readonly InsertedProposal[],
  documents: Map<string, KnowledgeDocumentDto>,
  captured: Map<string, Date>,
) {
  const sources = { ...evidence.sources }
  const observations = [...evidence.observations]
  const shown = new Set(observations.map((o) => o.id))
  for (const p of inserted)
    for (const [ref, saved] of Object.entries(p.sources ?? {})) {
      if (ref.startsWith('O:')) {
        const o = (saved ?? {}) as Record<string, unknown>
        const id = String(o.id ?? ref.slice(2))
        if (shown.has(id)) continue
        shown.add(id)
        observations.push({
          id,
          copeDimensions: strings(o.COPE_dimension),
          note: stringOr(o.note),
          transcripts: strings(o.transcripts),
          handwriting: strings(o.handwriting),
          severity: stringOr(o.severity) ?? '',
          location: stringOr(o.location),
          standard: stringOr(o.standard),
          capturedAt: captured.get(id) ?? null,
        })
      } else if (!(ref in sources)) sources[ref] = toPassage(ref, saved, documents)
    }
  return { sources, observations }
}

// The section's AI-drafted text awaiting Accept (AS-04), read from its
// current version, and how many of its sentences are still unsupported.
function aiTextOf(
  document: SectionDocumentDto | null,
  inserted: readonly InsertedProposal[],
): { drafts: AiDraftDto[]; unsupported: number } {
  const text = document?.current ? document.document : null
  if (!text) return { drafts: [], unsupported: 0 }
  const byId = new Map(inserted.map((p) => [String(p._id), p]))
  const drafts = aiIdsIn(text).flatMap((id): AiDraftDto[] => {
    const p = byId.get(id)
    return p?.insertion
      ? [
          {
            id,
            kind: p.kind,
            request: p.request,
            unsupported: p.sentences.filter((s) => !s.supported).map((s) => s.text),
            insertedAt: p.insertion.at,
            insertedBy: { id: p.insertion.by.id, name: p.insertion.by.name },
          },
        ]
      : []
  })
  const still = unsupportedAiText(text, new Map(drafts.map((d) => [d.id, d.unsupported])))
  return { drafts, unsupported: [...still.values()].reduce((n, s) => n + s.length, 0) }
}

function historyEntry(e: ReviewEntry): ReviewHistoryEntryDto {
  return {
    id: String(e._id),
    draftId: String(e.draft),
    action: e.action,
    finding: e.finding,
    heading: e.heading,
    before: e.before,
    after: e.after,
    citations: e.citations ?? [],
    citationsAfter: e.citationsAfter ?? null,
    instruction: e.instruction,
    bulk: e.bulk,
    inDocument: e.inDocument ?? false,
    restoredFrom: e.restoredFrom ?? null,
    by: { id: e.by.id, name: e.by.name },
    at: e.at,
  }
}

const addCounts = (a: FindingCounts, b: FindingCounts): FindingCounts => ({
  total: a.total + b.total,
  pending: a.pending + b.pending,
  accepted: a.accepted + b.accepted,
  edited: a.edited + b.edited,
  rejected: a.rejected + b.rejected,
})

// Sections 7-12 for reviewing, in template order.
// `loaded` is the sections when the caller has already read them (MarshBot's re-check).
export async function getReviewWorkspace(
  reference: string,
  loaded?: LoadedSection[],
): Promise<ReviewWorkspaceDto> {
  const asOf = new Date()
  loaded ??= await loadSections(reference)
  const drafts = loaded.flatMap(({ latest, replacement }) =>
    [latest, replacement].filter((d): d is Draft => d !== null),
  )
  const assessment = await assessmentIdOf(reference)
  // One query for the review log, one for the document editor's versions,
  // and one lookup for every document any draft cites.
  const [entries, versions, summary, inserted] = await Promise.all([
    drafts.length ? assessmentHistory(assessment) : [],
    latestVersions(assessment),
    summaryDraft(assessment),
    // Text inserted from the Ask tab, whose sources the sections' text may cite (AS-04).
    ReportTextProposalModel.find(
      { assessment, insertion: { $ne: null } },
      'sectionId kind request sentences sources insertion',
    )
      .sort({ 'insertion.at': 1 })
      .lean<InsertedProposal[]>(),
  ])
  const insertedIn = (sectionId: string) => inserted.filter((p) => p.sectionId === sectionId)
  // A version is current while it was made on the section's saved draft.
  const documentOf = (sectionId: string, draft: { _id: unknown } | null) => {
    const version = versions.get(sectionId)
    if (!version) return null
    return { ...version, current: version.draftId === (draft ? String(draft._id) : null) }
  }
  const documentIds = [...drafts, ...inserted].flatMap((cited) =>
    Object.entries(cited.sources ?? {}).flatMap(([citation, saved]) => {
      if (citation.startsWith('O:')) return []
      const id = documentIdOf(citation, (saved ?? {}) as SavedPassage)
      return id ? [id] : []
    }),
  )
  const documents = new Map(
    (await findKnowledgeDocuments(documentIds)).map((document) => [document.id, document]),
  )
  const captured = await captureTimes([
    ...drafts.flatMap((d) => savedEvidence(d.evidence).map((e) => e.id)),
    ...inserted.flatMap((p) =>
      Object.keys(p.sources ?? {}).flatMap((ref) => (ref.startsWith('O:') ? [ref.slice(2)] : [])),
    ),
  ])

  const sections = loaded.map(
    ({ section, latest, replacement, changesSinceDraft, changeCounts }): ReviewSectionDto => {
      const base = {
        id: section.id,
        title: section.title,
        copeDimensions: section.cope_dimensions,
        // A carried decision repeats one already listed (review-decision.service).
        history: entries
          .filter((e) => e.sectionId === section.id && !e.carriedFrom)
          .map(historyEntry),
        replacement:
          replacement && toReplacement(replacement, section, documents, captured, entries),
        document: documentOf(section.id, latest),
      }
      const ai = aiTextOf(base.document, insertedIn(section.id))
      const aiText = { pending: ai.drafts.length, unsupported: ai.unsupported }
      // The engineer's own text, AI-drafted text awaiting Accept left out (AS-04).
      const ownText = !!base.document?.current && hasOwnText(base.document.document)
      if (!latest) {
        const completion = completionOf(null, [], base.document)
        return {
          ...base,
          completion,
          review: {
            // Written in the document editor (RV-08 AC3), or holding AI-drafted
            // text to accept (AS-04).
            state: aiText.pending
              ? 'needs_review'
              : completion.state === 'complete'
                ? 'edited'
                : 'not_drafted',
            unsupportedStatements: 0,
            withdrawnSources: 0,
            changesSinceDraft: 0,
            changeCounts,
            editedInDocument: ownText,
            aiText,
          },
          findings: NO_FINDINGS,
          draft: null,
          ...withInserted(
            { sources: {}, observations: [] },
            insertedIn(section.id),
            documents,
            captured,
          ),
          aiDrafts: ai.drafts,
        }
      }
      const findings = foldFindings(latest, entries)
      const counts = countFindings(findings)
      const { sources, observations } = withInserted(
        evidenceOf(latest, section, documents, captured),
        insertedIn(section.id),
        documents,
        captured,
      )
      const inDraft = findings.filter(kept)
      const unsupportedStatements = inDraft.filter((f) => !f.supported).length
      const citedNow = new Set(inDraft.flatMap((f) => f.citations))
      const withdrawnSources = Object.values(sources).filter(
        (p) => citedNow.has(p.id) && p.document?.withdrawnAt,
      ).length
      // Changed in the document editor (RV-08 AC12): a finding edited or deleted
      // there, or text the engineer wrote into the section.
      const editedInDocument =
        entries.some((e) => e.inDocument && String(e.draft) === String(latest._id)) || ownText
      return {
        ...base,
        completion: completionOf(latest, findings, base.document),
        review: {
          state:
            unsupportedStatements || withdrawnSources || changesSinceDraft || aiText.pending
              ? 'needs_review'
              : editedInDocument
                ? 'edited'
                : counts.pending === counts.total
                  ? 'ai_draft'
                  : counts.pending
                    ? 'in_review'
                    : 'reviewed',
          unsupportedStatements,
          withdrawnSources,
          changesSinceDraft,
          changeCounts,
          editedInDocument,
          aiText,
        },
        findings: counts,
        draft: reviewDraft(latest, findings),
        sources,
        observations,
        aiDrafts: ai.drafts,
      }
    },
  )
  return {
    sections,
    parts: {
      '1': documentOf('1', null),
      '2': documentOf('2', summary),
      '3': documentOf('3', null),
      A: documentOf('A', null),
    },
    summary: sections.reduce((sum, s) => addCounts(sum, s.findings), NO_FINDINGS),
    asOf,
  }
}

function toReplacement(
  replacement: Draft,
  section: TemplateSection,
  documents: Map<string, KnowledgeDocumentDto>,
  captured: Map<string, Date>,
  entries: readonly ReviewEntry[],
): ReplacementDto {
  const asked = entries.find(
    (e) => e.action === 'regenerate' && String(e.draft) === String(replacement._id),
  )
  return {
    draft: reviewDraft(replacement, foldFindings(replacement, entries)),
    ...evidenceOf(replacement, section, documents, captured),
    instruction: replacement.provenance.instruction ?? null,
    requestedBy: asked ? { id: asked.by.id, name: asked.by.name } : null,
    requestedAt: replacement.createdAt,
  }
}

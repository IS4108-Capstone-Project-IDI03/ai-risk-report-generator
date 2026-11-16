// Text drafted or rewritten for a report section from the Ask tab (AS-04).
//
// The assigned engineer asks for it in the Ask tab: "Draft text" with an
// instruction ("Draft a paragraph on flood exposure from the observations"),
// or "Rewrite this" on text selected in a section. The question goes through
// assessment-ask.service as any other, so it is one streamed request through
// S4's orchestrator, with the same masking, provider and trace (AS-01 AC6);
// this file decides what S4 is told of the section and keeps the proposal in
// `report_text_proposals`. Making a proposal writes nothing to the report
// (AC1).
//
// Insert (a draft) or Replace (a rewrite) then saves the section's next
// version with the proposal's paragraphs marked `ai: <proposal id>` (AC2): AI
// draft, in violet, with its citation markers. The section is back in Needs
// review until the engineer accepts the text; Undo restores the text before.
// A sentence with no supporting source stays marked unsupported, and blocks
// the export, until it is given a citation, reworded or deleted (AC3). Only
// standards in the drafting set can be cited (AC4). Insert, Replace, Undo,
// Accept and Delete need `reports:generate` and the assigned engineer, on an
// assessment neither archived nor finalised (AC5). If the section's text
// changed after the proposal was made, Insert refuses and asks for the
// proposal to be made again (AC6). Called by assessment-ask.service and
// routes/proposal.routes.ts.
import { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import type { IAnswerCitation, IAnswerStatement } from '../models/assistant-conversation.model'
import type { CopeDimension } from '../models/observation.model'
import {
  ReportSectionVersionModel,
  type DocumentParagraph,
  type SectionDocument,
} from '../models/report-section-version.model'
import {
  ReportTextProposalModel,
  type IReportTextProposal,
  type ProposalKind,
} from '../models/report-text-proposal.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { selectedStandards } from './drafting-set.service'
import type { KnowledgeDocumentDto } from './knowledge-document.service'
import {
  StaleDocumentError,
  writeSectionVersion,
  type SectionVersionDto,
  type Version,
} from './report-document.service'
import { entriesFor, foldFindings, StaleDraftError } from './review-decision.service'
import { getReviewWorkspace, type ReviewWorkspaceDto } from './review.service'
import { savedEvidence, sectionDrafts, templateSection, type Draft } from './section.service'
import {
  aiIdsIn,
  citesOf,
  currentDocument,
  documentSignature,
  insertParagraphs,
  plainText,
  replaceParagraphs,
  rewriteRange,
  sectionText,
  settleAiText,
  unsupportedAiText,
} from './section-document'

// The most a rewrite replaces: the paragraphs a selection of up to 4,000
// characters (AS-02) is in.
export const MAX_REWRITE_CHARS = 6000

// What a request for text names: a draft for one of Sections 4 to 12, or a
// rewrite of the passage sent with it, whose anchor names its section.
export const proposeSchema = z.strictObject({
  kind: z.enum(['draft', 'rewrite']),
  sectionId: z
    .string()
    .regex(/^(1[0-2]|[4-9])$/, 'Text is drafted into one of Sections 4 to 12.')
    .optional(),
})
export type ProposeInput = z.infer<typeof proposeSchema>

// A request for text, or an Insert, Replace, Undo, Accept or Delete, that
// cannot be done, with its cause and the next step, as the Ask tab states a
// failure (AS-01 AC8). `code` tells the browser what to offer: `stale` the
// proposal made again (AC6).
export type RefusalCode =
  'stale' | 'finalised' | 'state' | 'target' | 'moved' | 'drafting-set' | 'unsupported'
export class ProposalRefusedError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: RefusalCode | 'not-found',
    readonly reason: string,
    readonly next: string,
  ) {
    super(`${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`)
    this.name = 'ProposalRefusedError'
  }
}
const refuse = (status: 400 | 409, code: RefusalCode, reason: string, next: string) =>
  new ProposalRefusedError(status, code, reason, next)
export class ProposalNotFoundError extends ProposalRefusedError {
  constructor() {
    super(404, 'not-found', 'this proposal could not be found', 'Draft the text again.')
    this.name = 'ProposalNotFoundError'
  }
}

const PROGRAMS = 'Management Programs'

type Assessment = {
  _id: Types.ObjectId
  reference: string
  site: Pick<ISite, 'jurisdiction' | 'facilityType'>
}

// The assessment, for its assigned engineer to draft text into (AC5): not
// archived and not finalised (409); anyone else 403.
export async function assessmentToPropose(
  reference: string,
  user: SessionUser,
): Promise<Assessment> {
  const assessment = await AssessmentModel.findOne(
    { reference },
    'reference engineer site archivedAt reportStatus',
  )
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id)
    throw new NotAssignedError('Only the assigned engineer can draft text into this report.')
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  if (assessment.reportStatus === 'finalised')
    throw refuse(
      409,
      'finalised',
      'the report is finalised, so its text is not changed',
      'Ask questions about it instead.',
    )
  return { _id: assessment._id, reference: assessment.reference, site: assessment.site }
}

// One of Sections 4 to 12 now: its saved draft and findings, its text as the
// review workspace shows it and the document editor opens it, and what a new
// version would be built on (its newest version, 0 for none, and saved draft).
export async function sectionNow(assessment: Types.ObjectId, sectionId: string) {
  const [drafts, latest] = await Promise.all([
    sectionDrafts(assessment),
    ReportSectionVersionModel.findOne({ assessment, sectionId })
      .sort({ version: -1 })
      .lean<Version>(),
  ])
  const draft = drafts.get(sectionId)?.saved ?? null
  const draftId = draft ? String(draft._id) : null
  const findings = draft ? foldFindings(draft, await entriesFor([draft._id])) : []
  // A version made on an earlier draft is set aside (RV-08).
  const onDraft = latest && (latest.draft ? String(latest.draft) : null) === draftId
  const document = currentDocument(draft, findings, onDraft ? latest.document : null)
  return {
    draft,
    findings,
    document,
    version: latest?.version ?? 0,
    draftId,
    signature: documentSignature(document),
  }
}
type SectionNow = Awaited<ReturnType<typeof sectionNow>>

// The section as the report heads it, its category, and where drafted text
// can go: each of its draft's subsections but tables and Section 6's
// programmes (Marsh's table); none for a section with no draft, whose text has
// no subsections.
async function sectionShape(sectionId: string, draft: Draft | null) {
  const section = await templateSection(sectionId)
  const cope: CopeDimension | 'all' =
    section.cope_dimensions.length === 1 ? (section.cope_dimensions[0] as CopeDimension) : 'all'
  const choices = (draft?.subsections ?? []).flatMap((sub, index) =>
    sub.kind === 'table' || (sectionId === '6' && sub.heading === PROGRAMS)
      ? []
      : [{ index, heading: sub.heading }],
  )
  return { label: `${sectionId}. ${draft?.title ?? section.title}`, cope, choices }
}

// A source the section's text cites, as saved with its draft or with text
// inserted into it before: a passage's text and Chroma labels, or an
// observation as it was then.
type Saved = Record<string, unknown>
async function sectionSources(
  assessment: Types.ObjectId,
  sectionId: string,
  draft: Draft | null,
): Promise<Map<string, Saved>> {
  const inserted = await ReportTextProposalModel.find(
    { assessment, sectionId, insertion: { $ne: null } },
    'sources',
  ).lean()
  const found = new Map<string, Saved>()
  for (const p of inserted)
    for (const [ref, saved] of Object.entries(p.sources ?? {})) found.set(ref, saved as Saved)
  for (const e of savedEvidence(draft?.evidence)) found.set(`O:${e.id}`, e as unknown as Saved)
  for (const [ref, saved] of Object.entries(draft?.sources ?? {})) found.set(ref, saved as Saved)
  return found
}

// A chunk ID is `<document id>:<n>`, should a passage lack its `doc_id`.
function documentIdOf(ref: string, saved: Saved | undefined): string | null {
  if (typeof saved?.doc_id === 'string') return saved.doc_id
  const chunk = ref.slice(2)
  return chunk.includes(':') ? chunk.slice(0, chunk.lastIndexOf(':')) : null
}

// An observation as S4's Ask request takes it (assessment-ask.service's AskObservation).
type SentObservation = {
  id: string
  COPE_dimension: string[] | null
  note: string | null
  transcripts: string[]
  handwriting: string[]
  severity: string | null
  location: string | null
  standard: string | null
}
const texts = (v: unknown) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [])
const textOf = (v: unknown) => (typeof v === 'string' ? v : null)
function sentObservation(saved: Saved): SentObservation {
  const cope = texts(saved.COPE_dimension)
  return {
    id: String(saved.id ?? ''),
    COPE_dimension: cope.length ? cope : null,
    note: textOf(saved.note),
    transcripts: texts(saved.transcripts),
    handwriting: texts(saved.handwriting),
    severity: textOf(saved.severity),
    location: textOf(saved.location),
    standard: textOf(saved.standard),
  }
}

// The passage a rewrite was asked on, as RV-03's anchor holds it (AS-02).
type Anchor = {
  sectionId: string
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

// What a request for text is made on, ready for S4 and to keep (AS-04).
export type ProposalContext = {
  sectionId: string
  label: string
  kind: ProposalKind
  cope: CopeDimension | 'all'
  choices: { index: number; heading: string }[]
  replaces: IReportTextProposal['replaces']
  base: { version: number; draftId: string | null; signature: string }
  // S4's `propose` block, and for a rewrite its `passage` block (the
  // paragraphs as words, what they cite and the cited passages' text).
  propose: object
  passage: object | null
  // The rewrite's passage as the question keeps it (AS-02's format).
  saved: { anchor: Anchor; label: string; citations: string[]; findings: string[] } | null
  // Observations the paragraphs cite that are no longer the assessment's.
  observations: SentObservation[]
}

/**
 * What a request for text is made on: the section's text now and what S4 may
 * cite. A draft names its section; a rewrite, the passage selected in it,
 * which must still be where the engineer selected it (else 409: select it
 * again), and is widened to the paragraphs it is in: plain paragraphs of one
 * subsection, or items of one list (400 otherwise). Only the cited standards
 * in the drafting set (`standards`) and observations go to S4 as what the
 * paragraphs rest on; a past report never does (AC4).
 */
export async function proposalContext(
  assessment: Assessment,
  input: ProposeInput,
  passage: { anchor: Anchor } | undefined,
  standards: KnowledgeDocumentDto[],
  observations: { id: string }[],
): Promise<ProposalContext> {
  const sectionId = input.kind === 'rewrite' ? passage?.anchor.sectionId : input.sectionId
  if (!sectionId || !/^(1[0-2]|[4-9])$/.test(sectionId))
    throw refuse(
      400,
      'target',
      input.kind === 'rewrite'
        ? 'only text in Sections 4 to 12 is rewritten here'
        : 'text is drafted into one of Sections 4 to 12',
      input.kind === 'rewrite'
        ? 'Select text in one of Sections 4 to 12.'
        : 'Open one of Sections 4 to 12, then draft again.',
    )
  const now = await sectionNow(assessment._id, sectionId)
  const { label, cope, choices } = await sectionShape(sectionId, now.draft)
  const base = { version: now.version, draftId: now.draftId, signature: now.signature }
  const propose = {
    kind: input.kind,
    section_id: sectionId,
    section_title: label,
    subsections: input.kind === 'draft' ? choices : [],
  }
  if (input.kind === 'draft')
    return {
      sectionId,
      label,
      kind: 'draft',
      cope,
      choices,
      replaces: null,
      base,
      propose,
      passage: null,
      saved: null,
      observations: [],
    }

  const anchor = passage!.anchor
  const { text, blocks } = sectionText(now.document)
  if (text.slice(anchor.start, anchor.end) !== anchor.exact)
    throw refuse(
      409,
      'moved',
      'the selected text is not where it was: the section changed, or has unsaved changes',
      'Save the document if you are editing it, then select the text again.',
    )
  const touched = blocks.filter((b) => anchor.start < b.offset + b.length && anchor.end > b.offset)
  const [first] = touched
  const last = touched[touched.length - 1]
  const range = first ? rewriteRange(now.document, first.index, last.index) : null
  if (!range)
    throw refuse(
      400,
      'target',
      'the selection includes a sub-heading, or text in more than one subsection or list',
      'Select text in paragraphs of one subsection, or in one list, to rewrite it.',
    )
  const words = touched.map((b) => plainText(b.content)).join('\n')
  if (words.length > MAX_REWRITE_CHARS)
    throw refuse(
      400,
      'target',
      'the paragraphs the selection is in are too long to rewrite at once',
      'Select text in fewer paragraphs.',
    )
  // What the paragraphs cite, as the section saved it; a standard outside the
  // drafting set and a past report are left out (AC4).
  const sources = await sectionSources(assessment._id, sectionId, now.draft)
  const set = new Set(standards.map((d) => d.id))
  const known = new Set(observations.map((o) => o.id))
  const cited = [...new Set(touched.flatMap((b) => citesOf(b.content)))]
  const kept = cited.filter((ref) =>
    ref.startsWith('O:')
      ? known.has(ref.slice(2)) || sources.has(ref)
      : ref.startsWith('C:') &&
        typeof sources.get(ref)?.text === 'string' &&
        set.has(documentIdOf(ref, sources.get(ref)) ?? ''),
  )
  const findings = [...new Set(touched.flatMap((b) => (b.finding ? [b.finding] : [])))]
  return {
    sectionId,
    label,
    kind: 'rewrite',
    cope,
    choices: [],
    replaces: { from: first.index, to: last.index, words, citations: kept },
    base,
    propose,
    passage: {
      section_id: sectionId,
      section_title: label,
      text: words,
      citations: kept,
      sources: kept.flatMap((ref) => {
        if (!ref.startsWith('C:')) return []
        const saved = sources.get(ref)!
        return [
          {
            id: ref.slice(2),
            kind: 'standard',
            text: saved.text,
            metadata: {
              doc_id: documentIdOf(ref, saved),
              headings: texts(saved.headings),
              page_start: typeof saved.page_start === 'number' ? saved.page_start : null,
              page_end: typeof saved.page_end === 'number' ? saved.page_end : null,
            },
          },
        ]
      }),
      findings: [],
    },
    saved: { anchor, label, citations: kept, findings },
    // A cited observation deleted since is sent as the section saved it.
    observations: kept.flatMap((ref) =>
      ref.startsWith('O:') && !known.has(ref.slice(2)) ? [sentObservation(sources.get(ref)!)] : [],
    ),
  }
}

// Keeps a new proposal while S4 writes it, with the conversation and turn it
// was asked in (AS-03), under the id the turn names.
export async function startProposal(
  id: Types.ObjectId,
  assessment: Assessment,
  user: SessionUser,
  context: ProposalContext,
  request: string,
  conversation: string,
  turn: Types.ObjectId,
): Promise<void> {
  await ReportTextProposalModel.create({
    _id: id,
    assessment: assessment._id,
    sectionId: context.sectionId,
    label: context.label,
    kind: context.kind,
    userId: new Types.ObjectId(user.id),
    conversation: new Types.ObjectId(conversation),
    turn,
    request,
    choices: context.choices,
    subsection: null,
    replaces: context.replaces,
    base: {
      version: context.base.version,
      draft: context.base.draftId ? new Types.ObjectId(context.base.draftId) : null,
      signature: context.base.signature,
    },
    metadata: {
      source_type: 'report_text_proposal',
      jurisdiction: assessment.site.jurisdiction,
      facility_type: assessment.site.facilityType,
      COPE_dimension: context.cope,
      effective_date: new Date(),
    },
  })
}

// What S4 wrote, kept with the proposal: its sentences, missing evidence,
// sources, the subsection a draft fits (the model's choice, else the first
// it can go in) and what wrote it. With no sentence, or once the stream
// failed, nothing can be inserted.
export async function finishProposal(
  id: Types.ObjectId,
  written: {
    statements: IAnswerStatement[]
    missing: string[]
    sources: Record<string, unknown>
    target: unknown
    failed: boolean
    provider: string | null
    model: string | null
    promptVersion: string | null
  },
): Promise<void> {
  const proposal = await ReportTextProposalModel.findById(id, 'kind choices').lean<
    Pick<Kept, 'kind' | 'choices'>
  >()
  if (!proposal) return
  const sentences = written.statements.map((s) => ({
    text: s.text,
    citations: s.citations,
    supported: s.supported !== false && s.citations.length > 0,
    paragraph: typeof s.paragraph === 'number' && s.paragraph >= 0 ? s.paragraph : 0,
  }))
  const offered = proposal.choices.map((c) => c.index)
  const subsection =
    proposal.kind === 'rewrite'
      ? null
      : typeof written.target === 'number' && offered.includes(written.target)
        ? written.target
        : (offered[0] ?? -1)
  await ReportTextProposalModel.updateOne(
    { _id: id, status: 'drafting' },
    {
      $set: {
        status: sentences.length && !written.failed ? 'proposed' : 'failed',
        sentences,
        missing: written.missing,
        sources: written.sources,
        subsection,
        provider: written.provider,
        model: written.model,
        promptVersion: written.promptVersion,
      },
    },
  )
}

// A proposal as the Ask tab shows it (AS-04).
export type ProposalDto = {
  id: string
  kind: ProposalKind
  sectionId: string
  // The section as the report heads it, e.g. "10. Exposures".
  label: string
  // A draft: where it can go, and where it goes (-1: before the first subsection).
  choices: { index: number; heading: string }[]
  subsection: number | null
  // A rewrite: the paragraphs it replaces, as they read when it was proposed.
  before: string | null
  sentences: { text: string; citations: IAnswerCitation[]; supported: boolean; paragraph: number }[]
  status: IReportTextProposal['status']
  inserted: { at: Date; by: { id: string; name: string }; version: number } | null
  settled: { action: 'accepted' | 'deleted' | 'undone'; at: Date } | null
  // Whether Undo can still restore the text before it: inserted, and the
  // section not saved again since.
  canUndo: boolean
}

type Kept = IReportTextProposal & { _id: Types.ObjectId }

function proposalDto(p: Kept, newest: number | null): ProposalDto {
  return {
    id: String(p._id),
    kind: p.kind,
    sectionId: p.sectionId,
    label: p.label,
    choices: p.choices.map(({ index, heading }) => ({ index, heading })),
    subsection: p.subsection,
    before: p.replaces?.words ?? null,
    sentences: p.sentences.map(({ text, citations, supported, paragraph }) => ({
      text,
      citations,
      supported,
      paragraph,
    })),
    status: p.status,
    inserted: p.insertion
      ? { at: p.insertion.at, by: p.insertion.by, version: p.insertion.version }
      : null,
    settled: p.settled ? { action: p.settled.action, at: p.settled.at } : null,
    canUndo: p.status === 'inserted' && !!p.insertion && newest === p.insertion.version,
  }
}

// The proposals with these ids, by id, as the Ask tab shows them.
export async function proposalDtos(
  ids: (Types.ObjectId | null | undefined)[],
): Promise<Map<string, ProposalDto>> {
  const wanted = ids.filter((id): id is Types.ObjectId => !!id)
  if (!wanted.length) return new Map()
  const found = await ReportTextProposalModel.find({ _id: { $in: wanted } }).lean<Kept[]>()
  // Each section's newest version, for whether Undo still applies.
  const inserted = found.filter((p) => p.status === 'inserted')
  const newest = new Map<string, number>()
  for (const p of inserted) {
    const key = `${p.assessment}:${p.sectionId}`
    if (newest.has(key)) continue
    const latest = await ReportSectionVersionModel.findOne(
      { assessment: p.assessment, sectionId: p.sectionId },
      'version',
    )
      .sort({ version: -1 })
      .lean()
    newest.set(key, latest?.version ?? 0)
  }
  return new Map(
    found.map((p) => [
      String(p._id),
      proposalDto(p, newest.get(`${p.assessment}:${p.sectionId}`) ?? null),
    ]),
  )
}

// The proposal's paragraphs as the section saves them: each sentence, then
// its citation markers, the paragraphs marked as AI-drafted text awaiting
// Accept (AC2).
export function proposalParagraphs(p: Pick<Kept, '_id' | 'sentences'>): DocumentParagraph[] {
  const paragraphs = new Map<number, DocumentParagraph>()
  for (const s of p.sentences) {
    const paragraph = paragraphs.get(s.paragraph) ?? {
      type: 'paragraph' as const,
      ai: String(p._id),
      content: [],
    }
    paragraphs.set(s.paragraph, paragraph)
    const words = s.text.replace(/\s+/g, ' ').trim()
    if (words)
      paragraph.content.push({ type: 'text', text: paragraph.content.length ? ` ${words}` : words })
    for (const c of s.citations) paragraph.content.push({ type: 'cite', id: c.ref })
  }
  return [...paragraphs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, paragraph]) => paragraph)
    .filter((paragraph) => paragraph.content.length)
}

// The proposal named, for the user who asked for it, on an assessment they may
// draft text into. Another user's answers 404, as one that never existed.
async function ownProposal(reference: string, id: string, user: SessionUser) {
  const assessment = await assessmentToPropose(reference, user)
  const proposal = Types.ObjectId.isValid(id)
    ? await ReportTextProposalModel.findOne({
        _id: new Types.ObjectId(id),
        assessment: assessment._id,
        userId: new Types.ObjectId(user.id),
      }).lean<Kept>()
    : null
  if (!proposal) throw new ProposalNotFoundError()
  return { assessment, proposal }
}

const stale = () =>
  refuse(
    409,
    'stale',
    'the section changed after this text was proposed, so inserting it could overwrite that change',
    'Draft the text again to start from the section as it is now.',
  )

// Every standard the proposal cites is still in the drafting set (AC4): a
// checklist made since may have dropped one, or it was withdrawn.
async function checkDraftingSet(assessment: Assessment, p: Kept) {
  const { standards } = await selectedStandards(assessment._id, assessment.site)
  const set = new Set(standards.map((d) => d.id))
  const outside = p.sentences
    .flatMap((s) => s.citations)
    .filter((c) => c.ref.startsWith('C:'))
    .some((c) => !set.has(documentIdOf(c.ref, p.sources?.[c.ref] as Saved | undefined) ?? ''))
  if (outside)
    throw refuse(
      409,
      'drafting-set',
      'a standard this text cites is no longer in the assessment’s drafting set',
      'Draft the text again, so it cites only the standards selected now.',
    )
}

// Saves the section's next version with `document` as its text, on the
// section as it was read (`now`), mapping a newer save to `stale`.
async function saveText(
  reference: string,
  sectionId: string,
  now: Pick<SectionNow, 'version' | 'draftId'>,
  user: SessionUser,
  document: SectionDocument,
  stale: ProposalRefusedError,
  restoredFrom: string | null = null,
  inserting: string | null = null,
): Promise<SectionVersionDto> {
  try {
    return await writeSectionVersion(
      reference,
      sectionId,
      { baseVersion: now.version, draftId: now.draftId },
      user,
      async () => document,
      restoredFrom,
      inserting,
    )
  } catch (error) {
    if (error instanceof StaleDraftError || error instanceof StaleDocumentError) throw stale
    throw error
  }
}

export type ApplyResult = { proposal: ProposalDto; workspace: ReviewWorkspaceDto }

async function result(reference: string, id: Types.ObjectId): Promise<ApplyResult> {
  const [shown, workspace] = await Promise.all([proposalDtos([id]), getReviewWorkspace(reference)])
  return { proposal: shown.get(String(id))!, workspace }
}

export const insertSchema = z.strictObject({
  // Where a draft goes: the subsection, by index, or -1 for a section with none.
  subsection: z.number().int().min(-1).max(50).optional(),
})

/**
 * Insert (a draft, at the end of its subsection) or Replace (a rewrite, in
 * place of the paragraphs it rewrote): the section's next version holds the
 * proposal's paragraphs as AI-drafted text awaiting Accept (AC2), so the
 * section is back in Needs review. Refused (409) once the section's text
 * changed after the proposal was made (AC6), or a standard it cites left the
 * drafting set (AC4). A finding the rewrite replaces leaves the text, as one
 * deleted in the document editor does (RV-08: a `reject` in the review log).
 */
export async function applyProposal(
  reference: string,
  id: string,
  action: 'insert' | 'replace',
  user: SessionUser,
  subsection?: number,
): Promise<ApplyResult> {
  const { assessment, proposal: p } = await ownProposal(reference, id, user)
  if ((p.kind === 'draft') !== (action === 'insert'))
    throw refuse(
      409,
      'state',
      p.kind === 'draft' ? 'drafted text is inserted, not replaced' : 'a rewrite replaces text',
      p.kind === 'draft' ? 'Use Insert.' : 'Use Replace.',
    )
  if (p.status !== 'proposed')
    throw refuse(
      409,
      'state',
      p.status === 'drafting'
        ? 'this text is still being written'
        : p.status === 'failed'
          ? 'this request wrote no text to insert'
          : 'this text was inserted already',
      p.status === 'drafting' ? 'Wait for it to finish.' : 'Draft the text again to insert more.',
    )
  const paragraphs = proposalParagraphs(p)
  if (!paragraphs.length)
    throw refuse(409, 'state', 'this request wrote no text to insert', 'Draft the text again.')
  const now = await sectionNow(assessment._id, p.sectionId)
  if (
    now.version !== p.base.version ||
    now.draftId !== (p.base.draft ? String(p.base.draft) : null) ||
    now.signature !== p.base.signature
  )
    throw stale()
  await checkDraftingSet(assessment, p)

  let document: SectionDocument
  let into: number | null = null
  if (p.kind === 'draft') {
    into = subsection ?? p.subsection ?? -1
    const allowed = p.choices.length ? p.choices.map((c) => c.index) : [-1]
    if (!allowed.includes(into))
      throw refuse(
        400,
        'target',
        'drafted text goes into one of the section’s subsections offered',
        'Choose where to insert it.',
      )
    document = insertParagraphs(now.document, into, paragraphs)
  } else {
    const range = p.replaces && rewriteRange(now.document, p.replaces.from, p.replaces.to)
    if (!range) throw stale()
    document = replaceParagraphs(now.document, range, paragraphs)
  }
  const version = await saveText(
    reference,
    p.sectionId,
    now,
    user,
    document,
    stale(),
    null,
    String(p._id),
  )
  await ReportTextProposalModel.updateOne(
    { _id: p._id, status: 'proposed' },
    {
      $set: {
        status: 'inserted',
        ...(into !== null && { subsection: into }),
        insertion: {
          version: version.version,
          previous: now.document,
          signature: documentSignature(document),
          at: version.savedAt,
          by: { id: user.id, name: user.name },
        },
      },
    },
  )
  return result(reference, p._id)
}

/**
 * Undo (AC2): restores the section's text from before the proposal was
 * inserted, as the section's next version, naming the version (or draft) it
 * restored, as a restore from the version history does (RV-06): a finding a
 * rewrite replaced comes back. Only while nothing in the section changed
 * since; after that, Delete takes the AI text out, or the version history
 * restores an earlier version.
 */
export async function undoProposal(
  reference: string,
  id: string,
  user: SessionUser,
): Promise<ApplyResult> {
  const { assessment, proposal: p } = await ownProposal(reference, id, user)
  if (p.status !== 'inserted' || !p.insertion)
    throw refuse(
      409,
      'state',
      'only text just inserted can be undone',
      'Use Delete on the AI text in the section instead.',
    )
  const changed = refuse(
    409,
    'stale',
    'the section changed after the text was inserted, so Undo would lose that change',
    'Delete the AI text in the section instead, or restore an earlier version from the version history.',
  )
  const now = await sectionNow(assessment._id, p.sectionId)
  if (now.version !== p.insertion.version || now.signature !== p.insertion.signature) throw changed
  const restoredFrom =
    p.base.version > 0 ? `version:${p.base.version}` : p.base.draft ? `draft:${p.base.draft}` : null
  await saveText(reference, p.sectionId, now, user, p.insertion.previous, changed, restoredFrom)
  await settle(p._id, 'undone', user)
  return result(reference, p._id)
}

async function settle(
  id: Types.ObjectId,
  action: 'accepted' | 'deleted' | 'undone',
  user: SessionUser,
) {
  await ReportTextProposalModel.updateOne(
    { _id: id },
    {
      $set: {
        status: action,
        settled: { action, at: new Date(), by: { id: user.id, name: user.name } },
      },
    },
  )
}

/**
 * Accept (keep the AI text as the engineer's own) or Delete (take it out) the
 * proposal's text in its section: the section's next version. Accept is
 * refused while a sentence of it is unsupported (AC3). The assigned engineer
 * decides, whoever asked for it (an assessment can be reassigned, RV-11).
 */
export async function settleProposal(
  reference: string,
  id: string,
  action: 'accept' | 'delete',
  user: SessionUser,
): Promise<ApplyResult> {
  const assessment = await assessmentToPropose(reference, user)
  const p = Types.ObjectId.isValid(id)
    ? await ReportTextProposalModel.findOne({
        _id: new Types.ObjectId(id),
        assessment: assessment._id,
        insertion: { $ne: null },
      }).lean<Kept>()
    : null
  if (!p) throw new ProposalNotFoundError()
  const now = await sectionNow(assessment._id, p.sectionId)
  if (!aiIdsIn(now.document).includes(String(p._id)))
    throw refuse(
      409,
      'state',
      'this AI-drafted text is no longer in the section',
      'Reload the review workspace.',
    )
  if (action === 'accept') {
    const unsupported = unsupportedAiText(
      now.document,
      new Map([[String(p._id), p.sentences.filter((s) => !s.supported).map((s) => s.text)]]),
    ).get(String(p._id))
    if (unsupported?.length)
      throw refuse(
        409,
        'unsupported',
        unsupported.length === 1
          ? 'a sentence of this text has no supporting source'
          : `${unsupported.length} sentences of this text have no supporting source`,
        'Give each a citation or delete it in the document editor, or delete the text, then accept it.',
      )
  }
  const clash = refuse(
    409,
    'stale',
    'the section was saved from somewhere else at the same moment',
    'Reload the review workspace and try again.',
  )
  await saveText(
    reference,
    p.sectionId,
    now,
    user,
    settleAiText(now.document, String(p._id), action === 'accept'),
    clash,
  )
  await settle(p._id, action === 'accept' ? 'accepted' : 'deleted', user)
  return result(reference, p._id)
}

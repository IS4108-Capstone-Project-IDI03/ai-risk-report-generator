// Asking questions about an assessment in the review workspace's Ask tab
// (AS-01). The gateway decides what S4 may search (AC3): the assessment's
// observations, the standards selected on it, read from knowledge_documents,
// and past reports on sites of its jurisdiction and facility type. S4 answers
// through its orchestrator and streams each checked statement; the gateway
// passes them on, then records the answer's paid calls and saves the question
// with its answer and trace (AC6). Called by routes/ask.routes.ts.
import { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import {
  AssessmentQuestionModel,
  type AssessmentQuestionDocument,
  type IAnswerStatement,
  type IAssessmentQuestion,
  type QuestionStatus,
} from '../models/assessment-question.model'
import type { ISite } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import { opensAssessment } from './assessment.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { addChatSpend, checkChatLimits, PER_DAY, PER_MINUTE } from './chat-limits.service'
import { selectedStandardIds } from './checklist.service'
import { CannotOpenAssessmentError } from './comment.service'
import {
  findKnowledgeDocuments,
  listApplicableStandards,
  listIngestedDocuments,
  type KnowledgeDocumentDto,
} from './knowledge-document.service'
import { locationText } from './location.service'
import { captureTimes, listObservations } from './observation.service'
import { privacyFor } from './privacy.service'
import { openAskStream, RagServiceError } from './rag.service'
import { toPassage, type FieldObservationDto, type SourcePassageDto } from './review.service'
import { handwritingOf, isUsable, transcriptsOf } from './section.service'

export const MAX_QUESTION_CHARS = 1000

export const questionSchema = z.object({
  question: z
    .string('Type a question to ask.')
    .trim()
    .min(1, 'Type a question to ask.')
    .max(MAX_QUESTION_CHARS, 'Keep the question to 1,000 characters.'),
})

// The chat's limits on questions a minute and a day (CB-01) count Ask's
// questions too, so one user's spend stays capped across both. Refused before
// any model is called (429), with the next step (AC8).
export class QuestionLimitError extends Error {
  constructor(
    readonly reason: string,
    readonly next: string,
  ) {
    super(reason)
    this.name = 'QuestionLimitError'
  }
}

const STANDARD_TYPES = new Set(['fm_standard', 'nfpa_standard', 'local_standard'])

// A document's name as the prompt shows it: "FM Global 2-81 (2026)" for a
// standard, else its title. As rag-service's app/chat/answer.py names them.
function documentName(d: KnowledgeDocumentDto): string {
  if (!d.standardNumber) return d.title
  const name = d.issuingBody ? `${d.issuingBody} ${d.standardNumber}` : d.standardNumber
  return d.edition ? `${name} (${d.edition})` : name
}

// Whether search can return a standard's passages: finished, not withdrawn and
// with no Unconfirmed details (KB-01, IN-05).
const searchable = (d: KnowledgeDocumentDto) =>
  d.status === 'complete' && !d.withdrawn && d.unconfirmed.length === 0

// An observation as S4's Ask request takes it: any of the assessment's with
// something recorded, categorised or not (null).
export type AskObservation = {
  id: string
  COPE_dimension: string[] | null
  note: string | null
  transcripts: string[]
  handwriting: string[]
  severity: string | null
  location: string | null
  standard: string | null
}

type OpenedAssessment = {
  _id: Types.ObjectId
  reference: string
  site: Pick<ISite, 'jurisdiction' | 'facilityType'>
}

// The assessment, for anyone who can open its report: its assigned engineer
// or a knowledge admin (as comments, RV-03). Archived ones can be asked about:
// asking changes nothing in the report.
async function openToAsk(reference: string, user: SessionUser): Promise<OpenedAssessment> {
  const assessment = await AssessmentModel.findOne({ reference }, 'reference engineer site')
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  if (!opensAssessment(user, assessment.engineer)) throw new CannotOpenAssessmentError()
  return { _id: assessment._id, reference: assessment.reference, site: assessment.site }
}

// What S4 may search for this assessment (AC3), and the names the prompt gives
// each document.
async function scopeOf(assessment: OpenedAssessment) {
  const { jurisdiction, facilityType } = assessment.site
  const [stored, selected, documents] = await Promise.all([
    listObservations(assessment.reference),
    selectedStandardIds(assessment._id),
    listIngestedDocuments(),
  ])
  // The latest checklist's standards (CP-30) are the ones selected on the
  // assessment; before any checklist, every standard that applies to the site.
  const chosen =
    selected ?? (await listApplicableStandards(facilityType, jurisdiction)).map((d) => d.id)
  // Built from knowledge_documents now, so a standard withdrawn since the
  // checklist was made is no longer searched.
  const wanted = new Set(chosen)
  const standards = documents.filter(
    (d) => wanted.has(d.id) && searchable(d) && STANDARD_TYPES.has(d.sourceType ?? ''),
  )
  const inScope = (value: string | null, site: string) => value === site || value === 'all'
  const reports = documents.filter(
    (d) =>
      d.sourceType === 'marsh_report' &&
      inScope(d.jurisdiction, jurisdiction) &&
      inScope(d.facilityType, facilityType),
  )
  const observations: AskObservation[] = stored
    .filter(isUsable)
    // Oldest first, in the order they were captured.
    .reverse()
    .map((o) => ({
      id: o.id,
      COPE_dimension: o.copeDimensions,
      note: o.note,
      transcripts: transcriptsOf(o),
      handwriting: handwritingOf(o),
      severity: o.severity ?? null,
      location: o.location && locationText(o.location),
      standard: o.standard,
    }))
  return { observations, standards, reports, fromChecklist: selected !== null }
}

// What the Ask tab says it searches, so the engineer knows the scope (AC3).
export type AskScopeDto = {
  observations: number
  standards: { id: string; name: string }[]
  // Whether the standards are the latest checklist's, or every one that applies.
  standardsFrom: 'checklist' | 'applicable'
  jurisdiction: string
  facilityType: string
  pastReports: number
}

// One question with its answer, as the Ask tab shows it.
export type AnswerDto = {
  id: string
  question: string
  askedAt: Date
  status: QuestionStatus
  statements: IAnswerStatement[]
  missing: string[]
  // The cited sources, with their documents' details now (as RV-01).
  passages: SourcePassageDto[]
  observations: FieldObservationDto[]
  confidence: IAssessmentQuestion['confidence']
  error: { step: string; cause: string; at: Date } | null
}

// A source S4 saved: a passage's text and Chroma labels, or an observation.
type SavedSource = Record<string, unknown>

// A chunk ID is `<document id>:<n>`, should a passage lack its `doc_id`.
function documentIdOf(ref: string, saved: SavedSource): string | null {
  if (typeof saved.doc_id === 'string') return saved.doc_id
  const chunk = ref.slice(2)
  return chunk.includes(':') ? chunk.slice(0, chunk.lastIndexOf(':')) : null
}

const text = (v: unknown) => (typeof v === 'string' ? v : null)
const texts = (v: unknown) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [])

function toObservation(saved: SavedSource, captured: Map<string, Date>): FieldObservationDto {
  const id = String(saved.id ?? '')
  return {
    id,
    copeDimensions: texts(saved.COPE_dimension),
    note: text(saved.note),
    transcripts: texts(saved.transcripts),
    handwriting: texts(saved.handwriting),
    severity: text(saved.severity) ?? '',
    location: text(saved.location),
    standard: text(saved.standard),
    capturedAt: captured.get(id) ?? null,
  }
}

// Sources S4 sent, as the evidence panel opens them: passages with their
// documents' details, and observations as they were sent.
function sourceDtos(
  sources: Record<string, unknown>,
  documents: Map<string, KnowledgeDocumentDto>,
  captured = new Map<string, Date>(),
) {
  const entries = Object.entries(sources) as [string, SavedSource][]
  return {
    passages: entries
      .filter(([ref]) => !ref.startsWith('O:'))
      .map(([ref, saved]) => toPassage(ref, saved, documents)),
    observations: entries
      .filter(([ref]) => ref.startsWith('O:'))
      .map(([, saved]) => toObservation(saved, captured)),
  }
}

// The saved questions with their sources resolved, in two queries for them all.
async function toDtos(questions: AssessmentQuestionDocument[]): Promise<AnswerDto[]> {
  const all = questions.flatMap((q) => Object.entries(q.sources ?? {})) as [string, SavedSource][]
  const documentIds = all.flatMap(([ref, s]) =>
    ref.startsWith('O:') ? [] : [documentIdOf(ref, s)],
  )
  const [documents, captured] = await Promise.all([
    findKnowledgeDocuments(documentIds.filter((id): id is string => !!id)),
    captureTimes(all.filter(([ref]) => ref.startsWith('O:')).map(([ref]) => ref.slice(2))),
  ])
  const byId = new Map(documents.map((d) => [d.id, d]))
  return questions.map((q) => ({
    id: String(q._id),
    question: q.question,
    askedAt: q.createdAt,
    status: q.status,
    statements: q.statements,
    missing: q.missing,
    ...sourceDtos(q.sources ?? {}, byId, captured),
    confidence: q.confidence,
    error: q.error,
  }))
}

// The questions this user asked about the assessment, oldest first, with the
// scope a new one is searched in. Only the asker reads their own.
export async function listQuestions(
  reference: string,
  user: SessionUser,
): Promise<{ scope: AskScopeDto; questions: AnswerDto[] }> {
  const assessment = await openToAsk(reference, user)
  const [scope, questions] = await Promise.all([
    scopeOf(assessment),
    AssessmentQuestionModel.find({
      assessment: assessment._id,
      userId: new Types.ObjectId(user.id),
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(100)
      .lean<AssessmentQuestionDocument[]>(),
  ])
  return {
    scope: scopeDto(assessment, scope),
    questions: await toDtos(questions),
  }
}

function scopeDto(
  assessment: OpenedAssessment,
  scope: Awaited<ReturnType<typeof scopeOf>>,
): AskScopeDto {
  return {
    observations: scope.observations.length,
    standards: scope.standards.map((d) => ({ id: d.id, name: documentName(d) })),
    standardsFrom: scope.fromChecklist ? 'checklist' : 'applicable',
    jurisdiction: assessment.site.jurisdiction,
    facilityType: assessment.site.facilityType,
    pastReports: scope.reports.length,
  }
}

// A question checked, within the limits, and saved, ready to be answered.
export type PreparedQuestion = {
  saved: AssessmentQuestionDocument
  assessment: OpenedAssessment
  userId: string
  body: object
  // The documents S4 may cite, by id, for each statement's sources as it streams.
  documents: Map<string, KnowledgeDocumentDto>
}

// Checks who may ask and the limits, then saves the question before S4 is
// asked, so it is kept even if the answer fails (as chat does, CB-03).
export async function prepareQuestion(
  reference: string,
  user: SessionUser,
  question: string,
): Promise<PreparedQuestion> {
  const assessment = await openToAsk(reference, user)
  const refused = checkChatLimits(user.id, [question])
  if (refused) {
    // The chat's replies speak as the chatbot; Ask states the cause instead (AC5).
    throw PER_MINUTE.includes(refused)
      ? new QuestionLimitError(
          'more than 10 questions were asked in a minute',
          'Ask again in a minute.',
        )
      : PER_DAY.includes(refused)
        ? new QuestionLimitError("today's question limit was reached", 'Ask again tomorrow.')
        : new QuestionLimitError('the question is too long', 'Shorten it and ask again.')
  }
  const scope = await scopeOf(assessment)
  const { jurisdiction, facilityType } = assessment.site
  const saved = (
    await AssessmentQuestionModel.create({
      assessment: assessment._id,
      userId: new Types.ObjectId(user.id),
      question,
      status: 'answering',
      metadata: {
        source_type: 'assessment_question',
        jurisdiction,
        facility_type: facilityType,
        COPE_dimension: 'all',
        effective_date: new Date(),
      },
    })
  ).toObject() as AssessmentQuestionDocument
  const body = {
    question,
    assessment: {
      reference: assessment.reference,
      jurisdiction,
      facility_type: facilityType,
    },
    observations: scope.observations,
    standard_ids: scope.standards.map((d) => d.id),
    documents: [...scope.standards, ...scope.reports].map((d) => ({
      id: d.id,
      name: documentName(d),
    })),
    // The gateway decides protection (PV-02), as for drafting.
    privacy: await privacyFor(assessment.reference),
  }
  const documents = new Map([...scope.standards, ...scope.reports].map((d) => [d.id, d]))
  return { saved, assessment, userId: user.id, body, documents }
}

// The events S4 streams for one answer (rag-service orchestrator.ask).
type AskEvent =
  | { type: 'step'; step: string; found?: unknown }
  | ({ type: 'statement'; sources?: Record<string, unknown> } & IAnswerStatement)
  | { type: 'missing'; text: string }
  | {
      type: 'result'
      value: {
        statements?: IAnswerStatement[]
        missing?: string[]
        sources?: Record<string, unknown>
        confidence?: IAssessmentQuestion['confidence']
        error?: { step: string; cause: string; at: string } | null
        usage?: unknown
        trace?: Record<string, unknown>
      }
    }

// Each complete server-sent event in `pending`, and what is left of it.
function splitEvents(pending: string): [AskEvent[], string] {
  const blocks = pending.split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: AskEvent[] = []
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    try {
      events.push(JSON.parse(data) as AskEvent)
    } catch {
      // Not an event this flow knows; nothing is passed on for it.
    }
  }
  return [events, rest]
}

const statusOf = (error: unknown, statements: number): QuestionStatus =>
  !error ? 'complete' : statements ? 'stopped' : 'failed'

/**
 * Streams the answer to a prepared question: `send` gets each event for the
 * browser, ending with `result` (the saved answer as AnswerDto). S4's usage
 * and trace are kept here: the paid calls are recorded for the report, and the
 * trace saved with the answer (AC6). One request per question, no polling, so
 * the idle sign-out (F-07) still applies.
 */
export async function answerQuestion(
  prepared: PreparedQuestion,
  signal: AbortSignal,
  send: (event: object) => void,
): Promise<void> {
  const { saved, assessment, userId } = prepared
  const statements: IAnswerStatement[] = []
  const missing: string[] = []
  // What was cited so far, kept should the stream end without its result.
  const streamed: Record<string, unknown> = {}
  let result: Extract<AskEvent, { type: 'result' }>['value'] | null = null
  let failure: { step: string; cause: string; at: Date } | null = null
  try {
    const stream = await openAskStream(prepared.body, signal)
    const decoder = new TextDecoder()
    let pending = ''
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true })
      const [events, rest] = splitEvents(pending)
      pending = rest
      for (const event of events) {
        if (event.type === 'result') {
          result = event.value
          continue
        }
        if (event.type === 'statement') {
          statements.push({ text: event.text, citations: event.citations })
          Object.assign(streamed, event.sources)
          // With its sources, so a citation opens while the answer is written (AC2).
          send({
            type: 'statement',
            text: event.text,
            citations: event.citations,
            ...sourceDtos(event.sources ?? {}, prepared.documents),
          })
        } else if (event.type === 'missing') {
          missing.push(event.text)
          send(event)
        } else if (event.type === 'step') {
          send({ type: 'step', step: event.step })
        }
      }
    }
    pending += decoder.decode()
    const [events] = splitEvents(pending + '\n\n')
    for (const event of events) if (event.type === 'result') result = event.value
  } catch (error) {
    const at = new Date()
    if (signal.aborted) {
      failure = { step: 'generate', cause: 'the answer was stopped before it finished', at }
    } else if (error instanceof RagServiceError) {
      failure = { step: 'retrieve', cause: error.message, at }
    } else {
      console.error('Assessment question failed:', error)
      failure = { step: 'generate', cause: 'the answer service stopped responding', at }
    }
  }
  if (!result && !failure) {
    const cause = 'the answer service stopped before it finished'
    failure = { step: 'generate', cause, at: new Date() }
  }
  if (result) {
    // Billed whatever happens to the save below, so recorded first (EV-03).
    await recordAiCalls(result.usage, { reportId: assessment.reference })
    addChatSpend(userId, result.usage)
  }
  const error = result?.error ? { ...result.error, at: new Date(result.error.at) } : failure
  const kept = result?.statements ?? statements
  const update = {
    status: statusOf(error, kept.length),
    statements: kept,
    missing: result?.missing ?? missing,
    sources: result?.sources ?? streamed,
    confidence: result?.confidence ?? null,
    error,
    trace: result?.trace ?? null,
  }
  const stored = await AssessmentQuestionModel.findByIdAndUpdate(saved._id, update, {
    returnDocument: 'after',
  })
    .lean<AssessmentQuestionDocument>()
    .catch((problem: unknown) => {
      console.error('Could not save the answer to a question:', problem)
      return null
    })
  if (signal.aborted) return
  const [answer] = await toDtos([stored ?? { ...saved, ...update }])
  send({ type: 'result', answer })
}

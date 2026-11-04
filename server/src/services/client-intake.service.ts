// Client intake (CP-23): the documents an engineer adds to start a new
// assessment, read into a proposed client, sites and assessments. Called by
// routes/client-intake.routes.ts. Calls storage.service.ts (S3), converter
// (legacy .doc to PDF), ingestion (/extract-text), privacy and rag-service
// (/client-intakes/read). Create is in client-intake-create.service.ts.
import { createHash } from 'crypto'
import { buffer } from 'stream/consumers'
import { isValidObjectId, Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { ClientIntakeModel, type IClientIntake } from '../models/client-intake.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import type { SessionUser } from './auth.service'
import { ConverterUnavailableError, toPdf } from './converter.service'
import { extractText } from './ingestion.service'
import { defineQueue } from './job-queue.service'
import {
  FACILITY_TYPES,
  isOleWith,
  isZipWith,
  JURISDICTIONS,
  PDF_MARKER,
} from './knowledge-document.service'
import { chatPrivacy } from './privacy.service'
import { readClientIntake, type ClientIntakeReadBody } from './rag.service'
import { hyphenated } from './speech.service'
import * as storage from './storage.service'

// An intake and its files are deleted a day after it starts (AC13).
const KEPT_FOR_MS = 24 * 3_600_000
// Pasted email text is a document too; this is far more than one email.
export const PASTED_TEXT_LIMIT = 200_000
// The id and name pasted text is sent to rag-service under.
const PASTED = { id: 'pasted-text', name: 'Pasted text' }

// A refused request, with the status the routes answer: 404 unknown or
// another engineer's, 409 in the wrong state, 422 nothing could be read.
export class IntakeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422,
    readonly files?: FileDto[],
  ) {
    super(message)
    this.name = 'IntakeError'
  }
}

// An email saved as .eml is plain text: header lines first ("From: ..."),
// so it is told by a header at its start and a From or Subject among them.
function looksLikeEmail(file: Buffer) {
  const head = file.subarray(0, 16_384).toString('latin1')
  return !head.includes('\0') && /^[!-9;-~]+:/.test(head) && /^(from|subject):/im.test(head)
}

// The files an intake takes (AC1), each recognised by its extension and its
// bytes together, since either alone is only a claim.
const INTAKE_TYPES = [
  {
    ext: 'pdf',
    contentType: 'application/pdf',
    matches: (f: Buffer) => f.subarray(0, 5).equals(PDF_MARKER),
  },
  {
    ext: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matches: (f: Buffer) => isZipWith(f, 'word/'),
  },
  {
    ext: 'doc',
    contentType: 'application/msword',
    matches: (f: Buffer) => isOleWith(f, 'WordDocument'),
  },
  // An Outlook message is an OLE container; every one has this stream.
  {
    ext: 'msg',
    contentType: 'application/vnd.ms-outlook',
    matches: (f: Buffer) => isOleWith(f, '__properties_version1.0'),
  },
  { ext: 'eml', contentType: 'message/rfc822', matches: looksLikeEmail },
]

/**
 * Returns the accepted type of a file by its name and bytes, or the reason it
 * is refused. Shared with uploads on the client page (CP-23 AC15).
 */
export function checkDocument(
  name: string,
  bytes: Buffer,
): { type: (typeof INTAKE_TYPES)[number] } | { reason: string } {
  const ext = name.split('.').pop()!.toLowerCase()
  const type = bytes.length && INTAKE_TYPES.find((t) => t.ext === ext && t.matches(bytes))
  if (type) return { type }
  if (!bytes.length) return { reason: `${name} is empty.` }
  // An accepted extension whose bytes don't match is a damaged file (CP-23 board R7 · 4);
  // any other extension is a type we don't read. The UI shows the file name beside the reason.
  if (INTAKE_TYPES.some((t) => t.ext === ext))
    return {
      reason: `File is damaged. Save it again as ${ext === 'pdf' ? 'a PDF' : 'a new file'} and add it.`,
    }
  return {
    reason: `Can't read ${name.includes('.') ? `.${ext}` : 'this kind of'} files. Add PDF, Word (.docx, .doc), Outlook (.msg) or .eml files.`,
  }
}

export type FileDto = {
  id: string | null
  name: string
  size: number
  status: 'accepted' | 'refused' | 'read' | 'failed'
  reason: string | null
}
const fileDto = (f: IClientIntake['files'][number]): FileDto => ({
  id: String(f._id),
  name: f.name,
  size: f.size,
  status: f.status,
  reason: f.reason,
})

/**
 * Keeps the files an intake takes in S3 and starts the intake (AC1, AC4).
 * Returns its id and every file, kept or refused with the reason. Throws
 * IntakeError (400) when nothing was kept and no text was pasted.
 */
export async function startIntake(
  files: { name: string; bytes: Buffer }[],
  pastedText: string | undefined,
  user: SessionUser,
): Promise<{ id: string; files: FileDto[] }> {
  const id = new Types.ObjectId()
  const answered: FileDto[] = []
  const kept: IClientIntake['files'] = []
  const bytesOf = new Map<string, Buffer>()
  // a. Check each file's type by its bytes.
  for (const { name, bytes } of files) {
    const checked = checkDocument(name, bytes)
    if ('reason' in checked) {
      answered.push({
        id: null,
        name,
        size: bytes.length,
        status: 'refused',
        reason: checked.reason,
      })
      continue
    }
    const { type } = checked
    const fileId = new Types.ObjectId()
    const file = {
      _id: fileId,
      name,
      contentType: type.contentType,
      ext: type.ext,
      size: bytes.length,
      // sha256 is a fingerprint: equal fingerprints mean equal files.
      sha256: createHash('sha256').update(bytes).digest('hex'),
      key: `client-intakes/${id}/${fileId}.${type.ext}`,
      status: 'accepted' as const,
      reason: null,
    }
    kept.push(file)
    bytesOf.set(file.key, bytes)
    answered.push(fileDto(file))
  }
  if (!kept.length && !pastedText)
    throw new IntakeError('Add a PDF, Word or email file, or paste the email text.', 400, answered)

  // b. Store them, then c. record the intake. Without the undo, a failed
  // upload would leave files no intake points at, which cleanup never finds.
  try {
    for (const file of kept)
      await storage.putObject(file.key, bytesOf.get(file.key)!, file.contentType)
    const now = new Date()
    await ClientIntakeModel.create({
      _id: id,
      engineer: user.id,
      files: kept,
      pastedText,
      status: 'uploaded',
      expiresAt: new Date(now.getTime() + KEPT_FOR_MS),
      metadata: {
        source_type: 'client_intake',
        jurisdiction: null,
        facility_type: null,
        COPE_dimension: null,
        effective_date: now,
      },
    })
  } catch (error) {
    await Promise.all(kept.map((f) => storage.deleteObject(f.key).catch(() => undefined)))
    throw error
  }
  return { id: String(id), files: answered }
}

/** Returns the engineer's own intake; IntakeError 404 for an unknown or another's. */
export async function ownIntake(id: string, user: SessionUser) {
  const intake = isValidObjectId(id)
    ? await ClientIntakeModel.findOne({ _id: id, engineer: user.id }).lean<
        IClientIntake & { _id: Types.ObjectId }
      >()
    : null
  if (!intake) throw new IntakeError('This intake was not found. Add the documents again.', 404)
  return intake
}

export type ReadDto = {
  id: string
  status: 'ready'
  files: FileDto[]
  // The documents whose text was read: each file, its email's attachments and
  // pasted text, named, so a value's source can say where its words are.
  sources: IClientIntake['sources']
  result: unknown
}
const readDto = (intake: IClientIntake & { _id: Types.ObjectId }): ReadDto => ({
  id: String(intake._id),
  status: 'ready',
  // Each file, then its email's attachments that couldn't be read, as failed
  // files with no id (nothing to keep), so the reading screen lists them.
  files: intake.files.flatMap((f) => [
    fileDto(f),
    ...(intake.failedAttachments ?? [])
      .filter((a) => a.fileId === String(f._id))
      .map(({ name, size, reason }) => ({
        id: null,
        name,
        size,
        status: 'failed' as const,
        reason,
      })),
  ]),
  sources: intake.sources,
  result: intake.result,
})

type Doc = { id: string; name: string; text: string; fileId: string | null }
type Read = { docs: Doc[]; failed: IClientIntake['failedAttachments'] }

// One file's text, as one or more documents (the file, then its email's
// attachments) and the attachments that couldn't be read, or the reason the
// file can't be read. A legacy .doc goes through the converter first, as
// ingestion reads PDFs, not Word 97 files.
async function textOf(file: IClientIntake['files'][number]): Promise<Read | string> {
  let bytes: Buffer = await buffer(await storage.getObjectStream(file.key))
  let name = file.name
  if (file.ext === 'doc') {
    let pdf: Buffer | null
    try {
      pdf = await toPdf(bytes, 'doc')
    } catch (error) {
      if (error instanceof ConverterUnavailableError) return `${file.name}: ${error.message}`
      throw error
    }
    if (!pdf) return `${file.name} could not be opened. Save it as PDF or .docx and add it again.`
    bytes = pdf
    name = file.name.replace(/\.doc$/i, '') + '.pdf'
  }
  const answer = await extractText(bytes, name)
  if ('reason' in answer) return answer.reason
  const fileId = String(file._id)
  // The file keeps its own name; attachments are named by ingestion.
  return {
    docs: answer.documents.map((d, i) => ({
      id: i ? `${fileId}-${i}` : fileId,
      name: i ? d.name : file.name,
      text: d.text,
      fileId,
    })),
    failed: (answer.failed ?? []).map((a) => ({ ...a, fileId })),
  }
}

// Every recorded client with its listed sites, for rag-service to match the
// documents' client and sites against (AC7), in code after unmasking.
async function recordedClients(): Promise<ClientIntakeReadBody['clients']> {
  const [clients, sites, visited] = await Promise.all([
    ClientModel.find({}, 'name division').lean(),
    SiteModel.find(
      { client: { $exists: true }, removed: { $exists: false } },
      'name address client',
    ).lean(),
    AssessmentModel.distinct('site'),
  ])
  const hasAssessments = new Set(visited.map(String))
  return clients.map((c) => ({
    id: String(c._id),
    name: c.name,
    division: c.division ?? null,
    sites: sites
      .filter((s) => c._id.equals(s.client))
      .map((s) => ({
        id: String(s._id),
        name: s.name,
        address: s.address ?? null,
        has_assessments: hasAssessments.has(String(s._id)),
      })),
  }))
}

// The proposal's document placements, by file: an email's attachments are
// kept with their email, and pasted text is not a file to keep.
function placementsByFile(result: Record<string, unknown>, fileIds: Set<string>) {
  const documents = (result.documents ?? []) as { id: string }[]
  return documents
    .filter((d) => fileIds.has(d.id))
    .map(({ id, ...rest }) => ({ fileId: id, ...rest }))
}

// A read stuck longer than this (gateway restarted mid-read) can be claimed again.
const READ_STALE_MS = 10 * 60_000

/**
 * Reads the intake's documents into a proposed client, sites and assessments
 * (AC2-AC9), in steps a-d, and saves it on the intake. Returns the files with
 * whether each was read, the documents read and the proposal; a repeat
 * returns the saved one. A file that can't be opened is marked failed with the
 * reason and the rest are still read (AC4). Throws RagServiceError (503 when
 * masking is unavailable, AC22), IntakeError, or IngestionUnavailableError.
 */
export async function readIntake(id: string, user: SessionUser): Promise<ReadDto> {
  const owned = await ownIntake(id, user)
  // a. Claim it, so two taps read it once. One stuck reading for ten minutes
  // (the gateway restarted mid-read) can be read again.
  const intake = await ClientIntakeModel.findOneAndUpdate(
    {
      _id: owned._id,
      $or: [
        { status: { $in: ['uploaded', 'failed'] } },
        { status: 'reading', updatedAt: { $lt: new Date(Date.now() - READ_STALE_MS) } },
      ],
    },
    { status: 'reading' },
    { returnDocument: 'after' },
  ).lean<IClientIntake & { _id: Types.ObjectId }>()
  if (!intake) {
    if (owned.status === 'ready') return readDto(owned)
    throw new IntakeError(
      owned.status === 'created' || owned.status === 'creating'
        ? 'These documents were already used to create assessments.'
        : 'These documents are already being read.',
      409,
    )
  }

  try {
    // b. Each file's text.
    const docs: Doc[] = []
    const failedAttachments: IClientIntake['failedAttachments'] = []
    const files = []
    for (const file of intake.files) {
      const text = await textOf(file)
      if (typeof text === 'string') files.push({ ...file, status: 'failed' as const, reason: text })
      else {
        docs.push(...text.docs)
        failedAttachments.push(...text.failed)
        files.push({ ...file, status: 'read' as const, reason: null })
      }
    }
    if (intake.pastedText) docs.push({ ...PASTED, text: intake.pastedText, fileId: null })
    await ClientIntakeModel.updateOne({ _id: intake._id }, { files })
    if (!docs.length)
      throw new IntakeError('None of the documents could be read.', 422, files.map(fileDto))

    // c. The proposal. Client and site names are masked too (AC21), even a
    // client not yet recorded, so privacy-service is asked to find them.
    const privacy = await chatPrivacy()
    const { result, usage } = await readClientIntake({
      documents: docs.map(({ id: docId, name, text }) => ({ id: docId, name, text })),
      clients: await recordedClients(),
      facility_types: FACILITY_TYPES,
      jurisdictions: JURISDICTIONS,
      privacy: privacy.enabled ? { ...privacy, detect: ['CLIENT', 'SITE'] } : privacy,
    })
    await recordAiCalls(hyphenated(usage), { userId: user.id })

    // d. Save it.
    const saved = await ClientIntakeModel.findOneAndUpdate(
      { _id: intake._id },
      {
        status: 'ready',
        result: {
          ...result,
          documents: placementsByFile(result, new Set(intake.files.map((f) => String(f._id)))),
        },
        sources: docs.map((d) => ({ documentId: d.id, name: d.name, fileId: d.fileId })),
        failedAttachments,
      },
      { returnDocument: 'after' },
    ).lean<IClientIntake & { _id: Types.ObjectId }>()
    // Discarded while it was read; without this, the reply would crash (500).
    if (!saved) throw new IntakeError('This intake was discarded.', 404)
    return readDto(saved)
  } catch (error) {
    // Readable again; without this it would stay `reading` until the window ends.
    // Guarded: a stale read finishing late must not fail an intake a newer read
    // or Create now owns.
    await ClientIntakeModel.updateOne({ _id: intake._id, status: 'reading' }, { status: 'failed' })
    throw error
  }
}

/**
 * Deletes the intake's files in S3; returns nothing. One that fails is logged
 * and left: an orphan copy costs a little storage, failing would keep the intake.
 */
export async function deleteIntakeFiles(intake: Pick<IClientIntake, 'files'>) {
  await Promise.all(
    intake.files.map((f) =>
      storage.deleteObject(f.key).catch((error: unknown) => {
        console.error(`Could not delete ${f.key}:`, error)
      }),
    ),
  )
}

/** Discards the engineer's intake and its files (AC13); 409 once Create has claimed it. */
export async function discardIntake(id: string, user: SessionUser): Promise<void> {
  const owned = await ownIntake(id, user)
  // Deleted in the same step as the status check: without this, a Create
  // claiming it in between would find its files gone while copying them.
  const intake = await ClientIntakeModel.findOneAndDelete({
    _id: owned._id,
    status: { $nin: ['created', 'creating'] },
  }).lean()
  if (!intake)
    throw new IntakeError(
      owned.status === 'created'
        ? 'These documents were already used to create assessments.'
        : 'These documents are being used to create assessments.',
      409,
    )
  await deleteIntakeFiles(intake)
}

/** Deletes every intake past its 24 hours and its files (AC13). Returns how many. */
export async function cleanupExpiredIntakes(now: Date): Promise<number> {
  // Not one being read or created: its files are in use right now.
  const expired = await ClientIntakeModel.find({
    expiresAt: { $lt: now },
    status: { $nin: ['creating', 'reading'] },
  }).lean()
  for (const intake of expired) {
    // Created ones' files are gone already; deleting again is harmless.
    await deleteIntakeFiles(intake)
    await ClientIntakeModel.deleteOne({ _id: intake._id })
  }
  return expired.length
}

// The daily cleanup, run by BullMQ in this process (job-queue.service.ts).
const cleanupQueue = defineQueue<{ kind: 'cleanup' }>(
  'client-intake-cleanup',
  { concurrency: 1, attempts: 3, backoffMs: 60_000 },
  async () => {
    const deleted = await cleanupExpiredIntakes(new Date())
    if (deleted) console.log(`Deleted ${deleted} expired client intake(s).`)
  },
)

/** Schedules the cleanup daily at 03:00 UTC. Called once the gateway boots. */
export const scheduleIntakeCleanup = () =>
  cleanupQueue.schedule('client-intake-cleanup-daily', '0 3 * * *', { kind: 'cleanup' })

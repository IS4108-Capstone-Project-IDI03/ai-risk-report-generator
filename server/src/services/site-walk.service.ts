// Site walk lifecycle (CP-22): start a walk, take its recordings, photos and
// typed text, finish it, retry it, discard it, and transcribe its recordings.
// Called by routes/site-walk.routes.ts. Calls storage.service.ts (S3),
// speech.service.ts (S5) and, once every recording is transcribed, queues the
// proposal step (site-walk-proposal.service.ts).
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import {
  SiteWalkModel,
  type ISiteWalk,
  type IWalkMedia,
  type IWalkPhoto,
  type IWalkRecording,
  type Proposal,
  type RecordingTranscription,
  type WalkStatus,
} from '../models/site-walk.model'
import type { ISite } from '../models/site.model'
import type { SessionUser } from './auth.service'
import { NotAssignedError } from './assessment.service'
import { onTranscriptionJob, proposalQueue, transcriptionQueue } from './background-queues.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { retryJobId, type JobContext } from './job-queue.service'
import { isDuplicateKeyError } from './mongo-errors'
import { audioExtension, photoFormat } from './observation.service'
import {
  SpeechServiceError,
  transcribeWithSegments,
  transcriptionFailureReason,
} from './speech.service'
import * as storage from './storage.service'

// The walk does not exist on this assessment (404).
export class SiteWalkNotFoundError extends Error {
  constructor() {
    super('The site walk was not found.')
    this.name = 'SiteWalkNotFoundError'
  }
}
// The walk isn't in the state the change needs, e.g. adding to a finished walk.
export class SiteWalkStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteWalkStateError'
  }
}
// The request is wrong whatever the walk's state (400).
export class InvalidSiteWalkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSiteWalkError'
  }
}

export type SiteWalkDto = {
  id: string
  status: WalkStatus
  // The engineer's name for the walk; null on walks made before round 3.
  name: string | null
  createdAt: string
  recordings: {
    seq: number
    durationSec: number
    transcription: RecordingTranscription
    // The text once transcribed, else null.
    transcript: string | null
    audioUrl: string
  }[]
  notes: { seq: number; text: string }[]
  photos: { id: string; url: string; recordingSeq: number | null; offsetSec: number | null }[]
  // Added to the proposal by hand; a voice clip's transcription and text, else null.
  media: {
    id: string
    kind: IWalkMedia['kind']
    url: string
    transcription: RecordingTranscription | null
    transcript: string | null
  }[]
  typedText: string | null
  proposal: Proposal | null
  error: string | null
}

export type StoredWalk = ISiteWalk & { _id: Types.ObjectId }

// The walk as the client reads it. Recordings and notes are listed by seq.
export function toSiteWalkDto(reference: string, walk: StoredWalk): SiteWalkDto {
  return {
    id: String(walk._id),
    status: walk.status,
    name: walk.name ?? null,
    createdAt: walk.createdAt.toISOString(),
    recordings: [...walk.recordings]
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({
        seq: r.seq,
        durationSec: r.durationSec,
        transcription: r.transcription.status,
        transcript: r.transcription.status === 'transcribed' ? (r.transcription.text ?? '') : null,
        audioUrl: `/api/assessments/${reference}/site-walks/${walk._id}/recordings/${r.seq}`,
      })),
    notes: [...(walk.notes ?? [])].sort((a, b) => a.seq - b.seq).map((n) => ({ ...n })),
    photos: walk.photos.map((p) => ({
      id: p.photoId,
      url: `/api/assessments/${reference}/site-walks/${walk._id}/photos/${p.photoId}`,
      recordingSeq: p.recordingSeq,
      offsetSec: p.offsetSec,
    })),
    media: (walk.media ?? []).map((m) => ({
      id: m.mediaId,
      kind: m.kind,
      url: `/api/assessments/${reference}/site-walks/${walk._id}/media/${m.mediaId}`,
      transcription: m.transcription?.status ?? null,
      transcript: m.transcription?.status === 'transcribed' ? (m.transcription.text ?? '') : null,
    })),
    typedText: walk.typedText,
    proposal: walk.proposal,
    error: walk.error ?? null,
  }
}

type LoadedAssessment = {
  _id: Types.ObjectId
  reference: string
  engineer?: Types.ObjectId
  archivedAt?: Date
  locations: ILocation[]
  site: ISite | null
}

async function loadAssessment(reference: string): Promise<LoadedAssessment> {
  const assessment = await AssessmentModel.findOne(
    { reference },
    'reference engineer archivedAt locations site',
  )
    .populate<{ site: ISite | null }>('site')
    .lean<LoadedAssessment>()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return { ...assessment, locations: assessment.locations ?? [] }
}

// The walk with its assessment. A change needs the walk's own engineer and an
// assessment that is not archived; a read needs neither.
export async function loadWalk(
  reference: string,
  walkId: string,
  user: SessionUser,
  forChange: boolean,
) {
  const assessment = await loadAssessment(reference)
  const walk = isValidObjectId(walkId)
    ? await SiteWalkModel.findOne({ _id: walkId, assessment: assessment._id }).lean<StoredWalk>()
    : null
  if (!walk) throw new SiteWalkNotFoundError()
  if (forChange) {
    if (String(walk.engineerId) !== user.id)
      throw new NotAssignedError('Only the engineer who started this site walk can change it.')
    // Without this, an engineer the assessment was reassigned away from could still change the walk.
    if (String(assessment.engineer) !== user.id)
      throw new NotAssignedError(
        'Only the engineer assigned to this assessment can change this site walk.',
      )
    if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  }
  return { assessment, walk }
}

const dto = async (reference: string, walkId: Types.ObjectId | string) =>
  toSiteWalkDto(reference, (await SiteWalkModel.findById(walkId).lean<StoredWalk>())!)

// Starts a walk, or returns this engineer's walk still being recorded, so a
// second device or a reload carries on with the same one. Only the assessment's
// assigned engineer, like its locations and observations.
export async function startWalk(reference: string, user: SessionUser) {
  const assessment = await loadAssessment(reference)
  if (String(assessment.engineer) !== user.id)
    throw new NotAssignedError(
      'Only the engineer assigned to this assessment can record a site walk.',
    )
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  const mine = { assessment: assessment._id, engineerId: user.id, status: 'recording' as const }
  const reuse = async () => SiteWalkModel.findOne(mine).lean<StoredWalk>()
  const existing = await reuse()
  if (existing) return { created: false, walk: toSiteWalkDto(reference, existing) }
  try {
    const walk = await SiteWalkModel.create({
      ...mine,
      metadata: {
        source_type: 'site_walk',
        jurisdiction: assessment.site?.jurisdiction ?? 'unknown',
        facility_type: assessment.site?.facilityType ?? 'unknown',
        COPE_dimension: null,
        effective_date: new Date(),
      },
    })
    return { created: true, walk: toSiteWalkDto(reference, walk.toObject() as StoredWalk) }
  } catch (error) {
    // Another tap started it first (the unique index on a walk being recorded).
    if (!isDuplicateKeyError(error)) throw error
    return { created: false, walk: toSiteWalkDto(reference, (await reuse())!) }
  }
}

// The caller's own walks on this assessment, newest first, created ones too
// (the list folds those away). Returns the walks as the client reads them.
export async function listWalks(reference: string, user: SessionUser): Promise<SiteWalkDto[]> {
  const assessment = await loadAssessment(reference)
  const walks = await SiteWalkModel.find({
    assessment: assessment._id,
    engineerId: user.id,
  })
    .sort({ createdAt: -1 })
    .lean<StoredWalk[]>()
  return walks.map((w) => toSiteWalkDto(reference, w))
}

// One walk as the client reads it; any engineer may read it.
export async function getWalk(reference: string, walkId: string, user: SessionUser) {
  const { walk } = await loadWalk(reference, walkId, user, false)
  return toSiteWalkDto(reference, walk)
}

const WHILE_RECORDING = 'This site walk is no longer being recorded.'
const SEQ_TAKEN_BY_NOTE = 'A typed note already has that number in this site walk.'
const SEQ_TAKEN_BY_RECORDING = 'A recording already has that number in this site walk.'

// Parses a recording upload's seq and duration into numbers.
export const recordingFieldsSchema = z.object({
  seq: z.coerce.number().int().min(1).max(999),
  durationSec: z.string().min(1).transform(Number).pipe(z.number().min(0).max(3600)),
})
// Parses a photo upload's id and where in the walk it was taken.
export const photoFieldsSchema = z.object({
  photoId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'The photo id must be a UUID.'),
  recordingSeq: z.preprocess(
    (v) => (v === '' ? null : v),
    z.coerce.number().int().min(1).max(999).nullable(),
  ),
  offsetSec: z.preprocess(
    (v) => (v === '' ? null : v),
    z.coerce.number().min(0).max(100_000).nullable(),
  ),
})

const jobIdOf = (walkId: string | Types.ObjectId, seq: number) => `sw-${walkId}-${seq}`

const NOT_QUEUED = 'The recording could not be queued for transcription.'

// Queues one recording's transcription. If the queue is down, the recording is
// marked failed (and the walk too, once finished) so Retry works; without this
// the walk would wait on a job that does not exist. A retry gets a fresh job id
// (see retryJobId).
async function queueTranscription(walkId: string | Types.ObjectId, seq: number, retry = false) {
  try {
    const jobId = jobIdOf(walkId, seq)
    await transcriptionQueue.add(retry ? retryJobId(jobId) : jobId, {
      kind: 'site-walk',
      walkId: String(walkId),
      seq,
    })
  } catch (error) {
    console.error('Queueing transcription failed:', error)
    await SiteWalkModel.updateOne(
      { _id: walkId, 'recordings.seq': seq },
      {
        $set: {
          'recordings.$.transcription.status': 'failed',
          'recordings.$.transcription.error': NOT_QUEUED,
        },
      },
    )
    await SiteWalkModel.updateOne(
      { _id: walkId, status: 'transcribing' },
      { status: 'failed', error: FAILED_RECORDING(seq, NOT_QUEUED) },
    )
  }
}

// Stores one recording and queues its transcription. Repeating a (walk, seq)
// returns the walk unchanged, so the phone can resend until the server answers;
// it also re-queues a recording still waiting, in case the queue was down the
// first time. Without the atomic push, two resends could add the same seq twice.
export async function addRecording(
  reference: string,
  walkId: string,
  seq: number,
  file: { audio: Buffer; contentType: string },
  durationSec: number,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  const existing = walk.recordings.find((r) => r.seq === seq)
  if (existing) {
    if (existing.transcription.status === 'queued') await queueTranscription(walk._id, seq)
    return toSiteWalkDto(reference, walk)
  }
  if (walk.status !== 'recording') throw new SiteWalkStateError(WHILE_RECORDING)
  if (walk.notes?.some((n) => n.seq === seq)) throw new SiteWalkStateError(SEQ_TAKEN_BY_NOTE)
  const recording: IWalkRecording = {
    seq,
    key: `audio/${reference}/site-walks/${walk._id}/${seq}.${audioExtension(file.contentType)}`,
    contentType: file.contentType,
    size: file.audio.length,
    durationSec,
    transcription: { status: 'queued', segments: [] },
  }
  await storage.putObject(recording.key, file.audio, file.contentType)
  const pushed = await SiteWalkModel.updateOne(
    {
      _id: walk._id,
      status: 'recording',
      'recordings.seq': { $ne: seq },
      'notes.seq': { $ne: seq },
    },
    { $push: { recordings: recording } },
  )
  // Nothing pushed: a resend stored it first (fine), or the walk was finished
  // or a note took the seq meanwhile. Then 409, so the phone keeps its only copy
  // instead of deleting it; the stored copy goes, as nothing points at it.
  if (!pushed.modifiedCount) {
    const now = await SiteWalkModel.findById(
      walk._id,
      'recordings.seq notes.seq',
    ).lean<StoredWalk>()
    if (!now?.recordings.some((r) => r.seq === seq)) {
      await storage.deleteObject(recording.key).catch(() => undefined)
      throw new SiteWalkStateError(
        now?.notes?.some((n) => n.seq === seq) ? SEQ_TAKEN_BY_NOTE : WHILE_RECORDING,
      )
    }
  }
  await queueTranscription(walk._id, seq)
  return dto(reference, walk._id)
}

// Stores one photo taken during the walk, once per client photo id.
export async function addPhoto(
  reference: string,
  walkId: string,
  fields: z.infer<typeof photoFieldsSchema>,
  image: Buffer,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  if (walk.photos.some((p) => p.photoId === fields.photoId)) return toSiteWalkDto(reference, walk)
  if (walk.status !== 'recording') throw new SiteWalkStateError(WHILE_RECORDING)
  const format = photoFormat(image)!
  const photo: IWalkPhoto = {
    photoId: fields.photoId,
    key: `photos/${reference}/site-walks/${walk._id}/${fields.photoId}.${format.extension}`,
    contentType: format.contentType,
    size: image.length,
    recordingSeq: fields.recordingSeq,
    offsetSec: fields.offsetSec,
  }
  await storage.putObject(photo.key, image, photo.contentType)
  const pushed = await SiteWalkModel.updateOne(
    { _id: walk._id, status: 'recording', 'photos.photoId': { $ne: fields.photoId } },
    { $push: { photos: photo } },
  )
  // Nothing pushed: a resend stored it first (fine), or the walk was finished
  // meanwhile. Then the stored copy goes and 409, so the phone isn't told it saved.
  if (!pushed.modifiedCount) {
    const now = await SiteWalkModel.findById(walk._id, 'photos.photoId').lean<StoredWalk>()
    if (!now?.photos.some((p) => p.photoId === fields.photoId)) {
      await storage.deleteObject(photo.key).catch(() => undefined)
      throw new SiteWalkStateError(WHILE_RECORDING)
    }
  }
  return dto(reference, walk._id)
}

// Parses the typed walk's body into its text.
export const typedTextSchema = z.object({
  text: z
    .string('Send the text of the walk.')
    .max(40_000, 'The walk must be 40,000 characters or fewer.'),
})

// Parses a note's seq and text. Blank text removes the note.
export const noteFieldsSchema = z.object({
  seq: z.coerce.number().int().min(1).max(999),
  text: z
    .string('Send the text of the note.')
    .max(40_000, 'A note must be 40,000 characters or fewer.'),
})

// Saves one typed note, replacing the note with that seq; blank text removes it.
// A recording and a note never share a seq. Each write matches on the status and
// on the seq being free, so a Finish or an upload landing meanwhile is refused;
// without this a note could slip into a walk whose proposal was already read.
export async function setNote(
  reference: string,
  walkId: string,
  fields: z.infer<typeof noteFieldsSchema>,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  if (walk.status !== 'recording') throw new SiteWalkStateError(WHILE_RECORDING)
  if (walk.recordings.some((r) => r.seq === fields.seq))
    throw new SiteWalkStateError(SEQ_TAKEN_BY_RECORDING)
  const { seq } = fields
  const text = fields.text.trim()
  const open = { _id: walk._id, status: 'recording' as const, 'recordings.seq': { $ne: seq } }
  const saved = !text
    ? await SiteWalkModel.updateOne(open, { $pull: { notes: { seq } } })
    : (
          await SiteWalkModel.updateOne(
            { ...open, 'notes.seq': seq },
            { $set: { 'notes.$.text': text } },
          )
        ).matchedCount
      ? { matchedCount: 1 }
      : await SiteWalkModel.updateOne(open, { $push: { notes: { seq, text } } })
  if (!saved.matchedCount) {
    const now = await SiteWalkModel.findById(walk._id, 'status recordings.seq').lean<StoredWalk>()
    throw new SiteWalkStateError(
      now?.status === 'recording' ? SEQ_TAKEN_BY_RECORDING : WHILE_RECORDING,
    )
  }
  return dto(reference, walk._id)
}

// Saves the typed walk, replacing what was saved before. Blank clears it.
export async function setText(reference: string, walkId: string, text: string, user: SessionUser) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  if (walk.status !== 'recording') throw new SiteWalkStateError(WHILE_RECORDING)
  // Matching on the status refuses a save that lands after Finish; without it the
  // text would change on a walk whose proposal was made from the old text.
  const saved = await SiteWalkModel.updateOne(
    { _id: walk._id, status: 'recording' },
    { typedText: text.trim() || null },
  )
  if (!saved.matchedCount) throw new SiteWalkStateError(WHILE_RECORDING)
  return dto(reference, walk._id)
}

// Parses the walk's name, asked for at Finish walk and on rename.
export const walkNameSchema = z.object({
  name: z.string('Name the site walk.').trim().min(1, 'Name the site walk.').max(80),
})

// Ends the recording and saves its name. Goes to `transcribing` while any recording is still
// being transcribed (a failed one is queued again), or straight to `proposing`.
export async function finishWalk(
  reference: string,
  walkId: string,
  name: string,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  checkFinishable(walk)
  // The move matches on holding something as well as the status.
  const claimed = await SiteWalkModel.updateOne(
    {
      _id: walk._id,
      status: 'recording',
      $or: [
        { 'recordings.0': { $exists: true } },
        { 'notes.0': { $exists: true } },
        { typedText: { $nin: [null, ''] } },
      ],
    },
    { status: 'transcribing', name },
  )
  if (!claimed.matchedCount) {
    const now = await SiteWalkModel.findById(walk._id).lean<StoredWalk>()
    if (now) checkFinishable(now)
    throw new SiteWalkStateError(WHILE_RECORDING)
  }
  // Read again: a recording that failed after the first read would be missed, leaving the walk
  // stuck in `transcribing` with no job.
  await redoFailedRecordings((await SiteWalkModel.findById(walk._id).lean<StoredWalk>())!)
  await queueProposalIfReady(walk._id)
  return dto(reference, walk._id)
}

// Renames a walk, in any state (it can be renamed from its proposal, even once created).
// Returns the walk as the client reads it.
export async function renameWalk(
  reference: string,
  walkId: string,
  name: string,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  await SiteWalkModel.updateOne({ _id: walk._id }, { name })
  return dto(reference, walk._id)
}

// Throws unless the walk is still recording and holds a recording, a note or legacy typed text.
function checkFinishable(walk: StoredWalk) {
  if (walk.status !== 'recording') throw new SiteWalkStateError(WHILE_RECORDING)
  if (!walk.recordings.length && !walk.notes?.length && !walk.typedText)
    throw new InvalidSiteWalkError('Record or type something before finishing the walk.')
}

// Queues the recordings that failed again. Returns nothing.
async function redoFailedRecordings(walk: StoredWalk) {
  const failed = walk.recordings.filter((r) => r.transcription.status === 'failed')
  if (!failed.length) return
  await SiteWalkModel.updateOne(
    { _id: walk._id },
    {
      $set: { 'recordings.$[r].transcription.status': 'queued' },
      $unset: { 'recordings.$[r].transcription.error': 1 },
    },
    { arrayFilters: [{ 'r.transcription.status': 'failed' }] },
  )
  for (const r of failed) await queueTranscription(walk._id, r.seq, true)
}

// Moves a `transcribing` walk with every recording transcribed (or a typed
// walk) to `proposing` and queues its proposal. The update matches on the
// status, so two recordings finishing together queue it once.
export async function queueProposalIfReady(walkId: string | Types.ObjectId) {
  const moved = await SiteWalkModel.findOneAndUpdate(
    {
      _id: walkId,
      status: 'transcribing',
      recordings: { $not: { $elemMatch: { 'transcription.status': { $ne: 'transcribed' } } } },
    },
    { status: 'proposing', $unset: { error: 1 } },
  ).lean()
  if (moved) await queueProposal(walkId)
}

// Queues the walk's proposal. If the queue is down the walk is marked failed so
// Retry works, rather than sitting in `proposing` for a job that does not exist.
// A retry gets a fresh job id (see retryJobId).
export async function queueProposal(walkId: string | Types.ObjectId, retry = false) {
  try {
    const jobId = `swp-${walkId}`
    await proposalQueue.add(retry ? retryJobId(jobId) : jobId, { walkId: String(walkId) })
  } catch (error) {
    console.error('Queueing site walk proposal failed:', error)
    await SiteWalkModel.updateOne(
      { _id: walkId, status: 'proposing' },
      { status: 'failed', error: 'The site walk could not be queued for reading. Retry it.' },
    )
  }
}

// After a restart: queues again the recordings still waiting to be transcribed,
// the walks waiting for their proposal, and the ready walks whose notification
// was cut off. Job ids are fixed, so a job Redis kept is not run twice. Returns nothing.
export async function resumeInterruptedSiteWalks() {
  const waiting = await SiteWalkModel.find({
    $or: [
      { 'recordings.transcription.status': { $in: ['queued', 'transcribing'] } },
      { 'media.transcription.status': { $in: ['queued', 'transcribing'] } },
      { status: { $in: ['transcribing', 'proposing'] } },
      { status: 'ready', notified: false },
    ],
  }).lean<StoredWalk[]>()
  for (const walk of waiting) {
    for (const r of walk.recordings)
      if (['queued', 'transcribing'].includes(r.transcription.status))
        await queueTranscription(walk._id, r.seq)
    for (const m of walk.media ?? [])
      if (['queued', 'transcribing'].includes(m.transcription?.status ?? ''))
        await queueMediaTranscription(walk._id, m.mediaId)
    if (walk.status === 'transcribing') await queueProposalIfReady(walk._id)
    if (walk.status === 'proposing' || walk.status === 'ready') await queueProposal(walk._id)
  }
}

// Runs again what failed: the recordings that did not transcribe, else the proposal.
export async function retryWalk(reference: string, walkId: string, user: SessionUser) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  if (walk.status !== 'failed')
    throw new SiteWalkStateError('Only a failed site walk can be retried.')
  const next = walk.recordings.some((r) => r.transcription.status === 'failed')
    ? 'transcribing'
    : 'proposing'
  const moved = await SiteWalkModel.findOneAndUpdate(
    { _id: walk._id, status: 'failed' },
    { status: next, $unset: { error: 1 } },
  ).lean()
  if (moved) {
    if (next === 'transcribing') await redoFailedRecordings(walk)
    else await queueProposal(walk._id, true)
  }
  return dto(reference, walk._id)
}

const CREATE_STARTED =
  'Create all has started on this site walk, so it can no longer be discarded. Run Create all again to finish.'

// Throws a walk away, with its recordings and photos in S3, unless Create all
// has started making observations from them (they point at the same files).
export async function discardWalk(reference: string, walkId: string, user: SessionUser) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  if (walk.status === 'created')
    throw new SiteWalkStateError('This site walk is already added to the assessment.')
  if (walk.created) throw new SiteWalkStateError(CREATE_STARTED)
  // Matching on "not started" stops a Create all that began since the read.
  const deleted = await SiteWalkModel.deleteOne({ _id: walk._id, created: { $exists: false } })
  if (!deleted.deletedCount) throw new SiteWalkStateError(CREATE_STARTED)
  for (const key of [...walk.recordings, ...walk.photos, ...(walk.media ?? [])].map((f) => f.key))
    await storage.deleteObject(key).catch(() => undefined)
}

// A walk photo's type, size and `open`, which streams all of it or a byte range.
export async function getWalkPhoto(
  reference: string,
  walkId: string,
  photoId: string,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, false)
  const photo = walk.photos.find((p) => p.photoId === photoId)
  if (!photo) throw new SiteWalkNotFoundError()
  return {
    open: (range?: storage.ByteRange) => storage.getObjectStream(photo.key, range),
    contentType: photo.contentType,
    size: photo.size,
  }
}

// A walk recording's type, size and `open`, which streams all of it or a byte range.
export async function getWalkRecording(
  reference: string,
  walkId: string,
  seq: number,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, false)
  const recording = walk.recordings.find((r) => r.seq === seq)
  if (!recording) throw new SiteWalkNotFoundError()
  return {
    open: (range?: storage.ByteRange) => storage.getObjectStream(recording.key, range),
    contentType: recording.contentType,
    size: recording.size,
  }
}

// Parses an added media item's id: the client's UUID.
export const mediaIdSchema = photoFieldsSchema.shape.photoId

const PROPOSAL_OPEN = 'Media can be added once the proposal is ready, until Create all starts.'

// Stores one photo, handwritten page or voice clip added to the proposal by
// hand (round 3), once per client id, and queues a voice clip's transcription.
// Only while the proposal can be changed; matching on that in the push stops a
// Create all that started meanwhile. Returns the walk as the client reads it.
export async function addProposalMedia(
  reference: string,
  walkId: string,
  mediaId: string,
  // contentType for a voice clip; a photo's or page's is read from its bytes.
  file: { kind: IWalkMedia['kind']; body: Buffer; contentType?: string },
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, true)
  if (walk.media?.some((m) => m.mediaId === mediaId)) return toSiteWalkDto(reference, walk)
  if (walk.status !== 'ready' || walk.created) throw new SiteWalkStateError(PROPOSAL_OPEN)
  const image = file.kind === 'voice' ? null : photoFormat(file.body)!
  const contentType = image?.contentType ?? file.contentType!
  const media: IWalkMedia = {
    mediaId,
    kind: file.kind,
    key: `${file.kind === 'voice' ? 'audio' : 'photos'}/${reference}/site-walks/${walk._id}/media/${mediaId}.${image?.extension ?? audioExtension(contentType)}`,
    contentType,
    size: file.body.length,
    ...(file.kind === 'voice' && { transcription: { status: 'queued' as const } }),
  }
  await storage.putObject(media.key, file.body, media.contentType)
  const pushed = await SiteWalkModel.updateOne(
    {
      _id: walk._id,
      status: 'ready',
      created: { $exists: false },
      'media.mediaId': { $ne: mediaId },
    },
    { $push: { media } },
  )
  // Nothing pushed: a resend stored it first (fine), or Create all started.
  if (!pushed.modifiedCount) {
    const now = await SiteWalkModel.findById(walk._id, 'media.mediaId').lean<StoredWalk>()
    if (!now?.media?.some((m) => m.mediaId === mediaId)) {
      await storage.deleteObject(media.key).catch(() => undefined)
      throw new SiteWalkStateError(PROPOSAL_OPEN)
    }
  }
  if (file.kind === 'voice') await queueMediaTranscription(walk._id, mediaId)
  return dto(reference, walk._id)
}

// An added media item's type, size and `open`, which streams all of it or a byte range.
export async function getProposalMedia(
  reference: string,
  walkId: string,
  mediaId: string,
  user: SessionUser,
) {
  const { walk } = await loadWalk(reference, walkId, user, false)
  const media = walk.media?.find((m) => m.mediaId === mediaId)
  if (!media) throw new SiteWalkNotFoundError()
  return {
    open: (range?: storage.ByteRange) => storage.getObjectStream(media.key, range),
    contentType: media.contentType,
    size: media.size,
  }
}

// Queues a voice clip's transcription; if the queue is down it is marked failed,
// and Create all transcribes it on the observation instead.
async function queueMediaTranscription(walkId: string | Types.ObjectId, mediaId: string) {
  try {
    await transcriptionQueue.add(`swm-${walkId}-${mediaId}`, {
      kind: 'walk-media',
      walkId: String(walkId),
      mediaId,
    })
  } catch (error) {
    console.error('Queueing transcription failed:', error)
    await setMediaTranscription(walkId, mediaId, { status: 'failed', error: NOT_QUEUED })
  }
}

const setMediaTranscription = (
  walkId: string | Types.ObjectId,
  mediaId: string,
  transcription: NonNullable<IWalkMedia['transcription']>,
) =>
  SiteWalkModel.updateOne(
    { _id: walkId, 'media.mediaId': mediaId },
    { $set: { 'media.$.transcription': transcription } },
  )

onTranscriptionJob('walk-media', (job, context) =>
  runMediaTranscription(job.walkId, job.mediaId, context),
)

// Transcribes one added voice clip. Retried like a walk recording; on the last
// try (or a refusal) it is marked failed, which only means Create all
// transcribes it again on the observation.
export async function runMediaTranscription(walkId: string, mediaId: string, context: JobContext) {
  const walk = await SiteWalkModel.findById(walkId).lean<StoredWalk>()
  const media = walk?.media?.find((m) => m.mediaId === mediaId)
  if (!walk || !media || media.transcription?.status === 'transcribed') return
  try {
    await setMediaTranscription(walkId, mediaId, { status: 'transcribing' })
    const assessment = await AssessmentModel.findById(walk.assessment, 'reference').lean()
    const result = await transcribeWithSegments(media.key, { reportId: assessment?.reference })
    await setMediaTranscription(walkId, mediaId, { status: 'transcribed', text: result.transcript })
  } catch (error) {
    const refused = error instanceof SpeechServiceError && !error.retryable
    if (!refused && !context.isLastAttempt) throw error
    const reason = error instanceof Error ? error.message : 'Transcription failed.'
    await setMediaTranscription(walkId, mediaId, { status: 'failed', error: reason })
  }
}

// The walk's error line: which recording failed and the reason the engineer can act on.
const FAILED_RECORDING = (seq: number, error?: string) =>
  [
    `Recording ${seq} could not be transcribed.`,
    transcriptionFailureReason(error),
    'Retry the walk.',
  ]
    .filter(Boolean)
    .join(' ')

onTranscriptionJob('site-walk', (job, context) =>
  runWalkTranscription(job.walkId, job.seq, context),
)

// Transcribes one walk recording and saves its text and timed segments. Any
// failure but a refused request throws so the queue retries it; on the last try
// (or a refusal) the recording, and the walk if it was already finished, is
// marked failed so Retry works. When it was the last recording the walk was
// waiting for, the proposal is queued.
export async function runWalkTranscription(walkId: string, seq: number, context: JobContext) {
  try {
    await transcribeRecording(walkId, seq)
  } catch (error) {
    const refused = error instanceof SpeechServiceError && !error.retryable
    if (!refused && !context.isLastAttempt) throw error
    await markRecordingFailed(walkId, seq, error)
  }
}

// One try at transcribing a walk recording; throws whatever goes wrong. A
// recording already transcribed (a retry after a later step failed) only
// queues the proposal.
async function transcribeRecording(walkId: string, seq: number) {
  const walk = await SiteWalkModel.findById(walkId).lean<StoredWalk>()
  const recording = walk?.recordings.find((r) => r.seq === seq)
  if (!walk || !recording) return
  if (recording.transcription.status !== 'transcribed') {
    const here = { _id: walk._id, 'recordings.seq': seq }
    await SiteWalkModel.updateOne(here, {
      $set: { 'recordings.$.transcription.status': 'transcribing' },
    })
    const assessment = await AssessmentModel.findById(walk.assessment, 'reference').lean()
    const result = await transcribeWithSegments(recording.key, {
      reportId: assessment?.reference,
    })
    await SiteWalkModel.updateOne(here, {
      $set: {
        'recordings.$.transcription.status': 'transcribed',
        'recordings.$.transcription.text': result.transcript,
        'recordings.$.transcription.segments': result.segments,
      },
      $unset: { 'recordings.$.transcription.error': 1 },
    })
  }
  await queueProposalIfReady(walk._id)
}

// Marks the recording failed with the reason, and the walk too once finished.
async function markRecordingFailed(walkId: string, seq: number, error: unknown) {
  const reason = error instanceof Error ? error.message : 'Transcription failed.'
  await SiteWalkModel.updateOne(
    { _id: walkId, 'recordings.seq': seq },
    {
      $set: {
        'recordings.$.transcription.status': 'failed',
        'recordings.$.transcription.error': reason,
      },
    },
  )
  await SiteWalkModel.updateOne(
    { _id: walkId, status: 'transcribing' },
    { status: 'failed', error: FAILED_RECORDING(seq, reason) },
  )
}

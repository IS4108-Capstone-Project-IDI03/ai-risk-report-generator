// The reading job (CP-24): one background job per observation that describes
// its photos and then suggests the category and severity the engineer left
// empty. Queued by observation.service.ts (save, media, the note, transcripts,
// restore, Try again, and site walk create, which describes but doesn't rate);
// calls speech.service.ts (photo description) and rag.service.ts (rating), and
// pushes each change to the open page (bus.ts).
import { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import {
  COPE_DIMENSIONS,
  copeDimensionsOf,
  ObservationModel,
  SEVERITIES,
  type IObservation,
  type IPage,
  type IPhoto,
  type IPhotoReading,
  type IPhotoRegion,
  type IRecording,
  type IStamp,
} from '../models/observation.model'
import { recordAiCalls, visionUsageToWire } from './ai-usage.service'
import { publishObservations } from './assistant/bus'
import { queueAssessmentCheck } from './assistant/check-queue.service'
import { defineQueue, type JobContext } from './job-queue.service'
import { locationText } from './location.service'
import { privacyFor, readingPrivacyFor } from './privacy.service'
import { rateObservation, RagServiceError, type RatedObservation } from './rag.service'
import { observationFacts } from './section.service'
import { hyphenated, interpret, type InterpretationResult } from './speech.service'
import * as storage from './storage.service'

export type StoredObservation = IObservation & { _id: Types.ObjectId }

/** Returns the recordings, photos or pages not removed (CP-08, CP-20): the observation's evidence. */
export const kept = <T extends { removed?: IStamp }>(items: T[]) =>
  items.filter((item) => !item.removed)

/**
 * Returns a transcript a reading can use: the engineer's correction where there
 * is one (CP-08 AC5, CP-20), and null while it is still transcribing, failed,
 * or empty (a page with no handwriting).
 */
export function readableText(
  t: IRecording['transcription'] | IPage['transcription'],
): string | null {
  if (t.status !== 'transcribed') return null
  const text = t.correction?.text || t.transcript
  return text?.trim() ? text : null
}

// The same for describing photos (CP-05, CP-21), from S5's message prefixes
// (microservices/speech-ocr-service/app/processors/vision.py).
/** Returns the reason a photo description failed, as the engineer is shown it. */
export function interpretationFailureReason(error?: string): string | null {
  if (!error) return null
  if (error.startsWith('The photo could not be read from storage:'))
    return 'A photo could not be read from storage.'
  if (error.startsWith('The photo could not be opened:')) return 'A photo could not be opened.'
  if (
    error.startsWith('The observation could not be read:') ||
    // Stored by readings from before CP-21.
    error.startsWith('The photos could not be interpreted:')
  ) {
    // The provider's own status, when it says why, as for a handwritten page.
    if (/Error code: 429|rate limit|quota/i.test(error))
      return 'The AI service has reached its usage limit. Try again later.'
    if (/Error code: 503|high demand|overloaded/i.test(error))
      return 'The AI service is busy. Try again in a minute.'
    return 'The AI service could not read this observation.'
  }
  return error.length > 200 ? 'Interpretation failed. Please retry or contact support.' : error
}

// The photos a pre-CP-21 reading read, by id: its own list, or for a reading
// from before photos could change, every photo the observation was saved with.
function readPhotoIds(o: StoredObservation): string[] {
  const ids =
    o.interpretation?.photoIds ?? (o.photos ?? []).filter((p) => !p.added).map((p) => p._id)
  return ids.map(String)
}

/**
 * Returns the photos' description as it stands (CP-21): its own record, or on
 * a reading from before the parts were split, the description kept with the
 * old categories, under their status; null when never described.
 */
export function photoReadingOf(o: StoredObservation): IPhotoReading | null {
  const reading = o.interpretation
  if (!reading) return null
  if (reading.photoReading) return reading.photoReading
  if (reading.description === undefined && reading.hazardType === undefined) return null
  return {
    status: reading.status ?? 'interpreted',
    description: reading.description,
    hazardType: reading.hazardType,
    attempts: reading.attempts ?? [],
    photoIds: readPhotoIds(o).map((id) => new Types.ObjectId(id)),
    provenance: reading.provenance,
  }
}

/**
 * Returns whether a finished description is of photos other than those kept
 * now (CP-08), or of other marks (CP-10). Nothing else it reads changes it.
 */
export function photosOutOfDate(o: StoredObservation): boolean {
  const reading = photoReadingOf(o)
  if (reading?.status !== 'interpreted') return false
  const read = reading.photoIds.map(String)
  const now = kept(o.photos ?? []).map((p) => String(p._id))
  if (read.length !== now.length || now.some((id) => !read.includes(id))) return true
  // A mark moved, added or cleared since (CP-10): the model saw something else.
  return markKey(marksOf(o.photos ?? [], now)) !== markKey(reading.marks ?? [])
}

// The marks on the given photos (CP-10), as a photo reading keeps them.
function marksOf(photos: IPhoto[], ids: string[]) {
  return photos
    .filter((p) => p.region && ids.includes(String(p._id)))
    .map((p) => ({ photo: p._id, region: p.region! }))
}
// Marks compared whatever their order.
const markKey = (marks: { photo: Types.ObjectId; region: IPhotoRegion }[]) =>
  JSON.stringify(
    marks
      .map(({ photo, region: { x, y, w, h } }) => [String(photo), x, y, w, h])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )

// Starts describing the photos kept now, as the system (CP-24): one attempt,
// recording the photos and marks it reads (CP-10) so a later change shows it
// out of date. Matching on the state it found makes it atomic, so two jobs
// cannot start two. Returns false when another description is running.
async function startDescription(o: StoredObservation): Promise<boolean> {
  const reading = o.interpretation
  const photoReading = reading?.photoReading
  if (photoReading?.status === 'interpreting') return false
  const photoIds = kept(o.photos ?? []).map((p) => p._id)
  const marks = marksOf(o.photos ?? [], photoIds.map(String))
  const attempt = { startedAt: new Date() }
  const started = { status: 'interpreting', attempts: [attempt], photoIds, marks }
  const filter: Record<string, unknown> = { _id: o._id, deleted: { $exists: false } }
  const set: Record<string, unknown> = {}
  const unset: Record<string, 1> = {}
  const push: Record<string, unknown> = {}
  if (!reading) {
    filter.interpretation = { $exists: false }
    set.interpretation = { photoReading: started }
  } else {
    // A description kept from before the parts were split now lives in its own part.
    unset['interpretation.description'] = 1
    unset['interpretation.hazardType'] = 1
    if (photoReading) {
      filter['interpretation.photoReading.status'] = photoReading.status
      Object.assign(set, {
        'interpretation.photoReading.status': 'interpreting',
        'interpretation.photoReading.photoIds': photoIds,
        'interpretation.photoReading.marks': marks,
      })
      for (const field of ['description', 'hazardType', 'error', 'provenance'])
        unset[`interpretation.photoReading.${field}`] = 1
      push['interpretation.photoReading.attempts'] = attempt
    } else {
      filter['interpretation.photoReading'] = { $exists: false }
      set['interpretation.photoReading'] = started
    }
  }
  const { matchedCount } = await ObservationModel.updateOne(filter, {
    $set: set,
    ...(Object.keys(unset).length && { $unset: unset }),
    ...(Object.keys(push).length && { $push: push }),
  })
  return matchedCount > 0
}

// Runs the latest description attempt and records it (CP-05 AC3-AC5, CP-21).
// It reads the photos its attempt names, with the note as a hint and where the
// finding was made, so a change made while it runs leaves it describing what it
// started with. Never throws: a failure is stored as the reason the engineer
// sees. The description is not drafting evidence (only through the note).
async function describePhotos(id: string): Promise<void> {
  const observation = await ObservationModel.findById(
    id,
    // kinds tells observationFacts whether the note states a fact (CP-36).
    'assessment photos note location interpretation kinds',
  )
    .lean<StoredObservation>()
    .catch(() => null)
  const reading = observation?.interpretation?.photoReading
  if (!reading) return
  // S5 refuses labels that repeat, and phones name every photo image.jpg, so a
  // repeated name is numbered ("image.jpg (2)"); the note's label counts too.
  // What the engineer observed as fact (CP-35): a split note's fact parts, else the note as typed.
  const note = observationFacts(observation)?.trim() ? observationFacts(observation)! : null
  const seen = new Map<string, number>(note ? [['Note', 1]] : [])
  const unique = (name: string) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : `${name} (${count})`
  }
  const photos = reading.photoIds.flatMap((photoId) => {
    const photo = observation.photos?.find((p) => p._id.equals(photoId))
    if (!photo) return []
    // A marked photo (CP-10) goes with its mark, so S5 sends the model a close-up too.
    const { region } = photo
    return [
      {
        label: unique(photo.name),
        s3Key: photo.key,
        ...(region && { region: { x: region.x, y: region.y, w: region.w, h: region.h } }),
      },
    ]
  })
  const texts = note ? [{ label: 'Note', kind: 'note' as const, text: note }] : []
  const assessment = await AssessmentModel.findById(observation.assessment, 'locations reference')
    .lean()
    .catch(() => null)
  const place = assessment?.locations?.find((l) => l._id.equals(observation.location))
  const attempt = `interpretation.photoReading.attempts.${reading.attempts.length - 1}`
  let outcome: Record<string, unknown>
  try {
    const started = performance.now()
    const result = await interpret({
      photos,
      texts,
      location: place ? locationText(place) : null,
      // Read inside the try, so a failure is stored as the attempt's reason (PV-04).
      // Without the assessment, protection on fails as not found rather than send unprotected.
      privacy: await readingPrivacyFor(assessment?.reference ?? ''),
    })
    // EV-03: the paid call, tagged with the assessment. Never throws.
    await recordAiCalls(visionUsageToWire(result, performance.now() - started), {
      reportId: assessment?.reference,
    })
    outcome = {
      'interpretation.photoReading.status': 'interpreted',
      'interpretation.photoReading.description': result.description,
      'interpretation.photoReading.hazardType': result.hazard_type,
      'interpretation.photoReading.provenance': {
        provider: result.provider,
        model: result.model,
        promptVersion: result.prompt_version,
        usage: result.usage && {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          thoughtTokens: result.usage.thought_tokens,
        },
        ...(result.privacy && {
          privacy: {
            enabled: result.privacy.enabled,
            maskedCount: result.privacy.masked_count,
            facesBlurred: result.privacy.faces_blurred,
            removedFromAnswer: result.privacy.removed_from_answer,
          },
        }),
        interpretedAt: new Date(),
      },
      ...(await keepRedactedPhotos(observation, photos, result.redacted_photos)),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Interpretation failed.'
    outcome = {
      'interpretation.photoReading.status': 'failed',
      'interpretation.photoReading.error': reason,
      [`${attempt}.error`]: reason,
    }
  }
  outcome[`${attempt}.finishedAt`] = new Date()
  await ObservationModel.updateOne({ _id: id }, { $set: outcome }).catch((error) =>
    console.error('Saving the photo description failed:', error),
  )
  if (assessment) {
    publishObservations(assessment.reference)
    queueAssessmentCheck(assessment.reference)
  }
}

// Each photo as the model saw it, when protection blurred a face in it (PV-04):
// stored beside the original, which is never changed, so the engineer can see
// what left. A photo with no face went out as taken (only shrunk), so only that
// it was checked is recorded. Returns the fields to set on the observation.
async function keepRedactedPhotos(
  observation: StoredObservation,
  photos: { label: string; s3Key: string }[],
  redacted: InterpretationResult['redacted_photos'],
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {}
  for (const { label, faces, image } of redacted ?? []) {
    const key = photos.find((p) => p.label === label)?.s3Key
    const index = observation.photos?.findIndex((p) => p.key === key) ?? -1
    if (index < 0) continue
    if (!faces) {
      fields[`photos.${index}.redaction`] = { key: null, faces: 0, at: new Date() }
      continue
    }
    const copy = Buffer.from(image, 'base64')
    // One copy per photo: reading it again replaces the last one.
    const copyKey = key!.replace(/\.[^./]+$/, '') + '.redacted.jpg'
    try {
      await storage.putObject(copyKey, copy, 'image/jpeg')
    } catch (error) {
      // The copy only shows the engineer what left: the reading still stands.
      // Logged by key, never with the image.
      console.error(`Keeping the blurred copy ${copyKey} failed:`, (error as Error).message)
      continue
    }
    fields[`photos.${index}.redaction`] = {
      key: copyKey,
      faces,
      size: copy.length,
      at: new Date(),
    }
  }
  return fields
}

// As for transcriptions: a restart loses a description still running in
// memory, so mark it failed, ready for the next run to describe again.
async function failInterruptedDescriptions() {
  await ObservationModel.updateMany(
    { 'interpretation.photoReading.status': 'interpreting' },
    {
      $set: {
        'interpretation.photoReading.status': 'failed',
        'interpretation.photoReading.error':
          'Interpretation was interrupted by a gateway restart. Retry it.',
      },
    },
  )
}

// Aggregation expressions: whether a field is "open", i.e. not the engineer's:
// empty, or still holding an unconfirmed suggestion. Evaluated inside Mongo at
// write time, so a value the engineer chose meanwhile is never replaced.
const isNull = (path: string) => ({ $eq: [{ $ifNull: [path, null] }, null] })
const OPEN = {
  category: {
    $or: [isNull('$metadata.COPE_dimension'), { $not: [isNull('$suggestion.category')] }],
  },
  severity: { $or: [isNull('$severity'), { $not: [isNull('$suggestion.severity')] }] },
}

/** Returns whether the field is not the engineer's: empty, or an unconfirmed suggestion. */
export function isOpen(o: StoredObservation, field: 'category' | 'severity'): boolean {
  const empty = field === 'category' ? !copeDimensionsOf(o.metadata.COPE_dimension) : !o.severity
  return empty || !!o.suggestion?.[field]
}

type ReadingJob = { observationId: string; run: number }

// Two tries from a 5 s backoff ("after two failed tries the suggestion is
// failed"); concurrency 3, as for transcription.
const readingQueue = defineQueue<ReadingJob>(
  'observation-reading',
  { concurrency: 3, attempts: 2, backoffMs: 5000 },
  (job, context) => runReading(job.observationId, job.run, context),
)

const COULD_NOT_QUEUE = 'This observation could not be queued for reading. Try again.'

/**
 * Marks the observation as being read when a field is open, takes the next run
 * number and queues that run's job; returns the observation as it is now, or
 * null for a draft, a deleted one or one not found. Never throws: callers don't
 * wait for the job, and a Redis outage must not fail the engineer's change.
 * `rate` turns rating off (site walk create) or on (an engineer's change);
 * left out, it stays as it is (a transcript finishing, a restart, a restore).
 */
export async function queueReading(
  id: string | Types.ObjectId,
  { rate }: { rate?: boolean } = {},
): Promise<StoredObservation | null> {
  let o: StoredObservation | null
  try {
    // a. One atomic write: the next run number, and Reading if anything is
    // open and will be rated (rating off, it would only flash Reading).
    const rates = rate ?? { $ne: ['$suggestion.rate', false] }
    o = await ObservationModel.findOneAndUpdate(
      { _id: id, draft: { $ne: true }, deleted: { $exists: false } },
      [
        {
          $set: {
            'suggestion.status': {
              $cond: [
                { $and: [rates, { $or: [OPEN.category, OPEN.severity] }] },
                'reading',
                'done',
              ],
            },
            'suggestion.attempts': 0,
            'suggestion.category': { $ifNull: ['$suggestion.category', null] },
            'suggestion.severity': { $ifNull: ['$suggestion.severity', null] },
            'suggestion.run': { $add: [{ $ifNull: ['$suggestion.run', 0] }, 1] },
            ...(rate !== undefined && { 'suggestion.rate': rate }),
          },
        },
        { $unset: 'suggestion.error' },
      ],
      { returnDocument: 'after', updatePipeline: true },
    ).lean<StoredObservation>()
  } catch (error) {
    console.error('Marking the observation for reading failed:', error)
    return null
  }
  if (!o) return null
  // b. The run is in the job id, so each trigger gets its own job and a repeat
  // of the same run (restart recovery) is dropped by BullMQ as a duplicate.
  const run = o.suggestion!.run
  try {
    await readingQueue.add(`obs-reading-${o._id}-${run}`, { observationId: String(o._id), run })
  } catch (error) {
    // Without this, a Redis outage would leave it reading forever with no job.
    console.error('Queueing the observation reading failed:', error)
    o =
      (await ObservationModel.findOneAndUpdate(
        { _id: o._id, 'suggestion.run': run, 'suggestion.status': 'reading' },
        { $set: { 'suggestion.status': 'failed', 'suggestion.error': COULD_NOT_QUEUE } },
        { returnDocument: 'after' },
      )
        .lean<StoredObservation>()
        .catch(() => null)) ?? o
  }
  return o
}

/** Requeues reading interrupted by a restart; returns once each is queued. Called before the workers start. */
export async function resumeReadings(): Promise<void> {
  const waiting = await ObservationModel.distinct('_id', {
    $or: [
      { 'suggestion.status': 'reading' },
      { 'interpretation.photoReading.status': 'interpreting' },
    ],
  })
  await failInterruptedDescriptions()
  // A new run each: an older job Redis kept will see it is out of date and stop.
  await Promise.all(waiting.map((id) => queueReading(id as Types.ObjectId)))
}

// Sets the run's outcome, only while it is still the latest run.
async function settle(id: string, run: number, status: 'done' | 'failed', error?: string) {
  await ObservationModel.updateOne(
    { _id: id, 'suggestion.run': run },
    status === 'failed'
      ? { $set: { 'suggestion.status': status, 'suggestion.error': error } }
      : { $set: { 'suggestion.status': status }, $unset: { 'suggestion.error': 1 } },
  )
}

// rag-service's PrivacyUnavailable message (microservices/rag-service/app/privacy.py):
// masking was unavailable, so nothing was sent, and trying again at once won't help.
const maskingUnavailable = (error: unknown) =>
  error instanceof RagServiceError &&
  error.message.startsWith("Client details couldn't be protected")

// Everything the rating reads, joined by blank lines: the note, the finished
// transcripts (corrected where they are), the pages' text and the photo
// description when it describes the photos kept now.
function textOf(o: StoredObservation): string {
  const photos = photoReadingOf(o)
  return [
    // The whole note (CP-36): a recommendation-only note must still be categorised to reach
    // drafting. A note that is only a request for the client is never rated as a finding.
    o.kinds?.length && o.kinds.every((k) => k === 'info_request') ? null : o.note,
    ...kept(o.recordings).map((r) => readableText(r.transcription)),
    ...kept(o.pages ?? []).map((p) => readableText(p.transcription)),
    photos?.status === 'interpreted' && !photosOutOfDate(o) ? photos.description : null,
  ]
    .filter((text): text is string => !!text?.trim())
    .join('\n\n')
}

// Whether the photos need describing: photos kept, and no description of them yet.
function needsDescription(o: StoredObservation): boolean {
  if (!kept(o.photos ?? []).length) return false
  const reading = photoReadingOf(o)
  return !reading || reading.status !== 'interpreted' || photosOutOfDate(o)
}

// The rating as it can be stored: one of the four categories and severities.
function checked(rated: RatedObservation) {
  const category = COPE_DIMENSIONS.find((c) => c === rated.category)
  const severity = SEVERITIES.find((s) => s === rated.severity)
  if (!category || !severity) throw new Error('The suggestion service gave an unknown value.')
  return { category, severity, check: rated.check }
}

/**
 * Runs one reading of an observation (CP-24) and saves what it finds; returns
 * when done. Throws a passing failure before the last try, so BullMQ retries.
 */
export async function runReading(
  id: string,
  run: number,
  context: JobContext = { isLastAttempt: true },
): Promise<void> {
  // a. Stop when a newer run is queued (it does all of this), or when the
  // observation is deleted, still a draft, or its assessment archived.
  const found = await ObservationModel.findById(id).lean<StoredObservation>()
  if (found?.suggestion?.run !== run) return
  const assessment = await AssessmentModel.findById(found.assessment, 'reference archivedAt').lean()
  if (!assessment) return
  const reference = assessment.reference
  if (found.deleted || found.draft || assessment.archivedAt) {
    await settle(id, run, 'done')
    return publishObservations(reference)
  }

  // b. Describe the photos first, as the system, when they have no description
  // of what they are now. Another run describing them already re-queues when it
  // finishes (below), so this one stops rather than describe twice.
  if (needsDescription(found)) {
    if (!(await startDescription(found))) return
    await describePhotos(id)
    const after = await ObservationModel.findById(id, 'suggestion').lean<StoredObservation>()
    // A trigger arrived meanwhile, and its job may have stopped on this
    // description: without a new run, nothing would rate the observation.
    if (after?.suggestion?.run !== run) {
      await queueReading(id)
      return
    }
  }
  const o = await ObservationModel.findById(id).lean<StoredObservation>()
  // Gone since step a (a discarded draft): without this the job would throw on a missing record.
  if (!o) return

  // c. Wait while anything is transcribing: its finish queues a new run.
  const transcribing = [...kept(o.recordings), ...kept(o.pages ?? [])].some(
    (item) => item.transcription.status === 'transcribing',
  )
  if (transcribing) return publishObservations(reference)

  // d-e. Nothing to suggest (both fields are the engineer's), nothing to read,
  // or rating is off: a site walk observation keeps the proposal's values and
  // marks until the engineer first changes it (AC17).
  const text = textOf(o)
  if (o.suggestion?.rate === false || (!isOpen(o, 'category') && !isOpen(o, 'severity')) || !text) {
    await settle(id, run, 'done')
    publishObservations(reference)
    return queueAssessmentCheck(reference)
  }

  // f. Rate the text: rag-service masks it first and sends nothing if it can't.
  await ObservationModel.updateOne(
    { _id: id, 'suggestion.run': run },
    {
      $inc: { 'suggestion.attempts': 1 },
    },
  )
  let rated: ReturnType<typeof checked>
  try {
    const answer = await rateObservation({ text, privacy: await privacyFor(reference) })
    // EV-03: the classifier's cost, under the site walk's feature. Never throws.
    await recordAiCalls(hyphenated(answer.usage), { reportId: reference })
    rated = checked(answer)
  } catch (error) {
    const masking = maskingUnavailable(error)
    if (!masking && !context.isLastAttempt) throw error
    console.error(`Suggesting for observation ${id} failed:`, error)
    await settle(
      id,
      run,
      'failed',
      masking ? (error as Error).message : 'The category and severity could not be suggested.',
    )
    publishObservations(reference)
    return queueAssessmentCheck(reference)
  }

  // g. Fill each field still open now, in one write that checks it in Mongo,
  // so a value the engineer chose while this ran is kept. Only this run's
  // write lands: a newer trigger's run will rate again.
  const fill = (field: 'category' | 'severity', path: string, value: unknown) => ({
    [path]: { $cond: [OPEN[field], { $literal: value }, `$${path}`] },
    [`suggestion.${field}`]: {
      $cond: [
        OPEN[field],
        { $literal: { notSure: !!rated.check?.[field] } },
        `$suggestion.${field}`,
      ],
    },
  })
  await ObservationModel.updateOne(
    { _id: id, 'suggestion.run': run },
    [
      {
        $set: {
          ...fill('category', 'metadata.COPE_dimension', [rated.category]),
          ...fill('severity', 'severity', rated.severity),
          'suggestion.status': 'done',
        },
      },
      { $unset: 'suggestion.error' },
    ],
    { updatePipeline: true },
  )
  publishObservations(reference)
  // MarshBot (AS-06): the observation may now be categorised.
  queueAssessmentCheck(reference)
}

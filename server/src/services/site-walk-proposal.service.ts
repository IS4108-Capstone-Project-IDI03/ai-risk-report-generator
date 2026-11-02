// The site walk proposal (CP-22): checking one, saving the engineer's edits,
// and making it in the background. Called by routes/site-walk.routes.ts (save)
// and by the site-walk-proposal queue (make). Calls speech.service.ts (photo
// descriptions), rag.service.ts (the reading) and notification.service.ts.
import { z } from 'zod'
import { AssessmentModel } from '../models/assessment.model'
import { COPE_DIMENSIONS, SEVERITIES } from '../models/observation.model'
import { SiteWalkModel, type Proposal } from '../models/site-walk.model'
import { SiteModel } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import { onProposalJob } from './background-queues.service'
import type { SessionUser } from './auth.service'
import type { JobContext } from './job-queue.service'
import { locationSchema } from './location.service'
import { createNotification } from './notification.service'
import { privacyFor } from './privacy.service'
import { proposeSiteWalk, RagServiceError } from './rag.service'
import {
  InvalidSiteWalkError,
  loadWalk,
  SiteWalkStateError,
  toSiteWalkDto,
  type StoredWalk,
} from './site-walk.service'
import { describePhoto, hyphenated, SpeechServiceError } from './speech.service'

// Used as a key in the walk's `created` map, so no dots or dollar signs.
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'A ref is letters, digits, - and _ only.')
const seconds = z.number().min(0).nullable()

const proposedLocation = z.object({
  ref,
  existingId: z.string().nullable(),
  kind: z.enum(['building', 'elsewhere']),
  building: z.string().nullable(),
  floor: z.string().nullable(),
  name: z.string(),
})
const proposedObservation = z.object({
  ref,
  // May be empty while the engineer is still typing; Create all insists on one.
  note: z.string().trim().max(5000),
  copeDimension: z.enum(COPE_DIMENSIONS).nullable(),
  severity: z.enum(SEVERITIES).nullable(),
  locationRef: z.string().nullable(),
  recordingSeq: z.number().int().min(1).nullable(),
  start: seconds,
  end: seconds,
  photoIds: z.array(z.string()),
  // Media added by hand (round 3); the AI step sends none.
  mediaIds: z.array(z.string()).max(50).default([]),
  check: z.object({ severity: z.boolean(), category: z.boolean(), location: z.boolean() }),
})
// The shape of a proposal the engineer saves; parses to the checked proposal.
export const proposalSchema = z.object({
  locations: z.array(proposedLocation).max(200),
  observations: z.array(proposedObservation).max(500),
  // Deleted ones, kept so the engineer can restore them (round 5). Not
  // checked further: Create all never reads them, and a restore re-checks.
  removed: z.array(proposedObservation).max(500).default([]),
})

// The proposal is not valid; the message says which part and why.
export class InvalidProposalError extends InvalidSiteWalkError {}

const duplicates = (values: string[]) => values.find((v, i) => values.indexOf(v) !== i)

// Checks a proposal against the walk and the assessment, and returns it with
// each location's level spelled the standard way. A proposal that fails is
// refused whole, so a saved one is always one Create all can act on.
export function checkProposal(
  input: unknown,
  walk: Pick<StoredWalk, 'photos' | 'recordings' | 'media'>,
  existingLocationIds: string[],
): Proposal {
  const parsed = proposalSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new InvalidProposalError(
      `The proposal is invalid: ${issue.path.join('.')} ${issue.message}.`,
    )
  }
  const proposal = parsed.data
  const fail = (message: string) => {
    throw new InvalidProposalError(`The proposal is invalid: ${message}`)
  }
  const locationRefs = proposal.locations.map((l) => l.ref)
  const observationRefs = proposal.observations.map((o) => o.ref)
  const repeatedLocation = duplicates(locationRefs)
  if (repeatedLocation) fail(`location ${repeatedLocation} appears twice.`)
  const repeatedObservation = duplicates(observationRefs)
  if (repeatedObservation) fail(`observation ${repeatedObservation} appears twice.`)

  const locations = proposal.locations.map((l) => {
    if (l.existingId && !existingLocationIds.includes(l.existingId))
      fail(`${l.ref} is not a location of this assessment.`)
    // Create all reuses a linked location by id, so its saved fields aren't
    // re-checked: without this, an older one with a level but no building
    // would make every save of the review fail.
    if (l.existingId) return l
    if (l.kind === 'elsewhere' && (l.building || l.floor))
      fail(`${l.ref} is elsewhere on site, so it has no building or level.`)
    if (l.kind === 'building' && !l.building?.trim()) fail(`${l.ref} is in a building, so name it.`)
    // The same rules and spelling as a location added by hand.
    const checked = locationSchema.safeParse({
      building: l.building ?? undefined,
      floor: l.floor ?? undefined,
      name: l.name,
    })
    if (!checked.success) fail(`${l.ref}: ${checked.error.issues[0].message}`)
    return {
      ...l,
      building: checked.data!.building ?? null,
      floor: checked.data!.floor ?? null,
      name: checked.data!.name,
    }
  })

  const photoIds = walk.photos.map((p) => p.photoId)
  const seqs = walk.recordings.map((r) => r.seq)
  for (const o of proposal.observations) {
    if (o.locationRef !== null && !locationRefs.includes(o.locationRef))
      fail(`${o.ref} is at ${o.locationRef}, which is not in the proposal.`)
    const unknownPhoto = o.photoIds.find((id) => !photoIds.includes(id))
    if (unknownPhoto) fail(`${o.ref} has a photo that is not part of this walk.`)
    if (o.mediaIds.some((id) => !walk.media?.some((m) => m.mediaId === id)))
      fail(`${o.ref} has media that is not part of this walk.`)
    if (o.recordingSeq !== null && !seqs.includes(o.recordingSeq))
      fail(`${o.ref} comes from recording ${o.recordingSeq}, which this walk does not have.`)
    if (o.start !== null && o.end !== null && o.end < o.start)
      fail(`${o.ref} ends before it starts.`)
  }
  return { locations, observations: proposal.observations, removed: proposal.removed }
}

// Saves the engineer's reviewed proposal, replacing the last one. Only while
// the walk is `ready`, so a save cannot overwrite a proposal being remade.
export async function saveProposal(
  reference: string,
  walkId: string,
  input: unknown,
  user: SessionUser,
) {
  const { assessment, walk } = await loadWalk(reference, walkId, user, true)
  if (walk.status !== 'ready')
    throw new SiteWalkStateError('The proposal can be changed once it is ready to review.')
  if (walk.created)
    throw new SiteWalkStateError(
      'Create all has started, so the proposal can no longer be changed. Run Create all again to finish.',
    )
  const proposal = checkProposal(
    input,
    walk,
    assessment.locations.map((l) => String(l._id)),
  )
  const saved = await SiteWalkModel.findOneAndUpdate(
    { _id: walk._id, status: 'ready', created: { $exists: false } },
    { proposal },
    { returnDocument: 'after' },
  ).lean<StoredWalk>()
  if (!saved)
    throw new SiteWalkStateError('The proposal can be changed once it is ready to review.')
  return toSiteWalkDto(reference, saved)
}

onProposalJob((job, context) => runProposal(job.walkId, context))

// Tells the engineer the walk is ready, then marks it notified. The notification
// is keyed by the walk, so a resend after a crash between the two adds none.
async function notifyReady(walk: StoredWalk) {
  const assessment = await AssessmentModel.findById(walk.assessment, 'reference').lean()
  await createNotification({
    purpose: 'site_walk_ready',
    targetRole: 'risk_engineer',
    targetUserIds: [String(walk.engineerId)],
    message: 'Your site walk proposal is ready to review.',
    context: { reference: assessment!.reference, walkId: String(walk._id) },
  })
  await SiteWalkModel.updateOne({ _id: walk._id }, { notified: true })
}

// What the engineer is told when the reading ran out of retries.
function failureReason(error: unknown): string {
  return error instanceof RagServiceError || error instanceof SpeechServiceError
    ? error.message
    : 'The site walk could not be read. Try again.'
}

// Reads the finished walk and saves its proposal, then tells the engineer.
// 1. Describe each photo not yet described. 2. Send the transcript, in recording
// order whichever finished first, with the photos and existing locations to
// rag-service. 3. Check and save the answer as `ready`. A failure throws so the
// queue retries it; on the last try the walk becomes `failed` with the reason.
export async function runProposal(walkId: string, context: JobContext) {
  const walk = await SiteWalkModel.findById(walkId).lean<StoredWalk>()
  // Ready but not yet notified: a retry or restart after the notification failed.
  if (walk?.status === 'ready' && walk.notified === false) return notifyReady(walk)
  if (!walk || walk.status !== 'proposing') return
  const assessment = await AssessmentModel.findById(
    walk.assessment,
    'reference locations site',
  ).lean()
  if (!assessment) return
  const reportId = assessment.reference
  // The site's name stands in as the building when the walk names levels but no building.
  const site = await SiteModel.findById(assessment.site, 'name').lean()
  try {
    for (const photo of walk.photos) {
      if (photo.description !== undefined) continue
      // On the last try a photo that still can't be described is matched by its
      // time alone; without this, one bad photo would fail the whole walk.
      const description = await describePhoto(photo.key, reportId).catch((error: unknown) => {
        if (!context.isLastAttempt) throw error
        return ''
      })
      photo.description = description
      await SiteWalkModel.updateOne(
        { _id: walk._id, 'photos.photoId': photo.photoId },
        { $set: { 'photos.$.description': description } },
      )
    }
    const recordings = walk.recordings
    const notes = walk.notes ?? []
    const { proposal, usage } = await proposeSiteWalk({
      reportId,
      // Recordings and notes read as one walk, in the order they were made.
      transcript:
        recordings.length || notes.length
          ? {
              kind: 'recordings',
              recordings: [
                ...recordings.map((r) => ({
                  seq: r.seq,
                  durationSec: r.durationSec,
                  // A recording with no timed segments is read as one span.
                  segments: r.transcription.segments.length
                    ? r.transcription.segments
                    : [{ start: 0, end: r.durationSec, text: r.transcription.text ?? '' }],
                })),
                ...notes.map((n) => ({ seq: n.seq, kind: 'typed' as const, text: n.text })),
              ].sort((a, b) => a.seq - b.seq),
            }
          : { kind: 'typed', text: walk.typedText ?? '' },
      existingLocations: (assessment.locations ?? []).map((l) => ({
        id: String(l._id),
        building: l.building ?? null,
        floor: l.floor ?? null,
        name: l.name,
      })),
      photos: walk.photos.map((p) => ({
        id: p.photoId,
        recordingSeq: p.recordingSeq,
        offsetSec: p.offsetSec,
        description: p.description ?? '',
      })),
      siteName: site?.name ?? null,
      privacy: await privacyFor(reportId),
    })
    await recordAiCalls(hyphenated(usage), { reportId })
    const checked = checkProposal(
      proposal,
      walk,
      (assessment.locations ?? []).map((l) => String(l._id)),
    )
    const saved = await SiteWalkModel.findOneAndUpdate(
      { _id: walk._id, status: 'proposing' },
      { proposal: checked, status: 'ready', notified: false, $unset: { error: 1 } },
    ).lean()
    if (saved) await notifyReady(walk)
  } catch (error) {
    if (!context.isLastAttempt) throw error
    console.error('Site walk proposal failed:', error)
    await SiteWalkModel.updateOne(
      { _id: walk._id, status: 'proposing' },
      { status: 'failed', error: failureReason(error) },
    )
  }
}

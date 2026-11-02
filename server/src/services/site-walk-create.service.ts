// Create all (CP-22): turns a reviewed site walk proposal into the assessment's
// locations and observations. Called by routes/site-walk.routes.ts. Calls
// location.service.ts (new locations, with its duplicate rules),
// capture-session.service.ts (the session they are recorded in) and
// observation.service.ts (createWalkObservation).
import { Types } from 'mongoose'
import { ObservationModel } from '../models/observation.model'
import { SiteWalkModel, type ProposedObservation, type Proposal } from '../models/site-walk.model'
import type { SessionUser } from './auth.service'
import { startCaptureSession } from './capture-session.service'
import {
  addLocation,
  DuplicateLocationError,
  locationKey,
  locationSchema,
} from './location.service'
import { createWalkObservation, type WalkEvidence } from './observation.service'
import {
  InvalidSiteWalkError,
  loadWalk,
  SiteWalkStateError,
  type StoredWalk,
} from './site-walk.service'

export type CreatedIds = { locationIds: string[]; observationIds: string[] }

const excerpt = (o: ProposedObservation) =>
  `"${o.note.slice(0, 40)}${o.note.length > 40 ? '...' : ''}"`

// Names every observation that cannot be created yet, and every chosen
// location removed from the assessment since, so the engineer fixes them all in one go.
function problemsIn(proposal: Proposal, locationIds: string[]): string | null {
  const gone = proposal.locations.filter((l) => l.existingId && !locationIds.includes(l.existingId))
  // An observation added by hand may be media alone, as in Add manually.
  const noNote = proposal.observations.filter((o) => !o.note.trim() && !o.mediaIds?.length)
  const noLocation = proposal.observations.filter((o) => !o.locationRef)
  const noSeverity = proposal.observations.filter((o) => !o.severity)
  const parts = [
    gone.length &&
      `These locations are no longer on the assessment: ${gone.map((l) => `"${l.name}"`).join(', ')}. Choose another location for their observations.`,
    noNote.length &&
      `These observations need a note: ${noNote.map((o) => `"${o.ref}"`).join(', ')}.`,
    noLocation.length &&
      `These observations need a location: ${noLocation.map(excerpt).join(', ')}.`,
    noSeverity.length &&
      `These observations need a severity: ${noSeverity.map(excerpt).join(', ')}.`,
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

// The walk's text for the part of a recording an observation came from: the
// segments that overlap it, or all of it when the recording has no segments.
function clipText(walk: StoredWalk, o: ProposedObservation) {
  const recording = walk.recordings.find((r) => r.seq === o.recordingSeq)!
  const { segments } = recording.transcription
  if (!segments.length || o.start === null || o.end === null)
    return recording.transcription.text ?? ''
  return segments
    .filter((s) => s.end > o.start! && s.start < o.end!)
    .map((s) => s.text.trim())
    .join(' ')
}

function evidenceFor(walk: StoredWalk, o: ProposedObservation): WalkEvidence {
  const recording = walk.recordings.find((r) => r.seq === o.recordingSeq)
  // The media added by hand, each in the shape its kind is stored in.
  const added = (o.mediaIds ?? []).map((id) => walk.media!.find((m) => m.mediaId === id)!)
  const image = (m: (typeof added)[number]) => ({
    key: m.key,
    contentType: m.contentType as 'image/jpeg' | 'image/png',
    size: m.size,
  })
  return {
    clip: recording
      ? {
          siteWalk: walk._id,
          seq: recording.seq,
          key: recording.key,
          contentType: recording.contentType,
          size: recording.size,
          start: o.start ?? 0,
          end: o.end ?? recording.durationSec,
          text: clipText(walk, o),
        }
      : null,
    photos: [
      ...o.photoIds.map((id) => walk.photos.find((p) => p.photoId === id)!),
      ...added.filter((m) => m.kind === 'photo').map((m) => ({ photoId: m.mediaId, ...image(m) })),
    ],
    voices: added
      .filter((m) => m.kind === 'voice')
      .map((m) => ({
        key: m.key,
        contentType: m.contentType,
        size: m.size,
        transcript: m.transcription?.status === 'transcribed' ? (m.transcription.text ?? '') : null,
      })),
    pages: added.filter((m) => m.kind === 'page').map(image),
  }
}

// Marks Create all started, which locks the proposal against saves, and
// returns the walk as locked: creating from this copy means a save that landed
// just before cannot be missed. A repeat (or a second tap) finds it locked already.
async function lock(walk: StoredWalk) {
  const locked = await SiteWalkModel.findOneAndUpdate(
    { _id: walk._id, status: 'ready', created: { $exists: false } },
    { $set: { created: { observationIds: {}, locationIds: {} } } },
    { returnDocument: 'after' },
  ).lean<StoredWalk>()
  return locked ?? (await SiteWalkModel.findById(walk._id).lean<StoredWalk>())!
}

// Chooses every observation's id before anything is created and keeps them on
// the walk. A repeat after a crash then reuses the same ids, so nothing is
// created twice.
async function planOf(walk: StoredWalk, proposal: Proposal) {
  // Each observation gets an id once, even if the proposal gained one since a
  // first attempt stopped half way.
  for (const o of proposal.observations) {
    const field = `created.observationIds.${o.ref}`
    await SiteWalkModel.updateOne(
      { _id: walk._id, [field]: { $exists: false } },
      { $set: { [field]: new Types.ObjectId() } },
    )
  }
  return (await SiteWalkModel.findById(walk._id).lean<StoredWalk>())!.created!
}

const idsOf = (walk: StoredWalk, proposal: Proposal): CreatedIds => ({
  locationIds: proposal.locations
    .filter((l) => !l.existingId)
    .map((l) => String(walk.created!.locationIds[l.ref])),
  observationIds: proposal.observations.map((o) => String(walk.created!.observationIds[o.ref])),
})

/**
 * Adds a ready walk's new locations, then its observations, to the assessment,
 * and marks the walk `created`. Repeating it returns the same ids and creates
 * nothing again. Every observation needs a location and a severity first (400).
 * Returns the ids of the new locations and of the observations, in proposal order.
 */
export async function createAll(
  reference: string,
  walkId: string,
  user: SessionUser,
): Promise<CreatedIds> {
  const loaded = await loadWalk(reference, walkId, user, true)
  const { assessment } = loaded

  // a. Lock the proposal and check the locked copy.
  const walk = loaded.walk.status === 'ready' ? await lock(loaded.walk) : loaded.walk
  const proposal = walk.proposal
  if (walk.status === 'created' && proposal) return idsOf(walk, proposal)
  if (walk.status !== 'ready' || !proposal)
    throw new SiteWalkStateError('Create all is available once the proposal is ready.')
  const problems = problemsIn(
    proposal,
    assessment.locations.map((l) => String(l._id)),
  )
  if (problems) {
    // Unlock when none of the planned observations exist yet, so the engineer
    // can fix the proposal. Without this, a failure after the ids were planned
    // but before anything was created would leave the walk locked for good.
    // Keep the lock once any exists, so a repeat never creates twice.
    const planned = Object.values(walk.created?.observationIds ?? {})
    if (!planned.length || !(await ObservationModel.exists({ _id: { $in: planned } })))
      await SiteWalkModel.updateOne({ _id: walk._id }, { $unset: { created: 1 } })
    throw new InvalidSiteWalkError(problems)
  }

  // b. Choose the ids.
  const plan = await planOf(walk, proposal)

  // c. New locations. One that is on the list already (a repeat, or the same
  // place added meanwhile) is found by its key instead of added again.
  const locationOf: Record<string, Types.ObjectId> = {}
  for (const l of proposal.locations) {
    if (l.existingId) {
      locationOf[l.ref] = new Types.ObjectId(l.existingId)
      continue
    }
    // A repeat reuses the location the first attempt stored, if it is still on
    // the list. Without this, a rename in between would add a duplicate and
    // split the walk's observations across two locations.
    const stored = walk.created?.locationIds?.[l.ref]
    if (stored && assessment.locations.some((x) => String(x._id) === String(stored))) {
      locationOf[l.ref] = new Types.ObjectId(String(stored))
      continue
    }
    const details = locationSchema.parse({
      building: l.building ?? undefined,
      floor: l.floor ?? undefined,
      name: l.name,
    })
    let id: string
    try {
      id = (await addLocation(reference, details)).id
    } catch (error) {
      if (!(error instanceof DuplicateLocationError)) throw error
      const key = locationKey(details.name, details.floor, details.building)
      const listed = (await loadWalk(reference, walkId, user, true)).assessment.locations
      id = String(listed.find((x) => x.key === key)!._id)
    }
    locationOf[l.ref] = new Types.ObjectId(id)
    await SiteWalkModel.updateOne(
      { _id: walk._id },
      { $set: { [`created.locationIds.${l.ref}`]: locationOf[l.ref] } },
    )
  }

  // d. Observations, in the capture session (started if there is none).
  const { session } = await startCaptureSession(reference)
  for (const o of proposal.observations) {
    await createWalkObservation({
      reference,
      id: plan.observationIds[o.ref],
      assessmentId: assessment._id,
      sessionId: new Types.ObjectId(session.id),
      site: assessment.site,
      user,
      locationId: locationOf[o.locationRef!],
      note: o.note,
      severity: o.severity!,
      copeDimensions: o.copeDimension ? [o.copeDimension] : null,
      evidence: evidenceFor(walk, o),
      siteWalk: walk._id,
    })
  }

  // e. Done.
  const done = await SiteWalkModel.findOneAndUpdate(
    { _id: walk._id },
    { status: 'created' },
    { returnDocument: 'after' },
  ).lean<StoredWalk>()
  return idsOf(done!, proposal)
}

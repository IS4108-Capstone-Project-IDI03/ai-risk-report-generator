// The proposal's Add observation (CP-22 round 3) reuses the Add manually
// screen. screens/Review.tsx calls openProposalCapture; useAssessmentWorkflow
// opens capture on it and, on Save, calls addCapturedObservation, which
// uploads the media to the walk and adds the observation to the proposal.
import type { SiteLocation } from '../assessments/api'
import { getWalk, saveProposal, uploadProposalMedia, type Cope, type Severity } from './api'
import * as edit from './proposal'

// What capture needs: the walk, and the locations it may pick from (the
// proposal's, under their refs, and the assessment's others, under their ids).
export type ProposalCaptureTarget = {
  reference: string
  walkId: string
  locations: SiteLocation[]
  locationId: string | null
}

// Kept outside React, like siteWalkReview, so the workflow hears it whatever is mounted.
export const proposalCapture = { event: 'site-walk-capture' }

/** Asks the workflow to open the Add manually screen for this proposal. */
export function openProposalCapture(target: ProposalCaptureTarget) {
  window.dispatchEvent(new CustomEvent(proposalCapture.event, { detail: target }))
}

export type CapturedObservation = {
  locationId: string
  note: string
  copeDimension: Cope | null
  severity: Severity | null
  clips: Blob[]
  photos: Blob[]
  pages: Blob[]
}

// Each file's upload id, so a retried Save sends the same ids and the walk keeps one copy.
const ids = new WeakMap<Blob, string>()
const idOf = (file: Blob) => {
  if (!ids.has(file)) ids.set(file, crypto.randomUUID())
  return ids.get(file)!
}

/**
 * Uploads the captured media to the walk, then adds the observation to the
 * latest saved proposal (an assessment location joins it, linked). Returns the
 * new observation's ref. Throws when an upload or the save fails.
 */
export async function addCapturedObservation(
  target: ProposalCaptureTarget,
  c: CapturedObservation,
): Promise<string> {
  const { reference, walkId } = target
  // a. The files, one at a time; each repeat is a no-op on the server.
  const files = [
    ...c.clips.map((file) => ({ kind: 'voice' as const, file })),
    ...c.photos.map((file) => ({ kind: 'photo' as const, file })),
    ...c.pages.map((file) => ({ kind: 'page' as const, file })),
  ]
  for (const { kind, file } of files)
    await uploadProposalMedia(reference, walkId, idOf(file), kind, file)

  // b. The proposal as saved now, with the location the observation is at.
  let proposal = (await getWalk(reference, walkId)).proposal!
  let locationRef = c.locationId
  if (!proposal.locations.some((l) => l.ref === locationRef)) {
    const existing = target.locations.find((l) => l.id === c.locationId)!
    const linked = proposal.locations.find((l) => l.existingId === existing.id)
    if (linked) locationRef = linked.ref
    else {
      const added = edit.addLocation(
        proposal,
        {
          kind: existing.building || existing.floor ? 'building' : 'elsewhere',
          building: existing.building ?? '',
          floor: existing.floor ?? '',
          name: existing.name,
        },
        [existing],
      )
      proposal = added.proposal
      locationRef = added.location.ref
    }
  }

  // c. The observation itself, then the whole proposal saved.
  const { observation } = edit.addObservation(proposal, {
    note: c.note,
    copeDimension: c.copeDimension,
    severity: c.severity,
    locationRef,
  })
  const added = { ...observation, mediaIds: files.map((f) => idOf(f.file)) }
  await saveProposal(reference, walkId, {
    ...proposal,
    observations: [...proposal.observations, added],
  })
  return added.ref
}

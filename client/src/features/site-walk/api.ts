// Gateway calls for site walks (CP-22). Shapes must match
// .local-docs/specs/sprint-4/CP-22-contract.md and server/src/routes/site-walk.routes.ts.
// Called by the Recording and Review screens and the pending-upload store.
import { request } from '../assessments/api'

export type Severity = 'critical' | 'high' | 'moderate' | 'low'
export type Cope = 'Construction' | 'Occupancy' | 'Protection' | 'Exposure'
export type WalkStatus = 'recording' | 'transcribing' | 'proposing' | 'ready' | 'failed' | 'created'

export type ProposedLocation = {
  ref: string
  // Set when it is one of the assessment's locations already.
  existingId: string | null
  kind: 'building' | 'elsewhere'
  building: string | null
  // null is the whole building (or elsewhere on site).
  floor: string | null
  name: string
}

export type ProposedObservation = {
  ref: string
  note: string
  copeDimension: Cope | null
  severity: Severity | null
  // null: the AI found no clear place, so the engineer must choose one.
  locationRef: string | null
  recordingSeq: number | null
  start: number | null
  end: number | null
  photoIds: string[]
  // Photos, pages and voice clips added by hand (SiteWalk.media ids); absent on older proposals.
  mediaIds?: string[]
  // Jev was unsure (confidence under 0.70), so the screen hints "Check".
  check: { severity: boolean; category: boolean; location: boolean }
}

export type Proposal = {
  locations: ProposedLocation[]
  observations: ProposedObservation[]
  // Deleted ones, newest first, kept to restore (round 5); Create all leaves them out.
  removed?: ProposedObservation[]
}

export type SiteWalk = {
  id: string
  status: WalkStatus
  // The engineer's name for the walk, given at Finish walk; null on older walks.
  name: string | null
  createdAt: string
  recordings: {
    seq: number
    durationSec: number
    transcription: 'queued' | 'transcribing' | 'transcribed' | 'failed'
    // The text once transcribed, and the URL that plays the audio (supports Range).
    transcript: string | null
    audioUrl: string
  }[]
  photos: { id: string; url: string; recordingSeq: number | null; offsetSec: number | null }[]
  // Typed notes share seq numbers with recordings; the list reads in seq order.
  notes: { seq: number; text: string }[]
  // Only on walks made before notes existed: read only, no new writes.
  typedText: string | null
  proposal: Proposal | null
  error: string | null
  // Added to the proposal by hand (round 3); a voice clip's transcript once done.
  media?: {
    id: string
    kind: 'photo' | 'page' | 'voice'
    url: string
    transcription: 'queued' | 'transcribing' | 'transcribed' | 'failed' | null
    transcript: string | null
  }[]
}

const walksPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/site-walks`
const walkPath = (reference: string, walkId: string) =>
  `${walksPath(reference)}/${encodeURIComponent(walkId)}`

// The engineer's walk still being recorded on this assessment, or a new one.
export async function startWalk(reference: string): Promise<SiteWalk> {
  return (await request<SiteWalk>('POST', walksPath(reference))).data
}

// The assessment's walks not yet created, newest first.
export async function listWalks(reference: string, signal?: AbortSignal): Promise<SiteWalk[]> {
  return (await request<SiteWalk[]>('GET', walksPath(reference), undefined, signal)).data
}

// One walk, with its proposal once it is ready.
export async function getWalk(
  reference: string,
  walkId: string,
  signal?: AbortSignal,
): Promise<SiteWalk> {
  return (await request<SiteWalk>('GET', walkPath(reference, walkId), undefined, signal)).data
}

// Sends one finished recording; a repeat of the same seq changes nothing.
export async function uploadRecording(
  reference: string,
  walkId: string,
  seq: number,
  audio: Blob,
  durationSec: number,
  // An uploaded file's own name; a recorded clip has none and is named by its seq.
  name?: string,
): Promise<SiteWalk> {
  const form = new FormData()
  form.append(
    'recording',
    audio,
    name ?? `recording-${seq}.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`,
  )
  form.append('durationSec', String(durationSec))
  const path = `${walkPath(reference, walkId)}/recordings/${seq}`
  return (await request<SiteWalk>('PUT', path, form)).data
}

// Puts a failed recording back to transcribing; any other state returns the walk unchanged.
export async function retryRecording(reference: string, walkId: string, seq: number) {
  const path = `${walkPath(reference, walkId)}/recordings/${seq}/retry`
  return (await request<SiteWalk>('POST', path)).data
}

// Removes one recording and its stored file; already gone returns the walk unchanged.
export async function deleteRecording(reference: string, walkId: string, seq: number) {
  const path = `${walkPath(reference, walkId)}/recordings/${seq}`
  return (await request<SiteWalk>('DELETE', path)).data
}

// Removes one photo and its stored file; already gone returns the walk unchanged.
export async function deletePhoto(reference: string, walkId: string, photoId: string) {
  const path = `${walkPath(reference, walkId)}/photos/${encodeURIComponent(photoId)}`
  return (await request<SiteWalk>('DELETE', path)).data
}

// Sends one photo under the client's own id; a repeat changes nothing.
export async function uploadPhoto(
  reference: string,
  walkId: string,
  photoId: string,
  image: Blob,
  recordingSeq: number | null,
  offsetSec: number | null,
): Promise<SiteWalk> {
  const form = new FormData()
  form.append('photo', image, `${photoId}.jpg`)
  if (recordingSeq !== null) form.append('recordingSeq', String(recordingSeq))
  if (offsetSec !== null) form.append('offsetSec', String(offsetSec))
  const path = `${walkPath(reference, walkId)}/photos/${encodeURIComponent(photoId)}`
  return (await request<SiteWalk>('PUT', path, form)).data
}

// Sends one photo, handwritten page or voice clip added to the proposal by hand,
// under the client's own id; a repeat changes nothing.
export async function uploadProposalMedia(
  reference: string,
  walkId: string,
  mediaId: string,
  kind: 'photo' | 'page' | 'voice',
  file: Blob,
): Promise<SiteWalk> {
  const form = new FormData()
  // must match the part names in server/src/routes/media-form.ts
  form.append(kind === 'voice' ? 'recording' : kind, file, mediaId)
  const path = `${walkPath(reference, walkId)}/media/${encodeURIComponent(mediaId)}`
  return (await request<SiteWalk>('PUT', path, form)).data
}

// Saves one typed note under its seq (shared with recordings); blank text removes it.
export async function saveNote(reference: string, walkId: string, seq: number, text: string) {
  const path = `${walkPath(reference, walkId)}/notes/${seq}`
  return (await request<SiteWalk>('PUT', path, { text })).data
}

// Ends the walk under the engineer's name for it: transcription and the AI step run in the background.
export async function finishWalk(
  reference: string,
  walkId: string,
  name: string,
): Promise<SiteWalk> {
  return (await request<SiteWalk>('POST', `${walkPath(reference, walkId)}/finish`, { name })).data
}

// Renames a walk, whatever its state.
export async function renameWalk(
  reference: string,
  walkId: string,
  name: string,
): Promise<SiteWalk> {
  return (await request<SiteWalk>('PUT', `${walkPath(reference, walkId)}/name`, { name })).data
}

// Re-runs a walk whose proposal step failed.
export async function retryWalk(reference: string, walkId: string): Promise<SiteWalk> {
  return (await request<SiteWalk>('POST', `${walkPath(reference, walkId)}/retry`)).data
}

// Replaces the whole proposal with the engineer's edits.
export async function saveProposal(reference: string, walkId: string, proposal: Proposal) {
  return (await request<SiteWalk>('PUT', `${walkPath(reference, walkId)}/proposal`, proposal)).data
}

// Adds every proposed location and observation to the assessment, once.
export async function createAll(
  reference: string,
  walkId: string,
): Promise<{ locationIds: string[]; observationIds: string[] }> {
  const path = `${walkPath(reference, walkId)}/create`
  return (await request<{ locationIds: string[]; observationIds: string[] }>('POST', path)).data
}

// Throws a walk away before it is created.
export async function discardWalk(reference: string, walkId: string): Promise<void> {
  await request<void>('DELETE', walkPath(reference, walkId))
}

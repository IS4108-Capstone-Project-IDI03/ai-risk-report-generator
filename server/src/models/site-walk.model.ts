// A site walk (CP-22): one engineer's recorded and typed walk of a site, from the
// recordings and photos they send to the reviewed proposal and the ids Create all
// made. Written by services/site-walk*.service.ts. Read by routes/site-walk.routes.ts.
import { Schema, Types, model } from 'mongoose'
import type { CopeDimension, Severity } from './observation.model'

// recording -> transcribing (after Finish walk) -> proposing -> ready -> created;
// failed when a step ran out of retries (the walk's `error` says which).
export const WALK_STATUSES = [
  'recording',
  'transcribing',
  'proposing',
  'ready',
  'failed',
  'created',
] as const
export type WalkStatus = (typeof WALK_STATUSES)[number]

export const RECORDING_TRANSCRIPTIONS = ['queued', 'transcribing', 'transcribed', 'failed'] as const
export type RecordingTranscription = (typeof RECORDING_TRANSCRIPTIONS)[number]

export interface IWalkSegment {
  start: number
  end: number
  text: string
}

export interface IWalkRecording {
  seq: number
  key: string
  contentType: string
  size: number
  durationSec: number
  transcription: {
    status: RecordingTranscription
    text?: string
    segments: IWalkSegment[]
    error?: string
  }
}

// A typed note, in the same numbering as the walk's recordings (`seq` is shared).
export interface IWalkNote {
  seq: number
  text: string
}

export interface IWalkPhoto {
  // The client's UUID, so a repeated upload is recognised.
  photoId: string
  key: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  recordingSeq: number | null
  offsetSec: number | null
  // S5's reading of the photo, set while the proposal is made.
  description?: string
}

// A photo, handwritten page or voice clip the engineer added to the proposal by
// hand (round 3), through the same screen as Add manually. Kept with the walk
// until Create all puts it on its observation; a voice clip is transcribed in
// the background like the walk's recordings, a page only once created.
export interface IWalkMedia {
  // The client's UUID, so a repeated upload is recognised.
  mediaId: string
  kind: 'photo' | 'page' | 'voice'
  key: string
  contentType: string
  size: number
  // Voice clips only.
  transcription?: { status: RecordingTranscription; text?: string; error?: string }
}

export type ProposedLocation = {
  ref: string
  existingId: string | null
  kind: 'building' | 'elsewhere'
  building: string | null
  floor: string | null
  name: string
}
export type ProposedObservation = {
  ref: string
  note: string
  copeDimension: CopeDimension | null
  severity: Severity | null
  locationRef: string | null
  recordingSeq: number | null
  start: number | null
  end: number | null
  photoIds: string[]
  // Media added by hand (IWalkMedia ids); missing on proposals saved before round 3.
  mediaIds?: string[]
  check: { severity: boolean; category: boolean; location: boolean }
}
export type Proposal = {
  locations: ProposedLocation[]
  observations: ProposedObservation[]
  // Deleted by the engineer, kept to restore (round 5); Create all ignores them.
  removed?: ProposedObservation[]
}

export interface ISiteWalk {
  assessment: Types.ObjectId
  engineerId: Types.ObjectId
  status: WalkStatus
  // The engineer's name for the walk, given at Finish walk (round 3); null on older walks.
  name?: string | null
  recordings: IWalkRecording[]
  notes: IWalkNote[]
  photos: IWalkPhoto[]
  // Missing on walks saved before round 3.
  media?: IWalkMedia[]
  // Walks made before notes existed; read only, no new writes.
  typedText: string | null
  // Replaced whole on each save; validated by proposalSchema before it gets here.
  proposal: Proposal | null
  // Plain-English reason when status = 'failed'.
  error?: string
  // false from `ready` until its notification is sent; restarts send it then.
  notified?: boolean
  // What Create all made, kept so a repeat creates nothing twice: the ids are
  // chosen before anything is created, and filled in as each is.
  created?: {
    observationIds: Record<string, Types.ObjectId>
    locationIds: Record<string, Types.ObjectId>
  }
  metadata: {
    source_type: 'site_walk'
    jurisdiction: string
    facility_type: string
    COPE_dimension: null
    effective_date: Date
  }
  createdAt: Date
  updatedAt: Date
}

const siteWalkSchema = new Schema<ISiteWalk>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    engineerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: WALK_STATUSES, required: true, default: 'recording' },
    name: { type: String, trim: true, default: null },
    recordings: [
      {
        _id: false,
        seq: { type: Number, required: true },
        key: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true },
        durationSec: { type: Number, required: true },
        transcription: {
          status: { type: String, enum: RECORDING_TRANSCRIPTIONS, required: true },
          text: String,
          segments: [{ _id: false, start: Number, end: Number, text: String }],
          error: String,
        },
      },
    ],
    notes: [
      { _id: false, seq: { type: Number, required: true }, text: { type: String, required: true } },
    ],
    photos: [
      {
        _id: false,
        photoId: { type: String, required: true },
        key: { type: String, required: true },
        contentType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
        size: { type: Number, required: true },
        recordingSeq: { type: Number, default: null },
        offsetSec: { type: Number, default: null },
        description: String,
      },
    ],
    media: [
      {
        _id: false,
        mediaId: { type: String, required: true },
        kind: { type: String, enum: ['photo', 'page', 'voice'], required: true },
        key: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true },
        transcription: {
          type: {
            _id: false,
            status: { type: String, enum: RECORDING_TRANSCRIPTIONS },
            text: String,
            error: String,
          },
          default: undefined,
        },
      },
    ],
    typedText: { type: String, default: null },
    proposal: { type: Schema.Types.Mixed, default: null },
    error: String,
    notified: Boolean,
    created: { type: Schema.Types.Mixed },
    metadata: {
      source_type: { type: String, enum: ['site_walk'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      COPE_dimension: { type: Schema.Types.Mixed, default: null },
      effective_date: { type: Date, required: true },
    },
  },
  { timestamps: true, collection: 'site_walks', minimize: false },
)

// One walk in progress per engineer and assessment, enforced by the database so
// two taps on Record site walk cannot start two.
siteWalkSchema.index(
  { assessment: 1, engineerId: 1 },
  { unique: true, partialFilterExpression: { status: 'recording' } },
)

export const SiteWalkModel = model<ISiteWalk>('SiteWalk', siteWalkSchema)

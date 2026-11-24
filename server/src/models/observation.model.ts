import { Schema, Types, model } from 'mongoose'

// A recording's transcription. Saving a recording starts exactly one attempt
// (CP-03 AC3); a retry after a failure adds another for the same audio.
export const TRANSCRIPTION_STATUSES = ['transcribing', 'transcribed', 'failed'] as const
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number]

// The same values the knowledge base tags its chunks with, so retrieval can
// filter observations and documents alike.
export const COPE_DIMENSIONS = ['Construction', 'Occupancy', 'Protection', 'Exposure'] as const
export type CopeDimension = (typeof COPE_DIMENSIONS)[number]

// An observation's COPE categories as stored: an engineer can file one finding
// under several, and null means none yet (CP-02 AC4), never []. Observations
// saved before multiple categories hold one string, which this reads as a list
// of one, so nothing needs migrating before it can be read.
export function copeDimensionsOf(
  stored: CopeDimension | readonly CopeDimension[] | null | undefined,
): CopeDimension[] | null {
  if (!stored) return null
  const list = typeof stored === 'string' ? [stored] : [...stored]
  return list.length ? list : null
}

export const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

// Who changed or deleted an observation, and when (CP-08). `by` is the
// signed-in user as they were then, so a later rename doesn't rewrite it.
export interface IStamp {
  at: Date
  by: { id: string; name: string }
}

export interface IRecording {
  _id: Types.ObjectId
  // "Recording 2", or the uploaded file's own name.
  name: string
  // The original recording in S3, kept as raw evidence. MongoDB holds only its key.
  key: string
  contentType: string
  size: number
  transcription: {
    status: TranscriptionStatus
    // What was said, tidied by S5 (CP-27): fillers, stumbles and taken-back
    // words deleted, nothing reworded. Everything that reads a transcript reads
    // this. Before CP-27 it was Whisper's text as it came.
    transcript?: string
    // Whisper's text as it came, kept as evidence of what was said (CP-27).
    // Absent for a recording transcribed before CP-27, whose `transcript` is it.
    spoken?: string
    // Why the latest attempt failed, shown to the engineer.
    error?: string
    attempts: { startedAt: Date; finishedAt?: Date; error?: string }[]
    // The engineer's correction of `transcript` (CP-08). `transcript` and
    // `spoken` stay as S5 wrote them; drafting uses this.
    correction?: IStamp & { text: string }
  }
  // Who added it to the observation after it was saved, and when (CP-08);
  // absent for one captured with it.
  added?: IStamp
  // Present only while it is removed (CP-08), a soft removal: the audio stays
  // in S3 and restoring removes this. A removed recording is not evidence.
  removed?: IStamp
  // Set when `key` is a site walk's recording (CP-22) and this observation is
  // the part from `start` to `end` seconds; the page plays it with #t=start,end.
  clip?: { siteWalk: Types.ObjectId; start: number; end: number }
}

// A photographed page of the engineer's handwritten notes (CP-19), JPG or PNG.
// Like a recording, saving it starts exactly one transcription attempt, and a
// retry after a failure adds another for the same page. It is not a site photo:
// the photo collection, the photo appendix and photo reading leave it out.
export interface IPage {
  _id: Types.ObjectId
  // "Page 2", or the uploaded file's own name.
  name: string
  // The original photo in S3, kept as raw evidence and never altered.
  key: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  transcription: {
    status: TranscriptionStatus
    // The handwriting word for word; '' when the page has none.
    transcript?: string
    // The words the model was unsure of, as [start, end) positions in
    // `transcript`, counted in UTF-16 units as the browser counts them.
    uncertain?: [number, number][]
    // Why the latest attempt failed, shown to the engineer.
    error?: string
    attempts: { startedAt: Date; finishedAt?: Date; error?: string }[]
    // What wrote the transcript, set when it is saved.
    provenance?: { provider: string; model: string; promptVersion: string }
    // The engineer's correction of `transcript` (CP-20), as for a recording's
    // (CP-08): `transcript` stays as the model wrote it, as evidence of what it
    // read, and drafting uses this. Transcribing the page again drops it.
    correction?: IStamp & { text: string }
  }
  // As for a recording (CP-20): who added it after the observation was saved,
  // and its removal, a soft one that keeps the photo in S3.
  added?: IStamp
  removed?: IStamp
}

// A site photograph (CP-04), JPG or PNG. Each is its own entry so an
// annotation (CP-10) can attach to one photo.
export interface IPhoto {
  _id: Types.ObjectId
  // The uploaded file's own name, or "Photo 2".
  name: string
  // The original image in S3, kept as raw evidence and never altered.
  key: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  // As for a recording (CP-08): who added it after saving, and its removal.
  added?: IStamp
  removed?: IStamp
  // How the photo last went to the model with protection on (PV-04).
  redaction?: IPhotoRedaction
  // The area the engineer marked as what matters (CP-10), drawn over the photo
  // where it is shown. The image in S3 is never changed.
  region?: IPhotoRegion
}

// A rectangle on a photo (CP-10), as fractions of the upright image's width
// and height, so it holds at any size: `x` and `y` are its top-left corner.
export interface IPhotoRegion {
  x: number
  y: number
  w: number
  h: number
}

// A photo as the model last saw it with protection on (PV-04): the faces
// blurred, and the copy in S3 (`key`, beside the original, which is never
// changed), or a `key` of null when it had no face and went out as taken.
export interface IPhotoRedaction {
  key: string | null
  faces: number
  size?: number
  at: Date
}

// Where describing an observation's photos stands (CP-05). Since CP-24 the
// reading job describes them without asking; each start is one attempt.
export const INTERPRETATION_STATUSES = ['interpreting', 'interpreted', 'failed'] as const
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number]

// What wrote a reading and the tokens it took (EV-03); usage is null when the
// provider reports none.
export interface IReadingProvenance {
  provider: string
  model: string
  promptVersion: string
  usage: { inputTokens: number; outputTokens: number | null; thoughtTokens: number | null } | null
  // Whether client details were masked and faces blurred before the model saw
  // them, and how many (PV-04). Never the details. Absent before PV-04.
  // removedFromAnswer: details the AI added to its answer (a name read off a
  // photo) that were taken out; absent before the answer check.
  privacy?: {
    enabled: boolean
    maskedCount: number
    facesBlurred: number
    removedFromAnswer?: number
  }
  interpretedAt: Date
}

// The photos' part of a reading (CP-21): their description and hazard type,
// read again apart from the categories, with its own status and attempts.
export interface IPhotoReading {
  status: InterpretationStatus
  description?: string
  // One of S5's hazard types, e.g. "Housekeeping" or "No hazard visible".
  hazardType?: string
  error?: string
  attempts: { startedAt: Date; finishedAt?: Date; error?: string }[]
  // The photos the latest attempt describes; once photos are added or removed,
  // a finished description of a different set is out of date.
  photoIds: Types.ObjectId[]
  // The marks on those photos when the latest attempt started (CP-10): once one
  // is moved, added or cleared, the model saw something else, so a finished
  // description is out of date. Absent on readings from before CP-10, which
  // read every photo unmarked.
  marks?: { photo: Types.ObjectId; region: IPhotoRegion }[]
  provenance?: IReadingProvenance
}

// The photos' description (CP-05, CP-21), kept in `photoReading`. Readings
// from before CP-24 also proposed categories here (`categories`, `items`,
// `copeDimension`); those stay stored but nothing reads them any more (CP-24).
// A reading from before CP-21 kept the description on this record, with its
// status, attempts and photos; it is read as the photos' part until they are
// described again.
export interface IInterpretation {
  // The photos' part (CP-21); absent until photos are first described.
  photoReading?: IPhotoReading
  status?: InterpretationStatus
  description?: string
  hazardType?: string
  attempts?: { startedAt: Date; finishedAt?: Date; error?: string }[]
  // The photos a pre-CP-21 reading read; absent before photos could change.
  photoIds?: Types.ObjectId[]
  provenance?: IReadingProvenance
}

// Where suggesting an observation's category and severity stands (CP-24):
// reading while the job is queued, running or waiting for transcripts and the
// photo description; done; failed once two tries failed or masking was
// unavailable.
export const SUGGESTION_STATUSES = ['reading', 'done', 'failed'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

// The AI's suggestions on an observation (CP-24). A field's entry is present
// while its value is an unconfirmed suggestion, with whether the classifier
// was not sure; null once the engineer chose, changed or confirmed it (then
// the value is theirs and is never suggested again), or while it is empty.
export interface ISuggestion {
  status: SuggestionStatus
  // Why the latest run failed, shown to the engineer.
  error?: string
  // Rating calls made in the latest run: two failed ones make it failed.
  attempts: number
  category: { notSure: boolean } | null
  severity: { notSure: boolean } | null
  // Bumped by every trigger (save, media, a transcript, Try again). A job
  // writes only while the stored number is still its own, so a trigger that
  // arrives while one runs is never lost and an older run never writes last.
  run: number
  // false on an observation created from a site walk until the engineer first
  // changes it: its photos are described but its values, carried from the
  // proposal, are not rated again (AC17). Absent means true.
  rate?: boolean
}

// How the engineer answered a checklist item on site (CP-31): as the
// checklist expected, or different, recorded in the observation's own words.
export const CHECK_RESULTS = ['confirmed', 'differs'] as const
export type CheckResult = (typeof CHECK_RESULTS)[number]

// The checklist item an observation checks (CP-31), with the item's text as it
// was then, so the observation still reads right after the checklist is
// regenerated. An item is checked while an observation not deleted links to it.
export interface IChecklistLink {
  checklist: Types.ObjectId
  item: Types.ObjectId
  result: CheckResult
  text: string
}

// What an observation is, as the engineer tagged it (CP-36). It can be more than one, e.g. a
// finding with advice is a fact and a recommendation. No tag means Fact. Kept outside `metadata`.
export const OBSERVATION_KINDS = ['fact', 'info_request', 'recommendation'] as const
export type ObservationKind = (typeof OBSERVATION_KINDS)[number]

// One thing the engineer saw on site, with everything captured about it: a
// note (CP-02), any number of recordings (CP-03), photographs (CP-04) and
// handwritten pages (CP-19).
export interface IObservation {
  assessment: Types.ObjectId
  session: Types.ObjectId
  // Display name at capture time; legacy records may lack a verified engineerId.
  engineer: string
  engineerId?: Types.ObjectId
  // Exactly as the engineer wrote it, never trimmed or reworded.
  note?: string
  // The engineer's tags (CP-36); absent means Fact. Never empty when present.
  kinds?: ObservationKind[]
  recordings: IRecording[]
  // Absent on observations saved before CP-04.
  photos?: IPhoto[]
  // Absent on observations saved before CP-19.
  pages?: IPage[]
  // Present once its photos were first described (CP-05).
  interpretation?: IInterpretation
  // Present once it was first read for suggestions (CP-24), or created from a
  // site walk with a not-sure value.
  suggestion?: ISuggestion
  // The standard the engineer tied the finding to, if any. The draft finds the
  // clause itself, so only the standard is recorded.
  standard?: string
  // How serious it is; null while empty (CP-24: the engineer may leave it
  // for the AI to suggest).
  severity?: Severity | null
  // Where on site: one of the assessment's locations, by its _id. Absent only
  // on a draft observation.
  location?: Types.ObjectId
  // Present only on a draft observation (CP-24): a hidden one holding the
  // recordings made on New Observation before Save, so they can transcribe.
  // Lists, counts, drafting and the report never read one; Save clears this,
  // and a cleanup deletes one left over 24 hours with its files.
  draft?: true
  // Present when it was saved from the checklist (CP-31).
  checklistItem?: IChecklistLink
  // The site walk whose proposal created it (CP-22 round 3).
  siteWalk?: Types.ObjectId
  // Required on every document (see CLAUDE.md). The COPE dimension holds the
  // categories the engineer picks when capturing, one or more; null means not
  // categorised yet (CP-02 AC4). Read it through copeDimensionsOf, since older
  // observations hold a single string.
  metadata: {
    source_type: 'observation'
    jurisdiction: string
    facility_type: string
    COPE_dimension: CopeDimension[] | null
    effective_date: Date
  }
  // The latest change to its tags, note, a transcript, or its recordings and
  // photos (CP-08).
  edited?: IStamp
  // Present only while it is deleted (CP-08), a soft delete: nothing is
  // removed, so drafts that cite it stay traceable, and restoring removes this.
  deleted?: IStamp
  createdAt: Date
  updatedAt: Date
}

const stampFields = {
  at: { type: Date, required: true },
  by: {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
}
const stampSchema = new Schema<IStamp>(stampFields, { _id: false })

const recordingSchema = new Schema<IRecording>({
  name: { type: String, required: true },
  key: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  transcription: {
    status: { type: String, enum: TRANSCRIPTION_STATUSES, required: true },
    transcript: String,
    spoken: String,
    error: String,
    attempts: [
      { _id: false, startedAt: { type: Date, required: true }, finishedAt: Date, error: String },
    ],
    correction: {
      type: new Schema({ text: { type: String, required: true }, ...stampFields }, { _id: false }),
    },
  },
  added: { type: stampSchema },
  removed: { type: stampSchema },
  clip: {
    type: new Schema(
      {
        siteWalk: { type: Schema.Types.ObjectId, required: true },
        start: { type: Number, required: true },
        end: { type: Number, required: true },
      },
      { _id: false },
    ),
  },
})

const pageSchema = new Schema<IPage>({
  name: { type: String, required: true },
  key: { type: String, required: true },
  contentType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
  size: { type: Number, required: true },
  transcription: {
    status: { type: String, enum: TRANSCRIPTION_STATUSES, required: true },
    transcript: String,
    // Left out until there is a transcript, rather than defaulting to [].
    uncertain: { type: [[Number]], default: undefined },
    error: String,
    attempts: [
      { _id: false, startedAt: { type: Date, required: true }, finishedAt: Date, error: String },
    ],
    provenance: {
      type: new Schema(
        {
          provider: { type: String, required: true },
          model: { type: String, required: true },
          promptVersion: { type: String, required: true },
        },
        { _id: false },
      ),
    },
    correction: {
      type: new Schema({ text: { type: String, required: true }, ...stampFields }, { _id: false }),
    },
  },
  added: { type: stampSchema },
  removed: { type: stampSchema },
})

const regionSchema = new Schema<IPhotoRegion>(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    w: { type: Number, required: true },
    h: { type: Number, required: true },
  },
  { _id: false },
)

const photoSchema = new Schema<IPhoto>({
  name: { type: String, required: true },
  key: { type: String, required: true },
  contentType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
  size: { type: Number, required: true },
  added: { type: stampSchema },
  removed: { type: stampSchema },
  redaction: {
    type: new Schema<IPhotoRedaction>(
      {
        key: { type: String, default: null },
        faces: { type: Number, required: true },
        size: Number,
        at: { type: Date, required: true },
      },
      { _id: false },
    ),
  },
  region: { type: regionSchema },
})

const provenanceSchema = new Schema<IReadingProvenance>(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    usage: {
      type: new Schema(
        { inputTokens: Number, outputTokens: Number, thoughtTokens: Number },
        { _id: false },
      ),
      default: null,
    },
    privacy: {
      type: new Schema(
        { enabled: Boolean, maskedCount: Number, facesBlurred: Number, removedFromAnswer: Number },
        { _id: false },
      ),
      default: undefined,
    },
    interpretedAt: { type: Date, required: true },
  },
  { _id: false },
)
// Each schema gets its own definition, as Mongoose may change the one it is given.
const readingAttempts = () => [
  { _id: false, startedAt: { type: Date, required: true }, finishedAt: Date, error: String },
]

const photoReadingSchema = new Schema<IPhotoReading>(
  {
    status: { type: String, enum: INTERPRETATION_STATUSES, required: true },
    description: String,
    hazardType: String,
    error: String,
    attempts: readingAttempts(),
    photoIds: { type: [Schema.Types.ObjectId], required: true },
    marks: {
      type: [
        new Schema(
          { photo: { type: Schema.Types.ObjectId, required: true }, region: regionSchema },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    provenance: { type: provenanceSchema },
  },
  { _id: false },
)

// Categories proposed before CP-24 stay in stored documents, outside this
// schema: updates touch only the paths they name, so nothing removes them.
const interpretationSchema = new Schema<IInterpretation>(
  {
    photoReading: { type: photoReadingSchema },
    status: { type: String, enum: INTERPRETATION_STATUSES },
    description: String,
    hazardType: String,
    attempts: { type: readingAttempts(), default: undefined },
    // Left out rather than defaulting to [], which would read as "no photos".
    photoIds: { type: [Schema.Types.ObjectId], default: undefined },
    provenance: { type: provenanceSchema },
  },
  { _id: false },
)

const fieldSuggestion = () => ({
  type: new Schema({ notSure: { type: Boolean, required: true } }, { _id: false }),
  default: null,
})
const suggestionSchema = new Schema<ISuggestion>(
  {
    status: { type: String, enum: SUGGESTION_STATUSES, required: true },
    error: String,
    attempts: { type: Number, default: 0 },
    category: fieldSuggestion(),
    severity: fieldSuggestion(),
    run: { type: Number, default: 0 },
    rate: Boolean,
  },
  { _id: false },
)

const observationSchema = new Schema<IObservation>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'CaptureSession', required: true },
    engineer: { type: String, required: true, trim: true },
    engineerId: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, maxlength: 5000 },
    kinds: { type: [{ type: String, enum: OBSERVATION_KINDS }], default: undefined },
    recordings: [recordingSchema],
    photos: [photoSchema],
    pages: [pageSchema],
    interpretation: { type: interpretationSchema },
    suggestion: { type: suggestionSchema },
    standard: { type: String, trim: true, maxlength: 100 },
    // null while empty (CP-24); the enum allows null.
    severity: { type: String, enum: SEVERITIES, default: null },
    location: {
      type: Schema.Types.ObjectId,
      required: function (this: IObservation) {
        return !this.draft
      },
    },
    draft: { type: Boolean },
    siteWalk: { type: Schema.Types.ObjectId },
    checklistItem: {
      type: new Schema<IChecklistLink>(
        {
          checklist: { type: Schema.Types.ObjectId, ref: 'Checklist', required: true },
          item: { type: Schema.Types.ObjectId, required: true },
          result: { type: String, enum: CHECK_RESULTS, required: true },
          text: { type: String, required: true },
        },
        { _id: false },
      ),
    },
    metadata: {
      source_type: { type: String, enum: ['observation'], required: true },
      jurisdiction: { type: String, required: true },
      facility_type: { type: String, required: true },
      // Stored as null rather than left out or [], so the field is always
      // present and an uncategorised observation reads the same either way.
      COPE_dimension: { type: [{ type: String, enum: COPE_DIMENSIONS }], default: null },
      effective_date: { type: Date, required: true },
    },
    edited: { type: stampSchema },
    deleted: { type: stampSchema },
  },
  { timestamps: true, collection: 'observations' },
)

export const ObservationModel = model<IObservation>('Observation', observationSchema)

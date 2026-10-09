import type { Assessment, InterpretationStatus, MediaKind, Stamp, TranscriptionStatus } from './api'

export type AssessmentRow = {
  engineerId?: string | null
  standards?: string[]
  // The saved assessment the row came from, which the edit form starts from.
  record?: Assessment
  id: string
  site: string
  client: string
  type: string
  date: string
  siteVisitDate?: string | null
  reportDueDate?: string | null
  // The lead engineer.
  eng: string
  status: string
  sev: string
  live?: boolean
  open?: number
  // Created through the gateway, so it can be opened for capture.
  persisted?: boolean
  // When its latest capture session started, from the gateway.
  captureStartedAt?: string | null
}
export type Observation = {
  icon: string
  color: string
  cat: string
  time: string
  text: string
  area: string
  sev: string
  std: string
  // Its photographs (CP-04): url opens the original, or is null for a sample
  // one, which has only a name. Not removed ones (CP-08); id is set on a
  // saved one or one added in the demo, and added on one added after saving.
  media: { id?: string; name: string; url: string | null; added?: Stamp | null }[]
  // Recordings and photos removed from it, to restore (CP-08).
  removedMedia?: {
    kind: MediaKind
    id: string
    name: string
    url: string | null
    removed: Stamp
  }[]
  detail: string
  audio?: string
  // Where it was captured, when known by id rather than only by name, and the
  // location's floor. The location's name (area) is its zone (CP-06).
  locationId?: string
  floor?: string | null
  // Set on observations saved on the server.
  id?: string
  // What is attached, e.g. "Note · 2 recordings".
  attached?: string
  // Shown while a recording is transcribing or after one failed.
  badge?: { tone: 'info' | 'high'; label: string } | null
  // What it holds: any of 'Note', 'Voice' and 'Photo' (CP-08); worked out for
  // sample ones.
  types?: string[]
  // Transcribing, Interpreting, Transcription failed, Interpretation failed or
  // Complete (CP-08, CP-05).
  status?: string
  // What the vision model proposes from its photos (CP-05). A sample one is
  // the demo's stand-in when no capture session is live, not a real reading.
  interpretation?: {
    status: InterpretationStatus
    description: string | null
    category: string | null
    hazardType: string | null
    error: string | null
    model: string | null
    sample?: boolean
    // Photos were added or removed since it was read (CP-08).
    outOfDate?: boolean
    // The photos it read, when known, marking any since removed.
    readFrom?: { name: string; url: string | null; removed: boolean }[]
  } | null
  // The latest change to it, and its deletion (CP-08).
  edited?: Stamp | null
  deleted?: Stamp | null
  recordings?: {
    id: string
    name: string
    status: TranscriptionStatus
    // The transcript as corrected, or where the transcription stands.
    text: string
    // What Whisper wrote, when the engineer has corrected it (CP-08).
    original: string | null
    correction: Stamp | null
    error: string | null
    audioUrl: string
    // Who added it after the observation was saved (CP-08).
    added: Stamp | null
  }[]
}
export type GenerationSection = {
  id: string
  n: string
  title: string
  st: string
  p?: number
  ev: number
  conf: string
}
export type WorkflowState = {
  screen: string
  tab: string
  toast: string | null
  toastTone: string
  q: string
  fStatus: string
  workSort: string
  createdRows: AssessmentRow[]
  cf: {
    site: string
    client: string
    addr: string
    ref: string
    type: string
    survey: string
    date: string
    due: string
    stds: string[]
    // The assigned engineer's user ID.
    eng: string
    jurisdiction: string
  }
  // The assessment whose details the form is editing, or null when creating.
  cfEdit: string | null
  cfErr: boolean
  cfBusy: boolean
  cfServerError: string | null
  // The assessment the Site observation screen captures for.
  captureTarget: { reference: string; site: string }
  // Observations for assessments other than the demo one, by reference.
  captureObs: Record<string, Observation[]>
  fMode: string
  fNote: string
  // The note is in the Ready to save list rather than being written.
  fNoteListed: boolean
  // An observation being saved to the gateway, and why the last save failed.
  fSaving: boolean
  fSaveError: { title: string; message: string } | null
  fRec: boolean
  fSecs: number
  fTrans: boolean
  fTransBusy: boolean
  // Why the microphone could not start, shown on the voice panel.
  fVoiceError: { title: string; message: string } | null
  // Recordings and files waiting for Save observation, all saved with the one observation.
  fClips: VoiceClip[]
  fPhotos: PhotoFile[]
  // Why a chosen file was not added as a photo (CP-04 AC4).
  fPhotoError: string | null
  // The location the engineer is capturing in, and the location sheet.
  fLocationId: string | null
  locOpen: boolean
  locQuery: string
  locAdding: boolean
  lf: { name: string; floor: string }
  lfBusy: boolean
  lfError: string | null
  // The location waiting for the engineer to confirm removing it, by id.
  locRemove: string | null
  fCat: string
  fSev: string
  fStd: string
  // warn: a prompt to do something first, shown in the warning tone.
  fToast: { text: string; warn?: boolean } | null
  fRecent: Observation[]
  gsecs: GenerationSection[]
  running: boolean
  stopOpen: boolean
  sel: string
  secSt: Record<string, string>
  bodyOv: Record<string, string>
  editing: boolean
  draft: string
  rejected: Record<string, boolean>
  u1: string | null
  u2: string | null
  u3: string | null
  activeCite: number | null
  fmt: string
  optCite: boolean
  optPhotos: boolean
  optIdx: boolean
  exportOpen: boolean
  navOpen?: boolean
  navCollapsed?: boolean
  // The expanded row on the Observations tab, by its key.
  obsOpen?: string | null
  // Observations tab filters (CP-06, CP-08); '' shows every value.
  of: ObservationFilters
  // The Observations tab lists the deleted observations instead (CP-08).
  obsShowDeleted: boolean
  // The observation being changed on the Observations tab, by row key: a
  // recording's transcript, its deletion, adding recordings and photos, or
  // removing one of them (CP-08).
  obsDialog: {
    kind: 'transcript' | 'delete' | 'addMedia' | 'removeMedia'
    key: string
    recordingId?: string
    media?: { kind: MediaKind; id: string; name: string }
  } | null
  // The observation in the Edit dialog, by row key, with the dialog's values:
  // its tags (CP-06) and note (CP-08); and why the last save failed.
  tagEdit: {
    key: string
    cat: string
    sev: string
    locationId: string
    std: string
    note: string
  } | null
  tagBusy: boolean
  archiveOpen: boolean
  archiveBusy: boolean
  tagError: string | null
}

export type ObservationFilters = {
  type: string
  cat: string
  sev: string
  loc: string
  floor: string
  status: string
}

// A recording or audio file held in the browser until Save observation uploads it.
export type VoiceClip = {
  id: number
  name: string
  length: string | null
  audio: Blob
  url: string
}

// A photograph held in the browser until Save observation uploads it (CP-04).
export type PhotoFile = {
  id: number
  name: string
  image: Blob
  url: string
}

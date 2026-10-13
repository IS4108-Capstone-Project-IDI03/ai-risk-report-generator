import type { Assessment, InterpretationStatus, MediaKind, Stamp, TranscriptionStatus } from './api'

export type AssessmentRow = {
  engineerId?: string | null
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
  // Its COPE categories, in C-O-P-E order; empty when uncategorised.
  cats: string[]
  time: string
  text: string
  // Where it was captured (CP-16): the location's name, building and level.
  locationName: string
  building?: string | null
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
  // The location by id, when known rather than only by name, and its level.
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
// The dashboard's date filters: reports past due, reports due within 7 days,
// and site visits within 7 days.
export type DateFilter = 'overdue' | 'due-soon' | 'visit-soon'
export type WorkflowState = {
  screen: string
  tab: string
  toast: string | null
  toastTone: string
  q: string
  fStatus: string
  // The dashboard box filtering the list by date, or null for none.
  fDate: DateFilter | null
  workSort: string
  // The work list grouped by client, then site (CP-17), instead of latest first.
  workByClient: boolean
  // Clients folded away on the grouped work list, by group key.
  workFolded: Record<string, boolean>
  // The work list swapped for the archived assessments (CP-17).
  showArchived: boolean
  createdRows: AssessmentRow[]
  cf: {
    site: string
    client: string
    addr: string
    type: string
    survey: string
    date: string
    due: string
    // The assigned engineer's user ID.
    eng: string
    // Narrows the engineer list; not sent.
    engQuery: string
    jurisdiction: string
    // The listed client chosen by a site's New visit (AC4), so its sites load
    // before the client list does; '' once the name is typed.
    clientId: string
    // The client's listed site the assessment is for, NEW_SITE to add one, or
    // '' until one is chosen (CP-17 AC2).
    siteId: string
    // Copy the listed site's latest visit's locations (AC3).
    copy: boolean
    // Client and site names the engineer kept despite a likely typo (AC9).
    kept: string[]
    // A new client or site name that looks like a listed one, asked about on
    // Create: use the listed one, or keep it as typed.
    check: { field: 'client' | 'site'; typed: string; suggestion: string } | null
  }
  // The assessment whose details the form is editing, or null when creating.
  cfEdit: string | null
  cfErr: boolean
  cfBusy: boolean
  cfServerError: string | null
  // The assessment the Site observation screen captures for.
  captureTarget: { reference: string; site: string }
  // The navigation's Recent list: assessments last opened, newest first.
  recent: { reference: string; site: string }[]
  // Observations for assessments other than the demo one, by reference.
  captureObs: Record<string, Observation[]>
  fMode: string
  fNote: string
  // Capture was left with something unsaved: the Leave without saving?
  // dialog, and the workspace tab leaving goes to.
  fLeaveOpen: boolean
  fLeaveTo: string
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
  // The location the engineer is capturing in, and the location picker. It
  // opens by itself until a location is chosen, unless closed this visit.
  fLocationId: string | null
  locOpen: boolean
  locDismissed: boolean
  locQuery: string
  // The form adding a location, or changing the one locEdit names (CP-16).
  locAdding: boolean
  locEdit: string | null
  lf: LocationForm
  lfBusy: boolean
  // Why the form was refused, by field: building, floor or name.
  lfErrors: Partial<Record<'building' | 'floor' | 'name', string>>
  // A new building, level or location name the form asks about before
  // saving, as it is probably mistyped (CP-16), and those the engineer chose
  // to keep as typed.
  lfCheck: NameCheck | null
  lfKept: Partial<Record<NameCheck['field'], string>>
  // Picker groups opened or closed this visit, by key (CP-16); others follow
  // where the engineer is.
  locGroups: Record<string, boolean>
  // The location waiting for the engineer to confirm removing it, by id.
  locRemove: string | null
  // The COPE categories the next observation is filed under; none is uncategorised.
  fCats: string[]
  // Its severity, '' until the engineer picks one. Both reset after each save.
  fSev: string
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
  // The Observations tab by building, level and location, or newest first;
  // the buildings folded away this visit; and its Add or Edit location
  // dialog (CP-16).
  obsSort: 'location' | 'newest'
  obsFolded: Record<string, boolean>
  obsLocForm: boolean
  // Where the Observations tab opens after capture (CP-16): the location
  // capture was opened at or last saved in, and the observations saved
  // there this visit, marked New. ids: those the gateway saved; local: how
  // many were kept in this browser, the newest local-<n> rows. Kept only
  // while capture or the Observations tab shows.
  obsReturn: { locationId: string; ids: string[]; local: number } | null
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
    cats: string[]
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
  // A building (or Elsewhere on site), a level of it, or one location (CP-16).
  place: string
  status: string
}

// A building, level or location name as typed, not yet on the site, and the
// name it was probably meant to be, if any (CP-16).
export type NameCheck = {
  field: 'building' | 'floor' | 'name'
  typed: string
  suggestion: string | null
}

// The picker's add and edit form (CP-16): a location in a building, with an
// optional level, or one elsewhere on site, with a name only.
export type LocationForm = {
  kind: 'building' | 'elsewhere'
  building: string
  floor: string
  name: string
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

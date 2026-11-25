import type { EvidenceFilters } from './evidenceFilters'
import type {
  Assessment,
  InterpretationStatus,
  MediaKind,
  Kind,
  SavedObservation,
  SavedPhoto,
  SavedSuggestion,
  Stamp,
  TranscriptionStatus,
} from './api'
import type { Priority, Stage } from '../marshbot/types'

export type AssessmentRow = {
  engineerId?: string | null
  // The saved assessment the row came from, which Edit details starts from.
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
  // From the gateway (AS-06).
  stage?: Stage
  priority?: Priority | null
  sev: string
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
  // '' while it has none (CP-24).
  sev: string
  std: string
  // Its photographs (CP-04): url opens the original. Not removed ones (CP-08);
  // added is set on one added after saving.
  media: {
    id?: string
    name: string
    url: string | null
    added?: Stamp | null
    // As sent to the AI with protection on (PV-04).
    redaction?: SavedPhoto['redaction']
    // The area the engineer marked (CP-10).
    region?: SavedPhoto['region']
  }[]
  // Recordings, photos and handwritten pages removed from it, to restore
  // (CP-08, CP-20).
  removedMedia?: {
    kind: MediaKind
    id: string
    name: string
    url: string | null
    removed: Stamp
  }[]
  detail: string
  // The location by id, when known rather than only by name, and its level.
  locationId?: string
  floor?: string | null
  // Set on observations saved on the server.
  id?: string
  // Its tags (CP-36); absent when untagged.
  kinds?: Kind[]
  // Its own sort-only labels (CP-36); absent when none.
  labels?: string[]
  // The checklist item it answers (CP-31), with the item's text then.
  checklist?: { text: string; result: 'confirmed' | 'differs' } | null
  // Created from a site walk proposal (CP-22 round 3), marked "From site walk".
  fromSiteWalk?: boolean
  // What is attached, e.g. "Note · 2 recordings".
  attached?: string
  // Shown while a recording is transcribing or after one failed.
  badge?: { tone: 'info' | 'high'; label: string } | null
  // What it holds: any of 'Note', 'Voice', 'Photo' and 'Scan' (CP-08, CP-19);
  types?: string[]
  // Transcribing, Reading, Transcription failed, Reading failed, To check or
  // Complete (CP-08, CP-24); worked out by observationRowState.ts.
  status?: string
  // The AI's suggestion for an empty category or severity (CP-24).
  suggestion?: SavedSuggestion | null
  // Category or severity empty or not sure, or the suggestion failed (CP-24).
  toCheck?: boolean
  // The photos' description (CP-05, CP-24); null until the photos are first described.
  interpretation?: {
    photos: {
      status: InterpretationStatus
      description: string | null
      hazardType: string | null
      error: string | null
      model: string | null
      outOfDate: boolean
      // The photos it describes, when known: All Photos says which of them
      // each describes.
      photoIds?: string[]
    } | null
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
    // A site walk clip's part of the walk, in seconds (CP-22); plays only that part (CP-12).
    clip?: { start: number; end: number } | null
    // Who added it after the observation was saved (CP-08).
    added: Stamp | null
  }[]
  // Its photographed pages of handwritten notes (CP-19).
  pages?: ObservationPage[]
}
// A photographed page of handwritten notes on an observation (CP-19, CP-20).
export type ObservationPage = {
  id: string
  name: string
  // The original photo of the page.
  url: string
  status: TranscriptionStatus
  // Its text: the engineer's correction where there is one (CP-20), else the
  // handwriting word for word, '' when the page has none, or null while there
  // is no transcript.
  transcript: string | null
  // What the model wrote, kept beside a correction (CP-20); null when the
  // page is not corrected.
  original: string | null
  // The words the model was unsure of, as [start, end) in what it wrote.
  uncertain: [number, number][]
  error: string | null
  // Who corrected its text, and who added it after saving (CP-20).
  correction: Stamp | null
  added: Stamp | null
}
// The work list's Due filter: reports past due, reports due within 7 days,
// and site visits within 7 days.
export type DateFilter = 'overdue' | 'due-soon' | 'visit-soon'
export type WorkflowState = {
  screen: string
  // The client whose page is open (CP-18), from '/clients/<id>'.
  clientPage: string | null
  // The client dialog opened from the client page's ⋯ menu (CP-18).
  clientDialog: 'rename' | 'remove' | null
  // The client page's tab to open on, when not its first (AS-06: Details' See all opens Documents).
  clientTab: 'documents' | null
  // The client page an assessment was opened from, and the tab it was on
  // (CP-29): that assessment's Back returns there, on that tab.
  clientReturn: { clientId: string; tab: string; reference: string } | null
  // The assessment opened from the calendar (CP-60): its Back returns there.
  calendarReturn: string | null
  tab: string
  q: string
  fStatus: string
  // The Due pill's filter, or null for none.
  fDate: DateFilter | null
  // The Visit type pill's filter (CP-23), or '' for none.
  fVisitType: string
  workSort: string
  // The work list grouped by client, then site (CP-17), instead of latest first;
  // on by default (CP-23).
  workByClient: boolean
  // Clients folded away on the grouped work list, by group key.
  workFolded: Record<string, boolean>
  // The work list swapped for the archived assessments (CP-17).
  showArchived: boolean
  createdRows: AssessmentRow[]
  // How the New Assessment screen opens (CP-23): blank, or on a listed
  // client (and site, or 'new' for Add a new site) from a client page or a site's New visit.
  createStart: {
    mode: 'form' | 'documents'
    clientId?: string
    clientName?: string
    siteId?: string
    // The survey day, when opened from a day on the calendar (CP-60).
    siteVisitDate?: string
    // Where Cancel goes back to when not the Assessments list (CP-60).
    returnTo?: 'calendar'
  }
  // The assessment the Site observation screen captures for.
  captureTarget: { reference: string; site: string }
  // The navigation's Recent list: assessments last opened, newest first.
  recent: { reference: string; site: string }[]
  fMode: string
  fNote: string
  // The tags chosen on New Observation (CP-36); empty means untagged, which reads as a Fact.
  fKinds: Kind[]
  // Their sort-only labels (CP-36), and the tag the Observations list is narrowed to ('' = all).
  fLabels: string[]
  obsTag: string
  // Capture was left with something unsaved: the Leave without saving?
  // dialog, and the workspace tab leaving goes to.
  fLeaveOpen: boolean
  fLeaveTo: string
  // An observation being saved to the gateway, and why the last save failed.
  fSaving: boolean
  fSaveError: { title: string; message: string } | null
  fRec: boolean
  fSecs: number
  // Why the microphone could not start, shown on the voice panel.
  fVoiceError: { title: string; message: string } | null
  // The hidden draft observation that holds the recordings added on New Observation, as the
  // gateway last sent it (CP-24); null until the first recording. Save turns it into the observation.
  fDraft: SavedObservation | null
  // Recordings being sent to the draft right now, and how long each recorded one ran, by name.
  fSending: number
  fLengths: Record<string, number>
  // Times Save was pressed with no location: the first marks Location, a later one shakes it.
  fLocRefused: number
  // Recordings held in this browser: only for a site walk proposal, which has no draft.
  fClips: VoiceClip[]
  fPhotos: PhotoFile[]
  // Why a chosen file was not added as a photo (CP-04 AC4).
  fPhotoError: string | null
  // Photographed pages of handwritten notes (CP-19), and why a chosen file was
  // not added as one.
  fPages: PhotoFile[]
  fPageError: string | null
  // The location the engineer is capturing in, and the location picker. It
  // opens by itself until a location is chosen, unless closed this visit.
  fLocationId: string | null
  locOpen: boolean
  locDismissed: boolean
  locQuery: string
  // The block Use my current location found, narrowing the picker to it (CP-26).
  locBlock: string | null
  // The form adding a location, or changing the one locEdit names (CP-16).
  locAdding: boolean
  locEdit: string | null
  lf: LocationForm
  lfBusy: boolean
  // Why the form was refused, by field: building, floor or name.
  // Where the picker's tracking last put the engineer (CP-26). Never saved as such.
  locHere: { lat: number; lng: number } | null
  // The engineer typed in or cleared Coordinates, so tracking leaves it alone.
  lfOwnPoint: boolean
  lfErrors: Partial<Record<'building' | 'floor' | 'name' | 'coordinates', string>>
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
  // The checklist open over capture (CP-31), and the item the next
  // observation answers as Differs, chosen there; reset after its save.
  checklistOpen: boolean
  fChecklistItem: { id: string; text: string } | null
  // warn: a prompt to do something first, shown in the warning tone.
  navOpen?: boolean
  navCollapsed?: boolean
  // The expanded row on the Observations tab, by its key.
  obsOpen?: string | null
  // Where an open observation came from when not the list: Back returns there.
  obsFrom?: 'photos' | 'scans' | 'recordings' | null
  // The search on All Photos, All Handwritten Pages or All Recordings
  // (CP-13): kept while an observation opened from it is open, so Back finds
  // it again, and cleared each time one of them is opened.
  evidenceQuery?: string
  // Their filters (CP-13), kept and cleared with the search.
  evidenceFilters?: EvidenceFilters
  // Observations tab filters (CP-06, CP-08); '' shows every value.
  of: ObservationFilters
  // The Observations tab lists the deleted observations instead (CP-08).
  obsShowDeleted: boolean
  // The Observations tab as its list, or as the building stack (CP-61). Kept
  // here, not in the tab, so it is still the stack after a visit to capture.
  obsView: 'list' | 'stack'
  // The Observations tab by building, level and location, or newest first;
  // the buildings folded away this visit; and its Add or Edit location
  // dialog (CP-16).
  obsSort: 'location' | 'newest'
  obsFolded: Record<string, boolean>
  obsLocForm: boolean
  // Where the Observations tab opens after capture (CP-16): the location
  // capture was opened at or last saved in, and the observations saved
  // there this visit, marked New, by id. Kept only
  // while capture or the Observations tab shows.
  obsReturn: { locationId: string; ids: string[] } | null
  // The observation being changed on the Observations tab, by row key: a
  // recording's transcript, its deletion, adding recordings, photos and pages,
  // or removing one of them (CP-08); a page's text, or transcribing a
  // corrected page again (CP-20).
  obsDialog: {
    kind: 'transcript' | 'delete' | 'addMedia' | 'removeMedia' | 'pageText' | 'retranscribe'
    key: string
    recordingId?: string
    pageId?: string
    media?: { kind: MediaKind; id: string; name: string }
  } | null
  archiveOpen: boolean
  archiveBusy: boolean
  // Counts each choice of Version history in the ⋯ menu (RV-06), which opens
  // it in the Review tab; 0 again once the engineer leaves that tab.
  reviewHistory: number
}

export type ObservationFilters = {
  type: string
  cat: string
  sev: string
  // A building (or Elsewhere on site), a level of it, or one location (CP-16).
  place: string
  status: string
  // The search, as typed (CP-13): every word in the observation's evidence.
  q: string
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
  // As typed, "1.2966, 103.8520" (CP-26); optional.
  coordinates: string
}

// A recording or audio file held in the browser until Save observation uploads it.
export type VoiceClip = {
  id: number
  name: string
  length: string | null
  audio: Blob
  url: string
}

// A photograph held in the browser until Save observation uploads it (CP-04),
// a site photo or a page of handwritten notes (CP-19).
export type PhotoFile = {
  id: number
  name: string
  image: Blob
  url: string
  // The area marked before it is saved (CP-10), sent with it.
  region?: SavedPhoto['region']
}

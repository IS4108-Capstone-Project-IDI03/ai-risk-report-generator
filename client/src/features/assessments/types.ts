import type { TranscriptionStatus } from './api'

export type AssessmentRow = {
  engineerId?: string | null
  standards?: string[]
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
  media: string[]
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
  recordings?: {
    id: string
    name: string
    status: TranscriptionStatus
    // The transcript, or where the transcription stands.
    text: string
    error: string | null
    audioUrl: string
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
  fPhotos: { name: string }[]
  // ponytail: photos are placeholders kept in the browser until CP-04 stores
  // them; these are the ones attached to observations saved on the server, by id.
  savedPhotos: Record<string, string[]>
  // The location the engineer is capturing in, and the location sheet.
  fLocationId: string | null
  locOpen: boolean
  locQuery: string
  locAdding: boolean
  lf: { name: string; floor: string }
  lfBusy: boolean
  lfError: string | null
  // Why the last location could not be removed.
  locError: string | null
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
  // Observations tab filters (CP-06); '' shows every value.
  of: ObservationFilters
  // The observation whose tags are being edited, by row key, with the
  // dialog's values; and why the last save failed.
  tagEdit: { key: string; cat: string; sev: string; locationId: string; std: string } | null
  tagBusy: boolean
  archiveOpen: boolean
  archiveBusy: boolean
  tagError: string | null
}

export type ObservationFilters = { cat: string; sev: string; loc: string; floor: string }

// A recording or audio file held in the browser until Save observation uploads it.
export type VoiceClip = {
  id: number
  name: string
  length: string | null
  audio: Blob
  url: string
}

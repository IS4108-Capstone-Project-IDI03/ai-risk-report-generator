import type { TranscriptionStatus } from './api'

export type AssessmentRow = {
  id: string
  site: string
  client: string
  type: string
  date: string
  // The lead engineer; engs lists everyone assigned when known.
  eng: string
  engs?: string[]
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
  // Set on voice notes saved on the server (CP-03).
  voice?: {
    id: string
    status: TranscriptionStatus
    error: string | null
    audioUrl: string
  }
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
    engs: string[]
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
  fRec: boolean
  fSecs: number
  fTrans: boolean
  fTransBusy: boolean
  // Why the last recording could not start or be saved, shown on the voice panel.
  fVoiceError: { title: string; message: string } | null
  // Recordings and files waiting for Save observation, each saved as its own voice note.
  fClips: VoiceClip[]
  fPhotos: { name: string }[]
  fArea: string
  fCat: string
  fSev: string
  fStd: string
  fSaved: number
  fToast: string | null
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
  obsOpen?: number | null
}

// A recording or audio file held in the browser until Save observation uploads it.
export type VoiceClip = {
  id: number
  name: string
  length: string | null
  audio: Blob
  url: string
}

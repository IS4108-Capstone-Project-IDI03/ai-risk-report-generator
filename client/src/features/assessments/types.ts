export type AssessmentRow = {
  id: string
  site: string
  client: string
  type: string
  date: string
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
  fEng: string
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

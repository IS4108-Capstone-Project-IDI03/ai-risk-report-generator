import { useState, useEffect, useRef } from 'react'
import type * as React from 'react'
import { Icon, Button, IconRegistry } from '../../design-system'
import {
  archiveAssessment as requestArchive,
  restoreAssessment as requestRestore,
  createAssessment as requestCreateAssessment,
  updateAssessment as requestUpdateAssessment,
  GatewayError,
  listAssessments,
  listAssignableEngineers,
  listClients,
  listClientSites,
  type AssignableEngineer,
  type Client,
  type ClientSite,
  readObservation,
  retranscribePage,
  retryPageTranscription,
  retryTranscription,
  saveObservation,
  updateObservation,
  correctTranscript,
  deleteObservation,
  restoreObservation,
  addObservationMedia,
  removeMedia,
  restoreMedia,
  type MediaKind,
  type Assessment,
  type AssessmentStatus,
  type SavedObservation,
  type SiteLocation,
  type Stamp,
} from './api'
import { formatDayYearTime } from './format'
import { guardLeave } from './leaveGuard'
import { choosePhotos, microphoneProblem, record, unsupportedPhotos } from './media'
import {
  filtersActive,
  labelValues,
  matchesFilters,
  matchesPlace,
  NO_FILTERS,
  OBSERVATION_STATUSES,
  OBSERVATION_TYPES,
  placeFilter,
  statusOf,
  typeLabel,
  typesOf,
} from './observationFilters'
import {
  BUILDING_WORDS,
  correctName,
  groupKey,
  groupLocations,
  isStandardName,
  LEVEL_SUGGESTIONS,
  levelRank,
  LOCATION_NAMES,
  locationLabel,
  sameName,
  similarName,
  standardLevel,
  suggestLevel,
  suggestions,
} from './locations'
import type {
  AssessmentRow,
  DateFilter,
  LocationForm,
  NameCheck,
  Observation,
  ObservationFilters,
  PhotoFile,
  VoiceClip,
  WorkflowState,
} from './types'
import {
  categoryIcon,
  categoryLabel,
  copeDimensionsOf,
  sameCategories,
  toggleCategory,
  UNCATEGORISED,
  withCategory,
} from './categories'
import type { PageView } from './components/PageEntry'
import type { BoxContent } from './components/StatBox'
import { useCaptureSession } from './useCaptureSession'
import { useLocations } from './useLocations'
import { useObservations } from './useObservations'
import {
  initialState,
  CAPTURE_ASSESSMENT,
  FACILITY_TYPES,
  JURISDICTIONS,
  ROWS,
  CAT_ICON,
  DEMO_LOCATIONS,
  STANDARD_REFERENCES,
  SEV,
  TITLES,
  PLAIN,
  EVIDENCE,
  OBS,
  sampleInterpretation,
} from './demo-data'
import { roleLabel } from '../accounts/api'
import type { Session } from '../auth/api'
import {
  can,
  canOpen,
  canOpenTab,
  homeScreen,
  reviewIdForPath,
  SCREEN_PATHS,
  screenForPath,
  type Screen,
} from '../auth/access'
export type AssessmentWorkflow = ReturnType<typeof useAssessmentWorkflow>
const STATUS_LABEL: Record<AssessmentStatus, string> = {
  not_started: 'Not started',
  capturing: 'Capturing',
  ready_to_generate: 'Ready to generate',
  draft: 'Draft',
  under_review: 'Under review',
  finalised: 'Finalised',
  archived: 'Archived',
}
// A new assessment's report is due this many days after its site visit.
const REPORT_DUE_DAYS = 14
// Today's local calendar day as YYYY-MM-DD, and the day a number of days after one.
const localToday = () => new Date().toLocaleDateString('en-CA')
function addDays(isoDay: string, days: number) {
  const day = new Date(isoDay + 'T00:00:00')
  day.setDate(day.getDate() + days)
  return day.toLocaleDateString('en-CA')
}
// Past its report due date (local calendar day) and not finalised. Due today is not overdue.
function isOverdue(r: AssessmentRow) {
  const today = new Date().toLocaleDateString('en-CA')
  return !!r.reportDueDate && r.reportDueDate < today && r.status !== STATUS_LABEL.finalised
}
// Local calendar days from today to an ISO day: 0 today, negative once past.
function daysFromToday(isoDay: string) {
  const today = new Date(new Date().toLocaleDateString('en-CA') + 'T00:00:00')
  return Math.round((new Date(isoDay + 'T00:00:00').getTime() - today.getTime()) / 86_400_000)
}
// From today to seven days from today, both included.
function withinWeek(isoDay: string | null | undefined) {
  if (!isoDay) return false
  const days = daysFromToday(isoDay)
  return days >= 0 && days <= 7
}
// The dashboard boxes count, and filter the list to, assessments still in
// progress (neither finalised nor archived) by date.
function inProgress(r: AssessmentRow) {
  return r.status !== STATUS_LABEL.finalised && r.status !== STATUS_LABEL.archived
}
const DATE_FILTERS: Record<DateFilter, (r: AssessmentRow) => boolean> = {
  overdue: (r) => inProgress(r) && isOverdue(r),
  'due-soon': (r) => inProgress(r) && withinWeek(r.reportDueDate),
  'visit-soon': (r) => inProgress(r) && withinWeek(r.siteVisitDate),
}
// A row's countdown to its report due date, counted as the Overview counts it:
// amber within three days. Past due, the row shows its Overdue badge instead;
// a finalised report is no longer counting down.
function dueCountdown(r: AssessmentRow) {
  if (!r.reportDueDate || r.status === STATUS_LABEL.finalised) return null
  const days = daysFromToday(r.reportDueDate)
  if (days < 0) return null
  return {
    text: days === 0 ? 'Due today' : 'Due in ' + days + (days === 1 ? ' day' : ' days'),
    soon: days <= 3,
  }
}
// Days left until the report is due, or days overdue, by local calendar day,
// with the date as the note: amber within three days, red once overdue. A
// finalised report is no longer counting down.
function dueSummary(r: AssessmentRow | null | undefined): BoxContent {
  if (!r?.reportDueDate) return { value: '—', unit: 'no due date set' }
  const note = formatDay(r.reportDueDate)
  if (r.status === STATUS_LABEL.finalised)
    return { value: 'Done', unit: 'finalised', note, tone: 'ok' }
  const days = daysFromToday(r.reportDueDate)
  if (days < 0)
    return {
      value: String(-days),
      unit: (days === -1 ? 'day' : 'days') + ' overdue',
      note,
      tone: 'danger',
    }
  if (days === 0) return { value: 'Today', unit: 'due', note, tone: 'warning' }
  return {
    value: String(days),
    unit: (days === 1 ? 'day' : 'days') + ' left',
    note,
    ...(days <= 3 && { tone: 'warning' as const }),
  }
}
function formatDay(isoDay: string | null) {
  return isoDay
    ? new Date(isoDay + 'T00:00:00').toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Unscheduled'
}
function toRow(a: Assessment): AssessmentRow {
  return {
    id: a.reference,
    site: a.site.name,
    client: a.client,
    type: a.surveyType,
    date: formatDay(a.siteVisitDate),
    siteVisitDate: a.siteVisitDate,
    reportDueDate: a.reportDueDate,
    eng: a.engineer?.name ?? 'Unassigned',
    engineerId: a.engineer?.id ?? null,
    record: a,
    status: STATUS_LABEL[a.status],
    sev: 'low',
    open: 0,
    persisted: true,
    captureStartedAt: a.captureStartedAt,
  }
}

const TRANSCRIPTION_TEXT = {
  transcribing: 'Transcribing the recording…',
  failed: 'The recording could not be transcribed.',
}
// Where a handwritten page stands when there is no text to show (CP-19).
const PAGE_TEXT = {
  transcribing: 'Transcribing the page…',
  failed: 'The page could not be transcribed.',
  blank: 'No handwriting was found on this page.',
  demo: 'No capture session, so this page stays in this browser and is not transcribed.',
}
const pageNote = (p: NonNullable<Observation['pages']>[number]) =>
  p.status === null
    ? PAGE_TEXT.demo
    : p.status === 'transcribing'
      ? PAGE_TEXT.transcribing
      : p.status === 'transcribed' && !p.transcript?.trim()
        ? PAGE_TEXT.blank
        : null
// The categories the Observations tab filters by: the shared COPE vocabulary
// (CP-08 AC7), shown as the values they are stored as, or Uncategorised.
const CATEGORY_OPTIONS = [...Object.keys(CAT_ICON), UNCATEGORISED]
const SEVERITY_OPTIONS = ['critical', 'high', 'moderate', 'low'].map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))
const NO_LOCATIONS: SiteLocation[] = []
// An empty capture form: no note, recordings, photos or pages, and no tags
// chosen. The location stays, as the engineer is still standing in it.
const BLANK_DRAFT = {
  fNote: '',
  fClips: [],
  fPhotos: [],
  fPages: [],
  fPageError: null,
  fCats: [],
  fSev: '',
  fRec: false,
  fSecs: 0,
  fTrans: false,
  fTransBusy: false,
  fVoiceError: null,
  fPhotoError: null,
  fSaveError: null,
  fToast: null,
  fLeaveOpen: false,
} satisfies Partial<WorkflowState>
// Recorders stopped to be thrown away with the draft they were recording for.
const discarded = new WeakSet<MediaRecorder>()
// The demo's simulated recording, transcribed.
const SAMPLE_TRANSCRIPT =
  'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.'
// The navigation's Recent list: how many it keeps, and how its entries'
// values name an assessment ("recent:RPT-2026-0411").
const RECENT_LIMIT = 3
const RECENT_PREFIX = 'recent:'
// Where an observation was captured, e.g. "Block A · Level 2 · Staircase";
// empty when its location is no longer listed.
const placeOf = (o: Observation) =>
  o.locationName
    ? locationLabel({ building: o.building, floor: o.floor, name: o.locationName })
    : ''
// The picker's form, empty, adding a location in a building.
const BLANK_LOCATION: LocationForm = { kind: 'building', building: '', floor: '', name: '' }
// The form with nothing refused, asked about or kept as typed.
const FORM_CLEAR = { lfErrors: {}, lfCheck: null, lfKept: {} } satisfies Partial<WorkflowState>
const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')
// The most engineers one search on the create form lists.
const ENGINEER_MATCH_LIMIT = 8
// "Alex Rowe · 07 Oct 2026 14:02", who changed something and when (CP-08).
const stampLabel = (stamp: Stamp) => stamp.by.name + ' · ' + formatDayYearTime(new Date(stamp.at))
// A recording added to a sample observation in this demo (CP-08): kept in the
// browser, never transcribed.
const demoRecording = (id: string, name: string, url: string, added: Stamp | null) => ({
  id,
  name,
  status: 'transcribed' as const,
  text: 'No capture session, so this recording stays in this browser and is not transcribed.',
  original: null,
  correction: null,
  error: null,
  audioUrl: url,
  added,
})
function toEntry(o: SavedObservation): Observation {
  const recordings = o.recordings.map((r) => {
    const { status, transcript, correction, error } = r.transcription
    return {
      id: r.id,
      name: r.name,
      status,
      // The engineer's correction stands in for what Whisper wrote (CP-08).
      text:
        status === 'transcribed'
          ? (correction?.text ?? transcript) || '(No speech was detected.)'
          : TRANSCRIPTION_TEXT[status],
      original: correction ? transcript : null,
      correction: correction && { at: correction.at, by: correction.by },
      error,
      audioUrl: r.url,
      added: r.added,
    }
  })
  // Each handwritten page (CP-19), with its transcript and uncertain words.
  const pages = (o.pages ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    status: p.transcription.status,
    transcript: p.transcription.transcript,
    uncertain: p.transcription.uncertain,
    error: p.transcription.error,
  }))
  const statuses = [...recordings, ...pages].map((r) => r.status)
  const reading = o.interpretation?.status
  // Where its recordings, pages and photos stand (CP-08 AC2, CP-05 AC2,
  // CP-19 AC4): anything still running first, then anything that failed.
  const status = statuses.includes('transcribing')
    ? 'Transcribing'
    : reading === 'interpreting'
      ? 'Interpreting'
      : statuses.includes('failed')
        ? 'Transcription failed'
        : reading === 'failed'
          ? 'Interpretation failed'
          : 'Complete'
  const photos = o.photos
  // The items a finished reading cites (CP-21). One from before CP-21 gave no
  // reasons and cites nothing, so it can't say what it passed over.
  const cited = new Set(
    o.interpretation?.categories.flatMap((c) => c.evidence.map((e) => e.item)) ?? [],
  )
  const judged =
    o.interpretation?.status === 'interpreted' &&
    o.interpretation.categories.every((c) => c.reason !== null)
  // The row reads as the note, the first recording when there is no note, the
  // first page's handwriting (or how many pages, until there is some), or how
  // many photos it holds when it is only photos.
  const pageText =
    pages.length > 0
      ? pages[0].transcript?.trim() || plural(pages.length, 'handwritten page')
      : undefined
  const text = o.note ?? recordings[0]?.text ?? pageText ?? plural(photos.length, 'photograph')
  return {
    id: o.id,
    icon: o.note
      ? 'sticky-note'
      : recordings.length
        ? 'mic'
        : pages.length
          ? IconRegistry.evidence.handwriting
          : 'camera',
    color: o.note
      ? '#f9ac10'
      : recordings.length
        ? '#8f7dff'
        : pages.length
          ? 'var(--text-secondary)'
          : '#4f9aee',
    cats: o.copeDimensions ?? [],
    time: formatDayYearTime(new Date(o.recordedAt)),
    text,
    locationName: o.location?.name ?? '',
    building: o.location?.building ?? null,
    locationId: o.location?.id,
    floor: o.location?.floor ?? null,
    sev: o.severity,
    std: o.standard ?? '',
    media: photos.map((p) => ({ id: p.id, name: p.name, url: p.url, added: p.added })),
    // Removed recordings and photos, kept to restore (CP-08).
    removedMedia: [
      ...o.removedRecordings.map((r) => ({
        kind: 'recordings' as const,
        id: r.id,
        name: r.name,
        url: r.url,
        removed: r.removed,
      })),
      ...o.removedPhotos.map((p) => ({
        kind: 'photos' as const,
        id: p.id,
        name: p.name,
        url: p.url,
        removed: p.removed,
      })),
    ],
    detail: o.note ?? '',
    attached: [
      o.note ? 'Note' : '',
      recordings.length ? plural(recordings.length, 'recording') : '',
      photos.length ? plural(photos.length, 'photo') : '',
      pages.length ? plural(pages.length, 'page') : '',
    ]
      .filter(Boolean)
      .join(' · '),
    // Only work still in progress or needing attention is badged; done is the norm.
    badge:
      status === 'Complete'
        ? null
        : { tone: status.endsWith('failed') ? 'high' : 'info', label: status },
    types: [
      ...(o.note ? ['Note'] : []),
      ...(recordings.length ? ['Voice'] : []),
      ...(photos.length ? ['Photo'] : []),
      ...(pages.length ? ['Scan'] : []),
    ],
    status,
    interpretation: o.interpretation && {
      status: o.interpretation.status,
      description: o.interpretation.description,
      hazardType: o.interpretation.hazardType,
      categories: o.interpretation.categories,
      error: o.interpretation.error,
      model: o.interpretation.model,
      outOfDate: o.interpretation.outOfDate,
      // What it read (CP-21), each with where to open it: a photo or page by
      // its image, kept or since removed (CP-08), and whether any category
      // cites it.
      readFrom: o.interpretation.items.map((item) => {
        const removed =
          o.removedPhotos.some((p) => p.id === item.id) ||
          o.removedRecordings.some((r) => r.id === item.id)
        const image =
          item.kind === 'photo'
            ? [...photos, ...o.removedPhotos].find((p) => p.id === item.id)?.url
            : item.kind === 'page'
              ? o.pages?.find((p) => p.id === item.id)?.url
              : null
        return {
          ...item,
          url: image ?? null,
          removed,
          notCited: judged && !item.leftOut && !removed && !cited.has(item.label),
        }
      }),
    },
    edited: o.edited,
    deleted: o.deleted,
    recordings,
    pages,
  }
}

// The create form's Site choice for adding a site the client doesn't have yet.
export const NEW_SITE = 'new'
// A client name as the gateway matches it (CP-17): lowercased, with its
// spacing tidied, so "NUS" and "nus " are one client.
const clientKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

export function useAssessmentWorkflow(onSignOut: () => void, session: Session) {
  // The create form as it first opens: assigned to the signed-in engineer,
  // visited today (or on the given day), its report due REPORT_DUE_DAYS later.
  const blankCreateForm = (visit = localToday()) => ({
    ...structuredClone(initialState.cf),
    eng: session.user.id,
    date: visit,
    due: addDays(visit, REPORT_DUE_DAYS),
  })
  // The screen comes from the URL (F-05), so a screen can be linked to and
  // reopened after signing in; '/' opens the role's home screen.
  const [state, updateState] = useState<WorkflowState>(() => ({
    ...structuredClone(initialState),
    cf: blankCreateForm(),
    screen: screenForPath(window.location.pathname, session),
  }))
  // The URL follows the screen. The first update replaces '/' (or the path
  // opened) rather than adding a history entry.
  const urlSynced = useRef(false)
  useEffect(() => {
    const path = SCREEN_PATHS[state.screen as Screen]
    // A knowledge document's Review page is part of the knowledge screen, so
    // its own path stays (IN-07).
    const onReviewPage = state.screen === 'knowledge' && reviewIdForPath(window.location.pathname)
    if (path && window.location.pathname !== path && !onReviewPage) {
      if (urlSynced.current) window.history.pushState(null, '', path)
      else window.history.replaceState(null, '', path)
    }
    urlSynced.current = true
  }, [state.screen])
  // Back and forward move between screens.
  useEffect(() => {
    const follow = () =>
      updateState((previous) => ({
        ...previous,
        screen: screenForPath(window.location.pathname, session),
        navOpen: false,
        toast: null,
        // Back from capture is a way of leaving it too.
        fLeaveOpen: false,
      }))
    window.addEventListener('popstate', follow)
    return () => window.removeEventListener('popstate', follow)
  }, [session])
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [timeouts] = useState(() => new Set<ReturnType<typeof setTimeout>>())
  // A screen the route guard blocks (F-05) loads nothing from the gateway.
  const onField = state.screen === 'field' && canOpen('field', session)
  const onWorkspace = state.screen === 'assessment' && canOpen('assessment', session)
  const capture = useCaptureSession(state.captureTarget.reference, onField)
  const captured = useObservations(
    state.captureTarget.reference,
    onField || onWorkspace,
    // The workspace reads the deleted ones too (CP-08), so the Observations
    // tab's Deleted button can say how many there are.
    onWorkspace,
  )
  // The Observations tab needs them too, to move an observation (CP-06).
  const places = useLocations(
    state.captureTarget.reference,
    onField || onWorkspace,
    // On site they are the gateway's once capture is live; in the workspace,
    // once the gateway has listed the assessment's observations.
    onField ? capture.state?.status === 'live' : captured.synced,
    state.captureTarget.reference === CAPTURE_ASSESSMENT.reference ? DEMO_LOCATIONS : NO_LOCATIONS,
  )
  // The recorder in progress, and a counter naming the clips it makes.
  const [media] = useState(() => ({
    recorder: null as MediaRecorder | null,
    clips: 0,
    photos: 0,
    pages: 0,
  }))
  useEffect(() => () => media.recorder?.stream.getTracks().forEach((t) => t.stop()), [media])
  // Leaving capture, by Done, the navigation or Back, stops a recording in
  // progress; its clip stays in the draft for when the engineer returns.
  useEffect(() => {
    if (!onField) media.recorder?.stop()
  }, [onField, media])
  // Where capture returns to is for the Observations tab it returns to; once
  // the engineer is anywhere else, however they got there (a tab, the
  // navigation, Back), it is forgotten (CP-16). Cleared while rendering, as
  // React allows for state that depends on other state, so a later visit to
  // the tab never shows it.
  const returning =
    state.screen === 'field' || (state.screen === 'assessment' && state.tab === 'observations')
  if (!returning && state.obsReturn) setState({ obsReturn: null })
  // A Version history request (RV-06) is for the Review tab it opened; once
  // the engineer is anywhere else, it is spent, so a later visit opens the
  // draft as usual.
  const reviewing = state.screen === 'assessment' && state.tab === 'review'
  if (!reviewing && state.reviewHistory) setState({ reviewHistory: 0 })
  // The work list from the gateway (RV-10); null until it loads, and when the
  // gateway cannot be reached, in which case the dashboard shows the demo rows.
  const [serverRows, setServerRows] = useState<AssessmentRow[] | null>(null)
  const [listFailed, setListFailed] = useState(false)
  const onDashboard = state.screen === 'dashboard' && canOpen('dashboard', session)
  useEffect(() => {
    // Refetched on every return to the dashboard, so capture progress shows.
    if (!onDashboard) return
    const controller = new AbortController()
    listAssessments(controller.signal).then(
      (list) => {
        setServerRows(list.map(toRow))
        setListFailed(false)
      },
      () => {
        if (!controller.signal.aborted) setListFailed(true)
      },
    )
    return () => controller.abort()
  }, [onDashboard])
  const [directory, setDirectory] = useState<AssignableEngineer[]>([])
  const [directoryStatus, setDirectoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const onCreate = state.screen === 'create' && canOpen('create', session)
  useEffect(() => {
    if (!onCreate) return
    const controller = new AbortController()
    listAssignableEngineers(controller.signal).then(
      (users) => {
        if (controller.signal.aborted) return
        setDirectory(users)
        setDirectoryStatus('ready')
      },
      () => {
        if (!controller.signal.aborted) {
          setDirectoryStatus('error')
        }
      },
    )
    return () => {
      controller.abort()
      setDirectoryStatus('loading')
    }
  }, [onCreate])
  // Every client, for the create form's Client field and its typo check
  // (CP-17). Without them a typed name still reaches the right client: the
  // gateway matches it whatever its case, and adds a new site for it.
  const creating = onCreate && !state.cfEdit
  const [clients, setClients] = useState<Client[] | null>(null)
  useEffect(() => {
    if (!creating) return
    const controller = new AbortController()
    listClients(controller.signal).then(
      (list) => {
        if (!controller.signal.aborted) setClients(list)
      },
      () => {
        if (!controller.signal.aborted) setClients(null)
      },
    )
    return () => controller.abort()
  }, [creating])
  // The listed client typed in, or chosen by a site's New visit, and its
  // sites, loaded once each.
  const listedClient = creating
    ? (clients?.find((c) => clientKey(c.name) === clientKey(state.cf.client)) ??
      (state.cf.clientId
        ? { id: state.cf.clientId, name: state.cf.client.trim(), sites: 0 }
        : undefined))
    : undefined
  const [clientSites, setClientSites] = useState<Record<string, ClientSite[]>>({})
  const listedClientId = listedClient?.id
  const sitesLoaded = !!listedClientId && !!clientSites[listedClientId]
  useEffect(() => {
    if (!listedClientId || sitesLoaded) return
    const controller = new AbortController()
    // Should it fail, no sites are offered and a new one can still be added.
    listClientSites(listedClientId, controller.signal).then(
      (sites) => {
        if (!controller.signal.aborted)
          setClientSites((all) => ({ ...all, [listedClientId]: sites }))
      },
      () => {
        if (!controller.signal.aborted) setClientSites((all) => ({ ...all, [listedClientId]: [] }))
      },
    )
    return () => controller.abort()
  }, [listedClientId, sitesLoaded])
  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timeouts.delete(timer)
      callback()
    }, delay)
    timeouts.add(timer)
  }
  function setState(patch: Partial<WorkflowState>) {
    updateState((previous) => ({
      ...previous,
      ...patch,
    }))
  }
  useEffect(() => {
    const measure = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', measure)
    const timers = timeouts
    return () => {
      window.removeEventListener('resize', measure)
      timers.forEach(clearTimeout)
    }
  }, [timeouts])
  useEffect(() => {
    const timer = setInterval(
      () =>
        updateState((previous) => {
          if (!previous.running || previous.screen !== 'assessment' || previous.tab !== 'generate')
            return previous
          const gsecs = previous.gsecs.map((section) => ({
            ...section,
          }))
          const processing = gsecs.find((section) => section.st === 'processing')
          if (processing) {
            processing.p = Math.min(100, (processing.p || 0) + 18)
            if (processing.p === 100) processing.st = 'done'
            return {
              ...previous,
              gsecs,
            }
          }
          const queued = gsecs.find((section) => section.st === 'queued')
          if (queued) {
            queued.st = 'processing'
            queued.p = 8
            return {
              ...previous,
              gsecs,
            }
          }
          return {
            ...previous,
            running: false,
          }
        }),
      850,
    )
    // The recording clock; a simulated recording stops once capture is left.
    const recorder = setInterval(
      () =>
        updateState((previous) =>
          !previous.fRec
            ? previous
            : previous.screen === 'field'
              ? { ...previous, fSecs: previous.fSecs + 1 }
              : { ...previous, fRec: false, fSecs: 0 },
        ),
      1000,
    )
    return () => {
      clearInterval(timer)
      clearInterval(recorder)
    }
  }, [])
  function toast(message: string, tone = 'success') {
    setState({
      toast: message,
      toastTone: tone || 'success',
    })
  }
  // The workspace and capture both act on the assessment last opened from the list.
  // A blank create form, preselecting the signed-in engineer.
  function blankForm(): Partial<WorkflowState> {
    return { cfEdit: null, cf: blankCreateForm() }
  }
  function navigate(screen: string): Partial<WorkflowState> {
    return { screen }
  }
  // Opens an assessment's workspace on its Overview and puts it first in the
  // navigation's Recent list. A capture draft is for the assessment it was
  // started on, so opening another clears it (call releaseDraft first), and
  // it can never be saved to the wrong site.
  function openAssessment(
    target: { reference: string; site: string },
    previous: WorkflowState,
  ): Partial<WorkflowState> {
    return {
      screen: 'assessment',
      tab: 'overview',
      captureTarget: target,
      recent: [target, ...previous.recent.filter((r) => r.reference !== target.reference)].slice(
        0,
        RECENT_LIMIT,
      ),
      // Filters name this assessment's locations and floors.
      of: NO_FILTERS,
      obsShowDeleted: false,
      obsOpen: null,
      ...(target.reference !== previous.captureTarget.reference && {
        ...BLANK_DRAFT,
        fLocationId: null,
      }),
    }
  }
  // Drops the capture draft's recording in progress and releases its
  // previews; the caller clears the draft from the form.
  function dropDraftFiles() {
    if (media.recorder) {
      // Marked first, so its clip is not added when it stops (startRecording).
      discarded.add(media.recorder)
      media.recorder.stop()
    }
    for (const file of [...state.fClips, ...state.fPhotos, ...state.fPages])
      URL.revokeObjectURL(file.url)
  }
  // Before another assessment opens: its draft is about to be cleared.
  function releaseDraft(reference: string) {
    if (reference !== state.captureTarget.reference) dropDraftFiles()
  }
  // A navigation entry: a screen, or a Recent assessment. The one already
  // open keeps its tab and filters. Call it only from an event handler.
  function navigateTo(value: string): Partial<WorkflowState> {
    if (!value.startsWith(RECENT_PREFIX)) return navigate(value)
    const reference = value.slice(RECENT_PREFIX.length)
    if (reference === state.captureTarget.reference) return navigate('assessment')
    const target = state.recent.find((r) => r.reference === reference)
    if (!target) return {}
    releaseDraft(target.reference)
    return openAssessment(target, state)
  }
  // A created assessment clears the form, so the next one starts blank. A form
  // left without creating keeps its draft.
  // A new assessment opens on its Overview when it is the creator's own; one
  // assigned to someone else is not on their list, so they return to it.
  function addCreatedRow(row: AssessmentRow, open: boolean) {
    if (open) releaseDraft(row.id)
    updateState((previous) => ({
      ...previous,
      createdRows: [row, ...previous.createdRows],
      cf: blankCreateForm(),
      cfBusy: false,
      cfErr: false,
      ...(open
        ? openAssessment({ reference: row.id, site: row.site }, previous)
        : { screen: 'dashboard' }),
    }))
  }
  function openItems() {
    const out = []
    if (!state.u3)
      out.push({
        id: 'u3',
        section: 's3',
        icon: 'triangle-alert',
        kindLabel: 'Unsupported claim',
        question: 'No source in the drafting set supports the 2021 hydraulic recalculation.',
        optionA: 'Remove the sentence',
        optionB: 'Attach the 2021 calculation sheet',
        label: 'Unsupported claim in 3.2 Sprinkler protection',
        where: '3.2 Sprinkler protection',
      })
    if (!state.u1)
      out.push({
        id: 'u1',
        section: 's4',
        icon: 'triangle-alert',
        kindLabel: 'Missing evidence',
        question: 'The 2023 pump test certificate is not in the document set.',
        optionA: 'Certificate exists — attach it',
        optionB: 'Not available — record as a finding',
        label: 'Pump test certificate not evidenced',
        where: '3.3 Water supplies',
      })
    if (!state.u2)
      out.push({
        id: 'u2',
        section: 's5',
        icon: 'git-compare-arrows',
        kindLabel: 'Conflicting sources',
        question:
          'Conveyor controller lead time conflicts between the site interview (14 weeks) and the 2023 report (8 weeks).',
        optionA: 'Use 14 weeks — site interview',
        optionB: 'Use 8 weeks — 2023 report',
        label: 'Conveyor lead time conflicts between sources',
        where: '4.0 Business interruption exposure',
      })
    return out
  }
  function liveSections() {
    return Object.keys(TITLES).filter((k) => !state.rejected[k])
  }
  function reviewedCount() {
    return liveSections().filter(
      (k) => state.secSt[k] === 'accepted' || state.secSt[k] === 'edited',
    ).length
  }
  function isBlocked() {
    if (!liveSections().length) return true
    return reviewedCount() < liveSections().length || openItems().length > 0
  }
  function modeStyle(on: boolean) {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      height: '46px',
      border: 'none',
      borderBottom: '2px solid ' + (on ? 'var(--action-primary)' : 'transparent'),
      background: 'transparent',
      fontFamily: 'inherit',
      fontSize: '16px',
      fontWeight: on ? '500' : '400',
      color: on ? 'var(--text-primary)' : 'var(--text-muted)',
      cursor: 'pointer',
      transition: 'color 120ms cubic-bezier(.2,0,.2,1)',
    } as React.CSSProperties
  }
  function userFooter() {
    const initials = session.user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('')
    return (
      <div className="user-footer">
        <span className="user-avatar">{initials}</span>
        <div>
          <strong>{session.user.name}</strong>
          <small>{roleLabel(session.user.role)}</small>
        </div>
        <Button
          variant="ghost"
          size="sm"
          title="Sign out"
          aria-label="Sign out"
          // Unsaved document edits ask first (RV-08 AC14).
          onClick={() => guardLeave(onSignOut)}
        >
          <Icon name="log-out" />
        </Button>
      </div>
    )
  }
  function renderVals() {
    const s = state
    const sc = s.screen,
      live = liveSections(),
      open = openItems()
    const isAssessment = sc === 'assessment'
    const w = viewportWidth
    const narrow = w < 1080
    const phone = w < 760

    /* capture session: name the assessment from the server when live */
    const liveCapture = capture.state?.status === 'live' ? capture.state : null
    const captureRef = liveCapture?.assessment.reference ?? s.captureTarget.reference
    const captureSite = liveCapture?.assessment.site?.name ?? s.captureTarget.site
    // The demo assessment keeps its sample observations; others start empty.
    const isDemoCapture = s.captureTarget.reference === CAPTURE_ASSESSMENT.reference
    const localRecent = isDemoCapture ? s.fRecent : (s.captureObs[s.captureTarget.reference] ?? [])
    // Observations saved on the server come first, then this browser's ones,
    // kept in the demo when no capture session is live.
    // Observations tab rows keep one key whatever the filters: a saved
    // observation's id, or local-<n> for the nth kept in this browser.
    const allRows = [
      ...[...captured.observations, ...captured.deleted].map((o) => ({
        o: toEntry(o),
        key: o.id,
      })),
      ...localRecent.map((o, i) => ({ o, key: 'local-' + i })),
    ]
    // Deleted observations stay out of capture and the default list (CP-08
    // AC13); Show deleted lists only them (AC14).
    const fieldRecent = allRows.filter(({ o }) => !o.deleted).map(({ o }) => o)
    const fieldSaved = fieldRecent.length
    // The assessment's photo collection (CP-04 AC3): every photo of an
    // observation not deleted, newest first, each with the observation it
    // belongs to. The report's photo appendix (EX-01) is to draw on it.
    const photoCollection = allRows
      .filter(({ o }) => !o.deleted)
      .flatMap(({ o, key }) =>
        o.media.map((photo, i) => ({
          key: key + '/' + i,
          name: photo.name,
          url: photo.url,
          where: placeOf(o),
          cat: categoryLabel(o.cats),
          time: o.time,
          openObservation: () =>
            setState({ tab: 'observations', obsOpen: key, obsShowDeleted: false, of: NO_FILTERS }),
        })),
      )
    const obsRows = allRows.filter(({ o }) => !!o.deleted === s.obsShowDeleted)
    const shownRows = obsRows.filter(({ o }) => matchesFilters(o, s.of))
    // The Location filter offers where the listed observations are, and the
    // place chosen even when only the other list (deleted or not) holds it.
    const placeOptions = placeFilter(
      allRows
        .filter((r) => obsRows.includes(r) || (!!s.of.place && matchesPlace(r.o, s.of.place)))
        .map(({ o }) => o),
    )
    const tagRow = s.tagEdit && allRows.find((r) => r.key === s.tagEdit!.key)
    const dialogRow = s.obsDialog && allRows.find((r) => r.key === s.obsDialog!.key)
    const obsNoun = s.obsShowDeleted ? 'deleted observation' : 'observation'
    // The Observations tab by building, level and location (CP-16), unless
    // sorted newest first; the deleted ones are always newest first.
    const obsByLocation = s.obsSort === 'location' && !s.obsShowDeleted
    // Shared by the Observations tab's header and rows: category and type,
    // location, summary, severity, status, and when it was captured (CP-08 AC2).
    // By location, the headings say where, so there is no Location column.
    // The capture time wraps after its year: "11 Apr 2026" over "09:22".
    const obsCols = narrow
      ? '36px minmax(0,1fr) 90px'
      : obsByLocation
        ? '40px minmax(0,1.3fr) minmax(0,2.8fr) 110px 150px 96px'
        : '40px minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.8fr) 110px 150px 96px'
    // Real recording needs a capture session on the server; without one, voice stays simulated.
    const liveVoice = !!liveCapture
    // Capture starts from a location; the sheet stays open until one is chosen.
    const currentLocation = places.locations.find((l) => l.id === s.fLocationId) ?? null
    // It opens by itself while none is chosen, unless closed this visit.
    const locSheetOpen =
      sc === 'field' &&
      capture.state?.status !== 'starting' &&
      (s.locOpen || (!currentLocation && !s.locDismissed))
    // Closed without choosing, the bar stays highlighted until one is, and
    // Save opens the picker again.
    const pickerClosed: Partial<WorkflowState> = {
      locOpen: false,
      locDismissed: true,
      locQuery: '',
      locAdding: false,
      locEdit: null,
      ...FORM_CLEAR,
      locRemove: null,
    }
    const query = s.locQuery.trim().toLowerCase()
    // The picker's groups, of the locations the search matches (CP-16).
    const locationGroups = groupLocations(
      places.locations.filter((l) => !query || locationLabel(l).toLowerCase().includes(query)),
    )
    const currentGroup = currentLocation && groupKey(currentLocation)
    // A recording is named by its number; an uploaded file keeps its own name.
    const addClip = (audio: Blob, name: string | null, length: string | null) => {
      const id = ++media.clips
      const clip = {
        id,
        name: name ?? 'Recording ' + id,
        length,
        audio,
        url: URL.createObjectURL(audio),
      }
      updateState((previous) => ({ ...previous, fClips: [...previous.fClips, clip] }))
    }
    const dropClip = (clip: VoiceClip) => {
      URL.revokeObjectURL(clip.url)
      updateState((previous) => ({
        ...previous,
        fClips: previous.fClips.filter((c) => c.id !== clip.id),
      }))
    }
    // Everything in the form becomes one observation, filed under the tags
    // it shows: the note exactly as typed (CP-02), each recording with its one
    // transcription (CP-03 AC3), each photo (CP-04) and each handwritten page
    // with its one transcription (CP-19 AC6). If it fails, everything stays
    // for another try. The standard is left to drafting; the engineer can
    // name one later through Edit.
    async function saveToGateway(
      location: SiteLocation,
      note: string | undefined,
      clips: VoiceClip[],
      photos: PhotoFile[],
      pages: PhotoFile[],
    ) {
      const reference = s.captureTarget.reference
      const { fCats: cats, fSev: severity } = s
      setState({ fSaving: true, fSaveError: null })
      let observation
      try {
        observation = await saveObservation(
          reference,
          {
            note,
            copeDimensions: copeDimensionsOf(cats),
            severity,
            locationId: location.id,
          },
          clips.map((c) => ({ name: c.name, audio: c.audio })),
          photos.map((p) => ({ name: p.name, image: p.image })),
          pages.map((p) => ({ name: p.name, image: p.image })),
        )
      } catch (error: unknown) {
        const problems = error instanceof GatewayError ? Object.values(error.fields) : []
        const cause = problems.length
          ? problems.join(' ')
          : error instanceof GatewayError && error.status !== null
            ? error.message
            : 'The gateway could not be reached.'
        setState({
          fSaving: false,
          fSaveError: {
            title: 'Observation not saved',
            message: cause + ' Everything is still listed; press Save observation to try again.',
          },
        })
        return
      }
      captured.add(observation)
      // Re-reading the list keeps it refreshing until the transcriptions finish.
      if (clips.length || pages.length) captured.reload()
      // The gateway now serves them; the previews in this browser are done.
      for (const file of [...clips, ...photos, ...pages]) URL.revokeObjectURL(file.url)
      // Keep anything added or changed while the observation was saving. The
      // tags start again empty, so the next observation's are chosen for it.
      // The Observations tab is to open here, with this one marked New.
      updateState((previous) => ({
        ...previous,
        obsReturn: {
          locationId: location.id,
          ids: [...(previous.obsReturn?.ids ?? []), observation.id],
          local: previous.obsReturn?.local ?? 0,
        },
        obsFolded: { ...previous.obsFolded, [groupKey(location)]: false },
        fSaving: false,
        fNote: previous.fNote === note ? '' : previous.fNote,
        fClips: previous.fClips.filter((c) => !clips.includes(c)),
        fPhotos: previous.fPhotos.filter((p) => !photos.includes(p)),
        fPages: previous.fPages.filter((p) => !pages.includes(p)),
        fCats: sameCategories(previous.fCats, cats) ? [] : previous.fCats,
        fSev: previous.fSev === severity ? '' : previous.fSev,
        fToast: {
          text:
            'Observation saved to ' +
            reference +
            '.' +
            (clips.length || pages.length
              ? ' Transcribing ' +
                [
                  clips.length ? plural(clips.length, 'recording') : '',
                  pages.length ? plural(pages.length, 'page') : '',
                ]
                  .filter(Boolean)
                  .join(' and ') +
                ' now.'
              : ''),
        },
      }))
      later(() => setState({ fToast: null }), 3200)
    }
    // Changes the observation kept in this browser under a local-<n> row key,
    // a sample one: the demo keeps the change in memory only.
    function changeLocal(key: string, change: (o: Observation) => Observation) {
      const n = Number(key.slice('local-'.length))
      const list = localRecent.map((x, i) => (i === n ? change(x) : x))
      return isDemoCapture
        ? { fRecent: list }
        : { captureObs: { ...s.captureObs, [s.captureTarget.reference]: list } }
    }
    // Why the gateway refused a change to an observation, to show the engineer.
    function refusal(error: unknown) {
      const problems = error instanceof GatewayError ? Object.values(error.fields) : []
      return problems.length
        ? problems.join(' ')
        : error instanceof GatewayError && error.status !== null
          ? error.message
          : 'The gateway could not be reached.'
    }
    // The signed-in engineer, now, for a change kept in this browser (CP-08).
    const stampNow = (): Stamp => ({
      at: new Date().toISOString(),
      by: { id: session.user.id, name: session.user.name },
    })
    // Saves the Edit dialog: the tags (CP-06) and the note (CP-08 AC8), in one
    // request on the gateway for a saved observation, sending only what
    // changed, or in this browser for one kept in the demo. The note is saved
    // exactly as typed, and a blank one removes it, which an observation with
    // no recording can't do (AC9). On failure the dialog stays open with the
    // changes (AC18).
    async function saveTags() {
      const edit = s.tagEdit
      if (!edit || !tagRow || s.tagBusy) return
      const { o } = tagRow
      // Unlisted (e.g. a sample observation on a live assessment): left as it is.
      const location = places.locations.find((l) => l.id === edit.locationId)
      const noteChanged = edit.note !== (o.detail ?? '')
      const retry = ' Your changes are still here; press Save changes to try again.'
      if (!o.id) {
        if (noteChanged && !edit.note.trim() && !o.audio && !o.media.length && !o.pages?.length)
          return setState({
            tagError:
              'An observation needs a note, a recording, a photo or a page, so this note can’t be removed.' +
              retry,
          })
        setState({
          ...changeLocal(edit.key, (x) => ({
            ...x,
            cats: edit.cats,
            sev: edit.sev,
            std: edit.std,
            ...(location && {
              locationName: location.name,
              building: location.building,
              floor: location.floor,
              locationId: location.id,
            }),
            ...(noteChanged && {
              detail: edit.note,
              text: edit.note.trim() ? edit.note : x.text,
            }),
            edited: stampNow(),
          })),
          tagEdit: null,
        })
        toast('Changes saved. They are kept in this demo only.')
        return
      }
      const changes = {
        ...(!sameCategories(edit.cats, o.cats) && {
          copeDimensions: copeDimensionsOf(edit.cats),
        }),
        ...(edit.sev !== o.sev && { severity: edit.sev }),
        ...(location && location.id !== o.locationId && { locationId: location.id }),
        ...(edit.std !== o.std && { standard: edit.std || null }),
        ...(noteChanged && { note: edit.note.trim() ? edit.note : null }),
      }
      if (!Object.keys(changes).length) return setState({ tagEdit: null })
      setState({ tagBusy: true, tagError: null })
      let saved
      try {
        saved = await updateObservation(o.id, changes)
      } catch (error: unknown) {
        return setState({ tagBusy: false, tagError: refusal(error) + retry })
      }
      captured.replace(saved)
      setState({ tagBusy: false, tagEdit: null })
      toast('Changes saved.')
    }
    // The CP-08 dialogs below each throw the reason a change failed, so the
    // dialog shows it and keeps what was typed for another try (AC18).
    // Saves a corrected transcript (AC10). The gateway keeps Whisper's words
    // beside it, and drafting uses the correction.
    async function saveTranscript(text: string) {
      const recording = dialogRow?.o.recordings?.find((r) => r.id === s.obsDialog?.recordingId)
      if (!dialogRow?.o.id || !recording) return
      if (text === recording.text) return setState({ obsDialog: null })
      let saved
      try {
        saved = await correctTranscript(dialogRow.o.id, recording.id, text)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      setState({ obsDialog: null })
      toast('Transcript corrected. Report drafting uses your wording.')
    }
    // Deletes the observation once confirmed (AC12), a soft delete that Show
    // deleted can undo. Drafting leaves it out from then on (AC13).
    async function confirmDelete() {
      if (!dialogRow) return
      const { o, key } = dialogRow
      if (!o.id) {
        setState({
          ...changeLocal(key, (x) => ({ ...x, deleted: stampNow() })),
          obsDialog: null,
          obsOpen: null,
        })
        return toast('Observation deleted in this demo only. Choose Deleted to restore it.')
      }
      let saved
      try {
        saved = await deleteObservation(o.id)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      setState({ obsDialog: null, obsOpen: null })
      toast('Observation deleted. Report drafting leaves it out; Deleted can restore it.')
    }
    // Restores a deleted observation to the list and drafting (AC14).
    async function restoreRow(key: string, o: Observation) {
      if (!o.id) {
        setState({ ...changeLocal(key, (x) => ({ ...x, deleted: null })), obsOpen: null })
        return toast('Observation restored in this demo only.')
      }
      let saved
      try {
        saved = await restoreObservation(o.id)
      } catch (error: unknown) {
        return toast(refusal(error) + ' Try again.', 'warning')
      }
      captured.replace(saved)
      setState({ obsOpen: null })
      toast('Observation restored. Report drafting uses it again.')
    }
    // Adds the recordings and photos listed in the Add media dialog (CP-08):
    // through the gateway for a saved observation, which stores and transcribes
    // them, or in this demo for a sample one. Throws the reason a save failed,
    // so the dialog keeps the list for another try.
    async function addMedia(clips: VoiceClip[], photos: PhotoFile[]) {
      if (!dialogRow) return
      const { o, key } = dialogRow
      const what = [
        clips.length ? plural(clips.length, 'recording') : '',
        photos.length ? plural(photos.length, 'photo') : '',
      ]
        .filter(Boolean)
        .join(' and ')
      if (!o.id) {
        const added = stampNow()
        setState({
          ...changeLocal(key, (x) => ({
            ...x,
            media: [
              ...x.media,
              ...photos.map((p) => ({ id: 'local-' + p.id, name: p.name, url: p.url, added })),
            ],
            recordings: [
              ...(x.recordings ?? []),
              ...clips.map((c) => demoRecording('local-' + c.id, c.name, c.url, added)),
            ],
            // What it holds changed since it was read (CP-21).
            interpretation: x.interpretation
              ? { ...x.interpretation, outOfDate: true }
              : x.interpretation,
            edited: added,
          })),
          obsDialog: null,
        })
        return toast('Added ' + what + ' in this demo only.')
      }
      let saved
      try {
        saved = await addObservationMedia(
          o.id,
          clips.map((c) => ({ name: c.name, audio: c.audio })),
          photos.map((p) => ({ name: p.name, image: p.image })),
        )
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      // Re-reading the list keeps it refreshing until the transcriptions finish.
      if (clips.length) captured.reload()
      // The gateway now serves them; the previews in this browser are done.
      for (const file of [...clips, ...photos]) URL.revokeObjectURL(file.url)
      setState({ obsDialog: null })
      toast(
        'Added ' +
          what +
          '.' +
          (clips.length ? ' Transcribing ' + plural(clips.length, 'recording') + ' now.' : ''),
      )
    }
    // Moves a sample observation's recording or photo out of, or back into,
    // its evidence, in this demo only (CP-08).
    function moveLocal(x: Observation, item: { kind: MediaKind; id: string; name: string }) {
      const removed = x.removedMedia?.find((m) => m.id === item.id)
      if (removed)
        return {
          ...x,
          removedMedia: x.removedMedia!.filter((m) => m !== removed),
          ...(item.kind === 'photos'
            ? { media: [...x.media, { id: removed.id, name: removed.name, url: removed.url }] }
            : {
                recordings: [
                  ...(x.recordings ?? []),
                  demoRecording(removed.id, removed.name, removed.url ?? '', null),
                ],
              }),
          edited: stampNow(),
        }
      const photo = x.media.find((m) => (m.id ?? m.name) === item.id)
      const recording = x.recordings?.find((r) => r.id === item.id)
      return {
        ...x,
        media: x.media.filter((m) => m !== photo),
        recordings: x.recordings?.filter((r) => r !== recording),
        removedMedia: [
          ...(x.removedMedia ?? []),
          {
            ...item,
            url: photo?.url ?? recording?.audioUrl ?? null,
            removed: stampNow(),
          },
        ],
        interpretation:
          (photo || recording) && x.interpretation
            ? { ...x.interpretation, outOfDate: true }
            : x.interpretation,
        edited: stampNow(),
      }
    }
    // Removes the recording or photo in the Remove dialog (CP-08), a soft
    // removal: the gateway keeps it to restore, and drafting stops using it.
    async function confirmRemoveMedia() {
      const item = s.obsDialog?.media
      if (!dialogRow || !item) return
      const { o, key } = dialogRow
      const noun = item.kind === 'recordings' ? 'Recording' : 'Photo'
      if (!o.id) {
        setState({ ...changeLocal(key, (x) => moveLocal(x, item)), obsDialog: null })
        return toast(noun + ' removed in this demo only. Restore it under Removed media.')
      }
      let saved
      try {
        saved = await removeMedia(o.id, item.kind, item.id)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      setState({ obsDialog: null })
      toast(
        noun +
          ' removed. ' +
          (item.kind === 'recordings'
            ? 'Report drafting no longer uses its transcript. '
            : 'It leaves the Photos tab. ') +
          'Restore it under Removed media.',
      )
    }
    // Restores a removed recording or photo to the observation (CP-08).
    async function restoreItem(
      key: string,
      o: Observation,
      item: { kind: MediaKind; id: string; name: string },
    ) {
      const noun = item.kind === 'recordings' ? 'Recording' : 'Photo'
      if (!o.id) {
        setState(changeLocal(key, (x) => moveLocal(x, item)))
        return toast(noun + ' restored in this demo only.')
      }
      let saved
      try {
        saved = await restoreMedia(o.id, item.kind, item.id)
      } catch (error: unknown) {
        return toast(refusal(error) + ' Try again.', 'warning')
      }
      captured.replace(saved)
      toast(
        noun +
          ' restored.' +
          (item.kind === 'recordings' ? ' Report drafting uses its transcript again.' : ''),
      )
    }
    // Adds the location the picker's form describes and captures in it
    // straight away, or saves the changes to the one being edited (CP-16): in
    // a building, with an optional level, or elsewhere on site, a name only.
    // A level is saved in its standard spelling ("L2" as Level 2). A building
    // or level new to the site that looks mistyped is asked about first,
    // unless the engineer chose to keep it as typed (`kept`).
    async function submitLocation(form = s.lf, kept = s.lfKept) {
      const editing = s.locEdit
      const inBuilding = form.kind === 'building'
      const building = inBuilding ? form.building.trim() : ''
      const typedFloor = inBuilding ? form.floor.trim() : ''
      const floor = typedFloor && (standardLevel(typedFloor) ?? typedFloor)
      const details = {
        name: form.name.trim(),
        ...(building && { building }),
        ...(floor && { floor }),
      }
      const missing = {
        ...(inBuilding && !building && { building: 'Name the building.' }),
        ...(!details.name && { name: 'Name the location.' }),
      }
      if (Object.keys(missing).length) return setState({ lf: form, lfErrors: missing })
      const others = places.locations.filter((l) => l.id !== editing)
      const isNew = (field: NameCheck['field'], name: string) =>
        !!name && kept[field] !== name && !others.some((l) => sameName(l[field], name))
      // The name a building or location was probably meant to be: a standard
      // one a slip away ("blcok a" as Block A), else one already on the site,
      // unless what was typed is itself standard, so a correct spelling is
      // never pulled towards a mistyped one.
      const guess = (field: 'building' | 'name', typed: string, standard: string[]) =>
        isNew(field, typed)
          ? (correctName(typed, standard) ??
            (isStandardName(typed, standard)
              ? null
              : similarName(
                  typed,
                  others.map((l) => l[field]),
                )))
          : null
      // A building or location is asked about only when it looks mistyped; a
      // level, whenever it is not one the app knows.
      const buildingGuess = guess('building', building, BUILDING_WORDS)
      const nameGuess = guess('name', details.name, LOCATION_NAMES)
      const lfCheck: NameCheck | null = buildingGuess
        ? { field: 'building', typed: building, suggestion: buildingGuess }
        : isNew('floor', floor) && levelRank(floor) === null
          ? {
              field: 'floor',
              typed: floor,
              suggestion:
                suggestLevel(floor) ??
                similarName(
                  floor,
                  others.map((l) => l.floor),
                ),
            }
          : nameGuess
            ? { field: 'name', typed: details.name, suggestion: nameGuess }
            : null
      if (lfCheck) return setState({ lf: form, lfKept: kept, lfErrors: {}, lfCheck })
      setState({ lf: form, lfBusy: true, lfErrors: {}, lfCheck: null })
      let location: SiteLocation
      try {
        location = editing ? await places.edit(editing, details) : await places.add(details)
      } catch (error: unknown) {
        const fields = error instanceof GatewayError ? error.fields : {}
        const lfErrors = Object.keys(fields).length
          ? fields
          : {
              name:
                error instanceof GatewayError
                  ? error.message
                  : editing
                    ? 'The location could not be changed.'
                    : 'The location could not be added.',
            }
        return setState({ lfBusy: false, lfErrors })
      }
      setState({
        lfBusy: false,
        lf: BLANK_LOCATION,
        lfKept: {},
        locAdding: false,
        locEdit: null,
        obsLocForm: false,
        locQuery: '',
        // A new location is where the engineer is now; an edited one changes
        // nothing about where they are.
        ...(!editing && { locOpen: false, fLocationId: location.id }),
      })
      if (!editing) return
      // Every observation saved there follows it: the gateway's are listed
      // again, and those kept in this browser take the new details.
      if (places.live) captured.reload()
      const follow = (list: Observation[]) =>
        list.map((o) =>
          o.locationId === location.id
            ? {
                ...o,
                locationName: location.name,
                building: location.building,
                floor: location.floor,
              }
            : o,
        )
      updateState((previous) => ({
        ...previous,
        fRecent: follow(previous.fRecent),
        captureObs: Object.fromEntries(
          Object.entries(previous.captureObs).map(([ref, list]) => [ref, follow(list)]),
        ),
      }))
    }
    // Removes the location the Remove this location? dialog confirms. The
    // gateway refuses one with observations, and the dialog shows its reason.
    // Removing the location in use leaves none chosen, so the sheet stays open.
    async function removeLocation() {
      if (!s.locRemove) return
      try {
        await places.remove(s.locRemove)
      } catch (error: unknown) {
        throw new Error(
          error instanceof Error ? error.message : 'The location could not be removed.',
          { cause: error },
        )
      }
      setState({ locRemove: null })
    }
    async function retryVoice(id: string, recordingId: string) {
      try {
        await retryTranscription(id, recordingId)
        captured.reload()
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.message : 'The retry was not accepted.'
        toast(cause + ' Try again.', 'warning')
      }
    }
    // The same for a handwritten page whose transcription failed (CP-19 AC11).
    async function retryPage(id: string, pageId: string) {
      try {
        await retryPageTranscription(id, pageId)
        captured.reload()
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.message : 'The retry was not accepted.'
        toast(cause + ' Try again.', 'warning')
      }
    }
    // Transcribes a finished page again, when its text looks misread (CP-20).
    async function transcribeAgain(id: string, pageId: string) {
      try {
        await retranscribePage(id, pageId)
        captured.reload()
      } catch (error: unknown) {
        toast(refusal(error) + ' Try again.', 'warning')
      }
    }
    // Reads a saved observation when the engineer asks (CP-05, CP-21): the
    // first reading, or a new one after a failure or a change.
    async function readSaved(id: string) {
      try {
        await readObservation(id)
        captured.reload()
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.message : 'The request was not accepted.'
        toast(cause + ' Try again.', 'warning')
      }
    }
    // A sample proposal settles after a moment, as a real reading would.
    // Matched by its sample flag, not its place in the list, which a later
    // observation shifts.
    function settleSamples() {
      const settle = (list: Observation[]) =>
        list.map((x) =>
          x.interpretation?.sample && x.interpretation.status === 'interpreting'
            ? { ...x, interpretation: { ...x.interpretation, status: 'interpreted' as const } }
            : x,
        )
      updateState((previous) => ({
        ...previous,
        fRecent: settle(previous.fRecent),
        captureObs: Object.fromEntries(
          Object.entries(previous.captureObs).map(([ref, list]) => [ref, settle(list)]),
        ),
      }))
    }
    // Reads a sample observation in this demo: nothing is read here, so a
    // labelled sample proposal stands in (CP-05, CP-21).
    function readSample(key: string) {
      setState(
        changeLocal(key, (x) => ({
          ...x,
          interpretation: sampleInterpretation(x.cats, x.locationName, x.media.length > 0),
        })),
      )
      later(settleSamples, 2000)
    }
    async function startRecording() {
      try {
        const recorder = await record((audio, length) => {
          if (media.recorder === recorder) media.recorder = null
          // Discarded with its draft (dropDraftFiles): the clip goes nowhere.
          if (discarded.has(recorder)) return
          // Stopped here or by leaving capture: the clock goes back to 00:00.
          updateState((previous) => ({ ...previous, fRec: false, fSecs: 0 }))
          addClip(audio, null, length)
        })
        media.recorder = recorder
      } catch (error: unknown) {
        setState({
          fVoiceError: { title: 'Microphone unavailable', message: microphoneProblem(error) },
        })
        return
      }
      setState({ fRec: true, fSecs: 0, fVoiceError: null })
    }

    /* dashboard rows: demo rows until the gateway answers */
    // The gateway scopes persisted rows to the signed-in engineer. Sample rows
    // remain explicitly labelled demo data when the gateway is unavailable.
    const serverIds = new Set(serverRows?.map((r) => r.id))
    const visibleCreated = s.createdRows.filter(
      (r) =>
        !r.persisted || session.user.role === 'knowledge_admin' || r.engineerId === session.user.id,
    )
    const rows = serverRows
      ? [...visibleCreated.filter((r) => !serverIds.has(r.id)), ...serverRows]
      : [...visibleCreated, ...ROWS]
    // Every assessment shows its own record, the demo one included. The demo
    // keeps sample drafting and review only while it is not on the server.
    const openRow = rows.find((r) => r.id === s.captureTarget.reference)
    // The Overview counts what the server holds for an assessment on it, so the
    // count agrees with the report sections; sample observations kept in this
    // browser show only on the Observations tab. Offline, the browser's are all
    // there is.
    const savedCount = openRow?.persisted ? captured.observations.length : fieldSaved

    /* nav */
    // The route guard (F-05): screens the role cannot open are left out of
    // the navigation, and opening one by URL shows why it is blocked.
    const canEdit = can('assessments:edit', session)
    const tabBlocked = isAssessment && !canOpenTab(s.tab, session)
    const routeBlocked = !canOpen(sc, session) || tabBlocked
    // The saved assessment being worked on, the demo one included: archiving
    // goes by its record even where the workspace shows sample content.
    // Capture is offered only for an assessment on the work list, which the
    // gateway limits to the engineer's own, so the demo default never opens
    // for an engineer it is not assigned to. An archived one takes no captures.
    const targetRow = rows.find((r) => r.id === s.captureTarget.reference)
    const canCapture = !!targetRow && targetRow.status !== STATUS_LABEL.archived
    const isMine = !!targetRow?.persisted && targetRow.engineerId === session.user.id
    // Changing an observation takes the assessment's assigned engineer, and
    // not once it is archived (CP-08 AC17). The gateway decides; the browser
    // hides the actions once the work list shows they'd be refused, for the
    // sample observations too, which change in this browser only.
    const canChangeObs = canEdit && (!targetRow?.persisted || (isMine && canCapture))
    // An observation's handwritten pages as shown (CP-19): where each stands
    // when there is no text, Retry after a failure (open to any risk engineer,
    // as a recording's), and Transcribe again once one is finished (only for
    // whoever may change the observation, as it replaces evidence; CP-20).
    const pageViews = (o: Observation): PageView[] =>
      (o.pages ?? []).map((p) => ({
        ...p,
        note: pageNote(p),
        retry: canEdit && !o.deleted && o.id ? () => void retryPage(o.id!, p.id) : null,
        again:
          canChangeObs && !o.deleted && o.id && p.status === 'transcribed'
            ? () => void transcribeAgain(o.id!, p.id)
            : null,
      }))
    // The assessment's handwritten pages (CP-19), gathered as the photo
    // collection gathers its photos: every page of an observation not deleted,
    // newest first, each with the observation it belongs to.
    const scanCollection = allRows
      .filter(({ o }) => !o.deleted)
      .flatMap(({ o, key }) =>
        pageViews(o).map((page) => ({
          key: key + '/' + page.id,
          page,
          where: placeOf(o),
          cat: categoryLabel(o.cats),
          time: o.time,
          openObservation: () =>
            setState({ tab: 'observations', obsOpen: key, obsShowDeleted: false, of: NO_FILTERS }),
        })),
      )
    // New assessment and capture are actions on the Dashboard and workspace
    // headers, so the navigation lists only places: the work list, and the
    // assessments last opened. Only those still on the work list show, as the
    // gateway limits it to the engineer's own. The live light marks the one
    // being captured for.
    const recentItems = s.recent.flatMap((r) => {
      const row = rows.find((x) => x.id === r.reference)
      if (!row) return []
      return [
        {
          value: RECENT_PREFIX + r.reference,
          label: row.site,
          icon: 'file-pen',
          live: !!liveCapture && r.reference === s.captureTarget.reference,
        },
      ]
    })
    const navSections = [
      {
        label: 'Assessments',
        items: [
          {
            value: 'dashboard',
            label: 'Dashboard',
            icon: 'inbox',
            count: rows.length,
          },
        ],
      },
      {
        label: 'Knowledge',
        items: [{ value: 'chat', label: 'Ask the knowledge base', icon: 'message-square' }],
      },
      { label: 'Recent', items: recentItems },
      {
        label: 'Administration',
        items: [
          {
            value: 'users',
            label: 'User accounts',
            icon: 'users',
          },
          {
            value: 'knowledge',
            label: 'Knowledge base',
            icon: 'library',
          },
        ],
      },
      {
        label: 'Reporting',
        items: [{ value: 'usage', label: 'Usage and costs', icon: 'files' }],
      },
    ]
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          canOpen(item.value.startsWith(RECENT_PREFIX) ? 'assessment' : item.value, session),
        ),
      }))
      .filter((section) => section.items.length > 0)

    const q = s.q.trim().toLowerCase()
    // Archived is a view of its own, Archived (n), not a status (CP-17).
    const fStatus = s.fStatus === STATUS_LABEL.archived ? 'All statuses' : s.fStatus
    const isArchived = (r: AssessmentRow) => r.status === STATUS_LABEL.archived
    const filtered = rows
      .filter((r) => {
        if (q && !(r.site + ' ' + r.client + ' ' + r.id).toLowerCase().includes(q)) return false
        if (isArchived(r) !== s.showArchived) return false
        if (!s.showArchived && fStatus !== 'All statuses' && r.status !== fStatus) return false
        if (s.fDate && !DATE_FILTERS[s.fDate](r)) return false
        return true
      })
      .sort((a, b) =>
        s.workSort === 'Report due: earliest first'
          ? (a.reportDueDate || '9999-12-31').localeCompare(b.reportDueDate || '9999-12-31')
          : (b.siteVisitDate || '').localeCompare(a.siteVisitDate || ''),
      )
      .map((r) => ({
        ...r,
        overdue: isOverdue(r),
        sevIcon: SEV[r.sev].icon,
        sevColor: SEV[r.sev].color,
        stackMeta: r.client + ' · ' + r.type + ' · ' + r.eng,
        dueDate: r.reportDueDate ? formatDay(r.reportDueDate) : 'Not set',
        countdown: dueCountdown(r),
      }))
    // The work list by client, then site, in name order, each site's visits in
    // the order chosen (CP-17 AC9). A site saved on the gateway is
    // grouped by its ids; the demo's by name. A search opens every client.
    const byName = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    const workClients = new Map<
      string,
      {
        key: string
        title: string
        sites: Map<
          string,
          { key: string; name: string; address: string | null; rows: typeof filtered }
        >
      }
    >()
    for (const r of s.workByClient && !s.showArchived ? filtered : []) {
      const key = r.record?.clientId ?? 'name:' + clientKey(r.client)
      const client = workClients.get(key) ?? { key, title: r.client, sites: new Map() }
      workClients.set(key, client)
      const siteKey = r.record?.site.id ?? 'name:' + clientKey(r.site)
      const site = client.sites.get(siteKey) ?? {
        key: siteKey,
        name: r.site,
        address: r.record?.site.address ?? null,
        rows: [],
      }
      client.sites.set(siteKey, site)
      site.rows.push(r)
    }
    // A site on the gateway, with a client, can be visited again (AC6): the
    // create form opens on it, its copy ticked.
    const newVisit = (a: Assessment) => () =>
      setState({
        screen: 'create',
        cfEdit: null,
        cfErr: false,
        cfServerError: null,
        cf: {
          ...blankCreateForm(),
          client: a.client,
          clientId: a.clientId ?? '',
          siteId: a.site.id,
          site: a.site.name,
          addr: a.site.address ?? '',
          jurisdiction: a.site.jurisdiction,
          type: a.site.facilityType,
        },
      })
    const workGroups = [...workClients.values()]
      .sort((a, b) => byName(a.title, b.title))
      .map((client) => {
        const sites = [...client.sites.values()].sort((a, b) => byName(a.name, b.name))
        const count = sites.reduce((n, site) => n + site.rows.length, 0)
        const open = !!q || !s.workFolded[client.key]
        return {
          key: client.key,
          title: client.title,
          countLabel: plural(sites.length, 'site') + ' · ' + plural(count, 'assessment'),
          open,
          toggle: () => setState({ workFolded: { ...s.workFolded, [client.key]: open } }),
          sites: sites.map((site) => {
            const record = site.rows.find((r) => r.record?.clientId)?.record
            return {
              key: site.key,
              name: site.name,
              address: site.address,
              countLabel: plural(site.rows.length, 'visit'),
              rows: site.rows,
              newVisit: record && canOpen('create', session) ? newVisit(record) : undefined,
            }
          }),
        }
      })

    /* generation */
    const GST: Record<
      string,
      {
        tone: string
        icon: string
        label: string
      }
    > = {
      done: {
        tone: 'low',
        icon: 'check',
        label: 'Drafted',
      },
      processing: {
        tone: 'ai',
        icon: 'sparkles',
        label: 'Drafting',
      },
      queued: {
        tone: 'neutral',
        icon: 'ellipsis',
        label: 'Queued',
      },
      insufficient: {
        tone: 'moderate',
        icon: 'triangle-alert',
        label: 'Insufficient evidence',
      },
      failed: {
        tone: 'critical',
        icon: 'octagon-alert',
        label: 'Failed',
      },
      stopped: {
        tone: 'neutral',
        icon: 'x',
        label: 'Stopped',
      },
      manual: {
        tone: 'info',
        icon: 'pencil',
        label: 'Yours to write',
      },
    }
    const gsecs = s.gsecs.map((g) => {
      const m = GST[g.st]
      return {
        ...g,
        tone: m.tone,
        icon: m.icon,
        label: m.label,
        isProcessing: g.st === 'processing',
        isInsufficient: g.st === 'insufficient',
        isFailed: g.st === 'failed',
        showConf: g.st === 'done',
        evLabel: g.ev + (g.ev === 1 ? ' source' : ' sources'),
        barStyle: {
          display: 'block',
          height: '100%',
          width: (g.p || 0) + '%',
          background: 'var(--ai-fg)',
          borderRadius: '2px',
          transition: 'width 260ms cubic-bezier(.2,0,.2,1)',
        } as React.CSSProperties,
      }
    })
    const doneCount = s.gsecs.filter((g) => g.st === 'done').length
    const attention = s.gsecs.filter(
      (g) => g.st === 'insufficient' || g.st === 'failed' || g.st === 'stopped',
    ).length

    /* review */
    const sel = s.sel
    const RST: Record<
      string,
      {
        icon: string
        color: string
      }
    > = {
      draft: {
        icon: 'sparkles',
        color: 'var(--icon-draft)',
      },
      edited: {
        icon: 'pencil',
        color: 'var(--text-secondary)',
      },
      accepted: {
        icon: 'circle-check',
        color: 'var(--icon-final)',
      },
      flagged: {
        icon: 'triangle-alert',
        color: 'var(--icon-signoff)',
      },
    }
    const railItems = Object.keys(TITLES).map((k) => {
      const rejected = !!s.rejected[k]
      const st = s.secSt[k] || 'draft'
      const active = k === sel
      const g = RST[st]
      return {
        id: k,
        n: TITLES[k].split(' ')[0],
        title: TITLES[k].split(' ').slice(1).join(' '),
        isRejected: rejected,
        notRejected: !rejected,
        icon: g.icon,
        iconColor: g.color,
        rowStyle: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '9px 18px',
          cursor: 'pointer',
          opacity: rejected ? '.5' : '1',
          borderLeft: '2px solid ' + (active ? 'var(--action-primary)' : 'transparent'),
          background: active ? 'var(--surface-selected)' : 'transparent',
          transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
        } as React.CSSProperties,
      }
    })
    const selOpen = open.filter((o) => o.section === sel)
    const selRejected = !!s.rejected[sel]
    const claimFlagged = s.u3 === null
    const conflictFlagged = s.u2 === null
    const evidence = (EVIDENCE[sel] || []).map((e) => ({
      ...e,
      excerpt: e.excerpt || '',
      wrapStyle: {
        borderRadius: '5px',
        transition: 'box-shadow 120ms cubic-bezier(.2,0,.2,1)',
        boxShadow: s.activeCite === e.index ? 'var(--focus-ring)' : 'none',
      } as React.CSSProperties,
    }))

    /* export */
    const reviewed = reviewedCount()
    const blocked = isBlocked()
    const checklist = [
      {
        label: 'All sections reviewed',
        value: reviewed + ' of ' + live.length,
        ok: live.length > 0 && reviewed === live.length,
      },
      {
        label: 'No unresolved review items',
        value: open.length === 0 ? 'None' : open.length + ' open',
        ok: open.length === 0,
      },
      {
        label: 'Photographs captioned',
        value: '28 of 28',
        ok: true,
      },
      {
        label: 'Client and site details confirmed',
        value: 'Confirmed',
        ok: true,
      },
    ].map((c) => ({
      ...c,
      icon: c.ok ? 'circle-check' : 'triangle-alert',
      color: c.ok ? 'var(--status-low-fg)' : 'var(--status-moderate-fg)',
      valueStyle: {
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        color: c.ok ? 'var(--status-low-fg)' : 'var(--status-moderate-fg)',
      } as React.CSSProperties,
    }))

    /* create form */
    // Engineers are found by searching, never listed in full, so the form
    // stays short however many there are.
    const engQuery = s.cf.engQuery.trim().toLowerCase()
    const engMatches = engQuery
      ? directory.filter((e) =>
          [e.name, e.staffId, e.jobTitle ?? ''].some((text) =>
            text.toLowerCase().includes(engQuery),
          ),
        )
      : []
    const engChoice = (e: AssignableEngineer) => ({
      id: e.id,
      name: e.name,
      initials: e.name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join(''),
      role: [e.staffId, e.jobTitle].filter(Boolean).join(' · '),
      on: s.cf.eng === e.id,
      you: e.id === session.user.id,
    })
    const assignedEng = directory.find((e) => e.id === s.cf.eng)
    // The client and site (CP-17): a listed client offers its sites, the one
    // chosen bringing its details and its latest visit's locations; a new
    // client, or Add a new site, takes new details. Editing keeps both, and
    // the site's details are locked once another assessment shares it.
    const editedRecord = s.cfEdit ? rows.find((r) => r.id === s.cfEdit)?.record : undefined
    const clientSitesNow = listedClient ? clientSites[listedClient.id] : undefined
    const chosenSite = clientSitesNow?.find((x) => x.id === s.cf.siteId)
    // A site chosen by New visit, shown as it is while the client's sites load.
    const awaitingSite =
      !s.cfEdit && !!s.cf.siteId && s.cf.siteId !== NEW_SITE && !!listedClient && !clientSitesNow
    const pickingSite = !s.cfEdit && !!clientSitesNow?.length
    const newSite =
      !s.cfEdit && !chosenSite && !awaitingSite && (!pickingSite || s.cf.siteId === NEW_SITE)
    const siteLocked = s.cfEdit ? !!editedRecord?.siteShared : !!chosenSite || awaitingSite
    const siteTaken = newSite ? clientSitesNow?.find((x) => sameName(x.name, s.cf.site)) : undefined
    const needsSiteName = !!s.cfEdit || newSite
    const cfProblems = [
      !s.cf.client.trim() && 'Name the client.',
      awaitingSite &&
        'The client’s sites are still loading. Create the assessment again in a moment.',
      pickingSite && !s.cf.siteId && 'Choose one of the client’s sites, or add a new one.',
      needsSiteName && !s.cf.site.trim() && 'Name the site.',
      siteTaken &&
        listedClient!.name +
          ' already has a site named ' +
          siteTaken.name +
          '. Choose it from the Site list instead.',
    ].filter((p): p is string => !!p)
    // A site's details as the form shows them, from the listed site chosen.
    const siteFields = (site?: ClientSite) =>
      site
        ? {
            site: site.name,
            addr: site.address ?? '',
            jurisdiction: site.jurisdiction,
            type: site.facilityType,
          }
        : { site: '', addr: '' }
    // A new client or site name close to a listed one, unless kept as typed.
    const nameCheck = (keptNames: string[]): WorkflowState['cf']['check'] => {
      const kept = (name: string) => keptNames.includes(clientKey(name))
      if (!listedClient && clients && !kept(s.cf.client)) {
        const suggestion = similarName(
          s.cf.client,
          clients.map((c) => c.name),
        )
        if (suggestion) return { field: 'client', typed: s.cf.client.trim(), suggestion }
      }
      if (newSite && clientSitesNow && !kept(s.cf.site)) {
        const suggestion = similarName(
          s.cf.site,
          clientSitesNow.map((x) => x.name),
        )
        if (suggestion) return { field: 'site', typed: s.cf.site.trim(), suggestion }
      }
      return null
    }

    /* field */
    const waveBars = Array.from(
      {
        length: 26,
      },
      (_, i) => {
        const h = s.fRec ? 6 + ((i * 7 + s.fSecs * 5) % 34) : 4
        return {
          style: {
            display: 'block',
            width: '4px',
            borderRadius: '2px',
            height: h + 'px',
            background: s.fRec ? 'var(--ai-fg)' : 'var(--graphite-300)',
            transition: 'height 180ms cubic-bezier(.2,0,.2,1)',
          } as React.CSSProperties,
        }
      },
    )
    const mm = String(Math.floor(s.fSecs / 60)).padStart(2, '0')
    const ss = String(s.fSecs % 60).padStart(2, '0')
    // What the capture draft holds, shown on the mode switcher. The demo's
    // sample transcript stands in for a recording.
    const noteWritten = !!s.fNote.trim()
    const voiceCount = s.fClips.length + (s.fTrans ? 1 : 0)
    // What Done would discard, a recording still running included: "a note,
    // 2 recordings, 1 photo and 1 page".
    const recordings = voiceCount + (s.fRec || s.fTransBusy ? 1 : 0)
    const unsaved = [
      noteWritten ? 'a note' : '',
      recordings ? plural(recordings, 'recording') : '',
      s.fPhotos.length ? plural(s.fPhotos.length, 'photo') : '',
      s.fPages.length ? plural(s.fPages.length, 'page') : '',
    ].filter(Boolean)
    const unsavedLabel =
      unsaved.length > 1
        ? unsaved.slice(0, -1).join(', ') + ' and ' + unsaved[unsaved.length - 1]
        : (unsaved[0] ?? '')
    // Leaving capture goes to a tab of the assessment it is part of: by its
    // back button to the Observations tab, unfiltered, where what was just
    // saved is listed; or to whichever tab is chosen.
    const toTab = (tab: string): Partial<WorkflowState> => ({
      screen: 'assessment',
      tab,
      obsShowDeleted: false,
      obsOpen: null,
      locOpen: false,
      ...(tab === 'observations' && { of: NO_FILTERS }),
    })
    // First asking Leave without saving? when something would be lost.
    const leaveCapture = (tab: string) =>
      setState(unsaved.length ? { fLeaveOpen: true, fLeaveTo: tab } : toTab(tab))
    // The Observations tab's rows, as the filters show them.
    const obsList = shownRows.map(({ o, key }) => {
      const open = s.obsOpen === key
      const sev = o.sev || 'low'
      const status = statusOf(o)
      // A deleted observation changes only by being restored.
      const canChange = canChangeObs
      // Opens the Edit dialog on its tags and note as they are now, or with
      // a proposal's wording or category already filled in (CP-05).
      const openEdit = (change: { note?: string; cats?: string[] } = {}) =>
        setState({
          tagEdit: {
            key,
            cats: o.cats,
            sev,
            locationId: o.locationId ?? '',
            std: o.std,
            note: o.detail ?? '',
            ...change,
          },
          tagError: null,
        })
      const reading = o.interpretation
      const proposed = reading?.status === 'interpreted' ? reading : null
      // It is read only when a risk engineer asks (CP-05, CP-21), through the
      // gateway, or in this demo for a sample observation.
      const read =
        canEdit && !o.deleted ? (o.id ? () => void readSaved(o.id!) : () => readSample(key)) : null
      // Recordings and photos can be added by whoever may change it, and
      // removed while something else stays captured (CP-08).
      const changing = canChange && !o.deleted
      const held =
        (o.detail?.trim() ? 1 : 0) +
        (o.audio ? 1 : 0) +
        (o.recordings?.length ?? 0) +
        o.media.length +
        (o.pages?.length ?? 0)
      const removing = (kind: MediaKind, id: string, name: string) =>
        changing && held > 1
          ? () => setState({ obsDialog: { kind: 'removeMedia', key, media: { kind, id, name } } })
          : null
      // Saved on the visit to capture just left (CP-16).
      const isNew =
        !!s.obsReturn &&
        (s.obsReturn.ids.includes(key) ||
          (key.startsWith('local-') && Number(key.slice('local-'.length)) < s.obsReturn.local))
      return {
        ...o,
        key,
        open,
        isNew,
        // Its building, level and location, e.g. "Warehouse · Ground · Bay 3".
        where: placeOf(o),
        // What it holds and where its recordings and photos stand (CP-08 AC2).
        typeLabel: typeLabel(o),
        status,
        statusTone:
          status === 'Transcribing' || status === 'Interpreting'
            ? 'info'
            : status.endsWith('failed')
              ? 'high'
              : null,
        canChange: canChange && !o.deleted,
        canRestore: canChange && !!o.deleted,
        editedLabel: o.edited ? 'Edited by ' + stampLabel(o.edited) : null,
        deletedLabel: o.deleted ? 'Deleted by ' + stampLabel(o.deleted) : null,
        deleteObs: () => setState({ obsDialog: { kind: 'delete', key } }),
        restoreObs: () => void restoreRow(key, o),
        editTags: () => openEdit(),
        addMedia: changing ? () => setState({ obsDialog: { kind: 'addMedia', key } }) : null,
        // Its photos, each opening the original, with who added any later.
        media: o.media.map((m) => ({
          ...m,
          addedLabel: m.added ? m.name + ' added by ' + stampLabel(m.added) : null,
          remove: removing('photos', m.id ?? m.name, m.name),
        })),
        removedMedia: (o.removedMedia ?? []).map((m) => ({
          ...m,
          removedLabel: 'Removed by ' + stampLabel(m.removed),
          restore: changing ? () => void restoreItem(key, o, m) : null,
        })),
        // What the model proposes from it (CP-05, CP-21), and what the
        // engineer can do with it. No action saves anything by itself: each
        // opens Edit, filled in, for the engineer to save. Not read yet, it
        // offers only Get AI proposal, to whoever may ask; afterwards, Get new
        // proposal (CP-08, CP-21).
        proposal: !reading
          ? read
            ? { status: 'unread' as const, read }
            : null
          : {
              ...reading,
              retry: read,
              useAsNote:
                canChange && !o.deleted && proposed?.description
                  ? () =>
                      openEdit({
                        note: o.detail
                          ? o.detail + '\n\n' + proposed.description
                          : proposed.description!,
                      })
                  : null,
              // Each proposed category, with Add while it is not one of the
              // observation's own: added to those it has.
              categories: reading.categories.map((c) => ({
                ...c,
                added: o.cats.includes(c.category),
                add:
                  canChange && !o.deleted && proposed && !o.cats.includes(c.category)
                    ? () => openEdit({ cats: withCategory(o.cats, c.category) })
                    : null,
                // A quote the gateway did not find in the item it cites.
                unverified: c.evidence.some((e) => e.verified === false),
              })),
            },
        icon: categoryIcon(o.cats),
        catLabel: categoryLabel(o.cats),
        color: 'var(--text-secondary)',
        chevron: open ? 'chevron-down' : 'chevron-right',
        // The capture date and time, e.g. "11 Apr 2026 09:22" (CP-08 AC2).
        clock: o.time || '',
        sev,
        sevLabel: sev.charAt(0).toUpperCase() + sev.slice(1),
        // Each recording shows its transcript, as corrected, or where its
        // transcription stands. Only a finished one can be corrected (AC10).
        recordings: (o.recordings ?? []).map((r) => ({
          ...r,
          retry: () => void retryVoice(o.id!, r.id),
          // A recording added in the demo has no transcript to correct.
          canCorrect: canChange && !o.deleted && r.status === 'transcribed' && !!o.id,
          correct: () => setState({ obsDialog: { kind: 'transcript', key, recordingId: r.id } }),
          correctedLabel: r.correction ? 'Corrected by ' + stampLabel(r.correction) : null,
          addedLabel: r.added ? 'Added by ' + stampLabel(r.added) : null,
          remove: removing('recordings', r.id, r.name),
        })),
        // Each handwritten page with its original, and its transcript or where
        // its transcription stands (CP-19 AC8-AC11).
        pages: pageViews(o),
        // A saved observation's recordings carry their own text below its note.
        detail: o.recordings ? o.detail : o.detail || o.text,
        hasAudio: !!o.audio,
        audioLabel: 'Audio note (' + (o.audio || '') + ')',
        hasStd: !!o.std,
        rowStyle: {
          display: 'grid',
          gridTemplateColumns: obsCols,
          alignItems: narrow ? 'flex-start' : 'center',
          gap: '12px',
          padding: '12px 16px',
          cursor: 'pointer',
          borderBottom: '1px solid var(--border-subtle)',
          transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
          background: open ? 'var(--surface-selected)' : 'var(--surface-card)',
          boxShadow: isNew ? 'inset 3px 0 0 var(--action-primary)' : undefined,
          scrollMarginTop: '16px',
        } as React.CSSProperties,
      }
    })
    // Back from capture, the list opens where the engineer was (CP-16): at
    // the location, or newest first at the newest observation saved.
    const landingRow = obsByLocation ? null : (obsList.find((o) => o.isNew)?.key ?? null)
    // The Observations tab by building, level and location (CP-16): every
    // listed location with the observations the filters show there, newest
    // first. With a filter set, only locations with a match. An observation
    // whose location is no longer listed is kept under the details it was
    // saved with, or under Location not recorded.
    type ObsItem = (typeof obsList)[number]
    const listed = (id: string) => places.locations.some((l) => l.id === id)
    // Its listed location; else one listed with the same name, level and
    // building (a sample observation's, say); else the details it was saved with.
    const placeKey = (o: ObsItem) =>
      (o.locationId && listed(o.locationId) ? o.locationId : null) ??
      places.locations.find(
        (l) =>
          sameName(l.name, o.locationName) &&
          sameName(l.floor, o.floor) &&
          sameName(l.building, o.building),
      )?.id ??
      o.locationId ??
      'unlisted:' + o.locationName
    const obsPlaces: SiteLocation[] = [...places.locations]
    for (const o of obsList)
      if (o.locationName && !obsPlaces.some((l) => l.id === placeKey(o)))
        obsPlaces.push({
          id: placeKey(o),
          building: o.building ?? null,
          floor: o.floor ?? null,
          name: o.locationName,
        })
    const unrecorded = obsList.filter((o) => !o.locationName)
    const obsGroups = [
      ...groupLocations(
        obsPlaces.map((l) => ({ ...l, items: obsList.filter((o) => placeKey(o) === l.id) })),
      ),
      ...(unrecorded.length
        ? [
            {
              key: 'unrecorded',
              title: 'Location not recorded',
              levels: [
                {
                  title: null,
                  locations: [
                    {
                      id: 'unrecorded',
                      building: null,
                      floor: null,
                      name: 'Location not recorded',
                      items: unrecorded,
                    },
                  ],
                },
              ],
            },
          ]
        : []),
    ]
      .map((g) => ({
        ...g,
        levels: g.levels
          .map((level) => ({
            ...level,
            locations: level.locations.filter((l) => !filtersActive(s.of) || l.items.length),
          }))
          .filter((level) => level.locations.length),
      }))
      .filter((g) => g.levels.length)
    // Opens the Add or Edit location dialog on the Observations tab (CP-16),
    // the same form as the capture picker's.
    const openLocationForm = (l?: SiteLocation) =>
      setState({
        obsLocForm: true,
        locAdding: true,
        locEdit: l?.id ?? null,
        ...FORM_CLEAR,
        lf: l
          ? {
              kind: l.building || l.floor ? 'building' : 'elsewhere',
              building: l.building ?? '',
              floor: l.floor ?? '',
              name: l.name,
            }
          : BLANK_LOCATION,
      })
    return {
      /* access (F-05) */
      routeBlocked,
      canEdit,
      canDraft: can('reports:generate', session),
      // A saved assessment opens its real sections 7-12 on the Generate tab;
      // the demo assessment keeps the sample generation run (GN-01).
      liveReference: openRow?.persisted ? openRow.id : null,
      canDraftSections: isMine && canCapture && can('reports:generate', session),
      roleName: roleLabel(session.user.role),
      userId: session.user.id,
      isAdmin: session.user.role === 'knowledge_admin',
      // Leaves a blocked screen for the role's home, or a blocked tab for the
      // workspace overview.
      leaveBlocked: () =>
        setState(
          tabBlocked
            ? { tab: 'overview', toast: null }
            : { screen: homeScreen(session), toast: null },
        ),
      /* chrome */
      navSections,
      // The workspace and capture both highlight the assessment they are for.
      navValue: isAssessment || sc === 'field' ? RECENT_PREFIX + s.captureTarget.reference : sc,
      navFooter: userFooter(),
      showSideNav: !phone && !s.navCollapsed,
      phone,
      showTopBar: phone,
      showHeaderMenu: !phone,
      toggleNav: () =>
        phone
          ? setState({
              navOpen: !s.navOpen,
            })
          : setState({
              navCollapsed: !s.navCollapsed,
            }),
      navOpen: !!s.navOpen,
      openNav: () =>
        setState({
          navOpen: true,
        }),
      closeNav: () =>
        setState({
          navOpen: false,
        }),
      goFromDrawer: (v: string) =>
        setState({
          ...navigateTo(v),
          navOpen: false,
          toast: null,
        }),
      wideTable: !narrow,
      stackTable: narrow,
      reviewWrapStyle: narrow
        ? ({
            display: 'flex',
            flexDirection: 'column',
            minHeight: '0',
            animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
          } as React.CSSProperties)
        : ({
            display: 'flex',
            height: '100%',
            minHeight: '0',
            animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)',
          } as React.CSSProperties),
      reviewRailStyle: narrow
        ? ({
            flex: '0 0 auto',
            width: '100%',
            background: 'var(--surface-card)',
            borderBottom: '1px solid var(--border-default)',
          } as React.CSSProperties)
        : ({
            flex: '0 0 auto',
            width: '264px',
            overflow: 'auto',
            background: 'var(--surface-card)',
            borderRight: '1px solid var(--border-default)',
          } as React.CSSProperties),
      reviewEvidenceStyle: narrow
        ? ({
            flex: '0 0 auto',
            width: '100%',
            background: 'var(--surface-card)',
            borderTop: '1px solid var(--border-default)',
          } as React.CSSProperties)
        : ({
            flex: '0 0 auto',
            width: '344px',
            overflow: 'auto',
            background: 'var(--surface-card)',
            borderLeft: '1px solid var(--border-default)',
          } as React.CSSProperties),
      go: (v: string) => {
        setState({
          ...navigateTo(v),
          toast: null,
        })
      },
      goCreate: () =>
        setState({
          screen: 'create',
          cfErr: false,
          cfServerError: null,
          // Coming from an edit, start a new assessment from a blank form.
          ...(s.cfEdit && blankForm()),
          // A blank form from an earlier day (a tab left open overnight)
          // opens on today's dates; one the engineer has filled in is kept.
          ...(!s.cfEdit &&
            !!s.cf.date &&
            s.cf.date !== localToday() &&
            JSON.stringify(s.cf) === JSON.stringify(blankCreateForm(s.cf.date)) && {
              cf: blankCreateForm(),
            }),
        }),
      // Cancel leaves an edit for the workspace it came from, and a new
      // assessment for the work list.
      cancelForm: () =>
        setState(
          s.cfEdit
            ? { ...blankForm(), screen: 'assessment', tab: 'overview', cfServerError: null }
            : { screen: 'dashboard' },
        ),
      // Opens the form on this assessment's saved details (RV-10 AC10).
      canEditDetails: isMine && canCapture && !!targetRow?.record,
      goEditDetails: () => {
        const a = targetRow?.record
        if (!a) return
        setState({
          screen: 'create',
          cfEdit: a.reference,
          cfErr: false,
          cfServerError: null,
          cf: {
            ...s.cf,
            site: a.site.name,
            addr: a.site.address ?? '',
            jurisdiction: a.site.jurisdiction,
            type: a.site.facilityType,
            client: a.client,
            survey: a.surveyType,
            date: a.siteVisitDate ?? '',
            due: a.reportDueDate ?? '',
            eng: a.engineer?.id ?? '',
            clientId: '',
            siteId: '',
            check: null,
          },
        })
      },
      isEditing: !!s.cfEdit,
      // Each visit to capture starts by asking where, until a location is chosen.
      goField: () =>
        setState({
          screen: 'field',
          locDismissed: false,
          obsReturn: null,
        }),
      canCapture,
      canArchive: isMine && canCapture,
      canRestore: isMine && !canCapture,
      restoreAssessment: async () => {
        if (s.archiveBusy) return
        const reference = s.captureTarget.reference
        setState({ archiveBusy: true })
        try {
          await requestRestore(reference)
          // Back to the work list, not the archived one, which reloads with
          // the status it had.
          setState({ ...navigate('dashboard'), archiveBusy: false, showArchived: false })
          toast(reference + ' restored to your work list.')
        } catch (error: unknown) {
          setState({ archiveBusy: false })
          toast(
            error instanceof GatewayError && error.status !== null
              ? error.message
              : 'The assessment could not be restored. Check your connection and try again.',
            'danger',
          )
        }
      },
      archiveOpen: s.archiveOpen,
      archiveBusy: s.archiveBusy,
      openArchive: () => setState({ archiveOpen: true }),
      closeArchive: () => !s.archiveBusy && setState({ archiveOpen: false }),
      confirmArchive: async () => {
        if (s.archiveBusy) return
        const reference = s.captureTarget.reference
        setState({ archiveBusy: true })
        try {
          await requestArchive(reference)
          // Back to the work list, which reloads; capture falls back to the
          // demo, and the archived one's draft is dropped, as it takes no more.
          dropDraftFiles()
          setState({
            ...navigate('dashboard'),
            ...BLANK_DRAFT,
            fLocationId: null,
            archiveOpen: false,
            archiveBusy: false,
            captureTarget: CAPTURE_ASSESSMENT,
            // Archived, it is found under the work list's Archived filter.
            recent: s.recent.filter((r) => r.reference !== reference),
          })
          toast(reference + ' archived. Filter by Archived to find it.')
        } catch (error: unknown) {
          setState({ archiveOpen: false, archiveBusy: false })
          toast(
            error instanceof GatewayError && error.status !== null
              ? error.message
              : 'The assessment could not be archived. Check your connection and try again.',
            'danger',
          )
        }
      },
      goReview: () =>
        setState({
          tab: 'review',
        }),
      isDashboard: sc === 'dashboard',
      isCreate: sc === 'create',
      isField: sc === 'field',
      isUsers: sc === 'users',
      isKnowledge: sc === 'knowledge',
      isUsage: sc === 'usage',
      isChat: sc === 'chat',
      isAssessment,
      isOverview: isAssessment && s.tab === 'overview',
      isObservations: isAssessment && s.tab === 'observations',
      // The photo collection and the handwritten pages (CP-19) are views of
      // the Observations tab, opened from its Photos and Scans boxes, so that
      // tab stays selected while they show.
      isPhotos: isAssessment && s.tab === 'photos',
      isScans: isAssessment && s.tab === 'scans',
      // Capture is part of the Observations tab, which stays highlighted.
      tabValue: sc === 'field' || s.tab === 'photos' || s.tab === 'scans' ? 'observations' : s.tab,
      goPhotos: () => setState({ tab: 'photos' }),
      goScans: () => setState({ tab: 'scans' }),
      goObservations: () => setState({ tab: 'observations' }),
      // The Observations tab's boxes: what the observations not deleted hold.
      obsCounts: (() => {
        const kept = allRows.filter(({ o }) => !o.deleted).map(({ o }) => o)
        return {
          notes: kept.filter((o) => typesOf(o).includes('Note')).length,
          recordings: kept.reduce(
            (n, o) => n + (o.recordings ? o.recordings.length : o.audio ? 1 : 0),
            0,
          ),
          photos: photoCollection.length,
          scans: scanCollection.length,
        }
      })(),
      photoCollection,
      scanCollection,
      goGenerate: () =>
        setState({
          tab: 'generate',
        }),
      // The Overview's boxes (the drafting and review ones load their own data).
      ovCapture: {
        count: savedCount,
        note: savedCount ? undefined : 'None captured yet',
      },
      ovDue: dueSummary(openRow),
      canOpenGenerate: canOpenTab('generate', session),
      canOpenReview: canOpenTab('review', session),
      ovFacts: openRow
        ? [
            { label: 'Report', value: openRow.id },
            { label: 'Site', value: openRow.site },
            { label: 'Site address', value: openRow.record?.site.address ?? 'Not recorded' },
            {
              label: 'Jurisdiction',
              value:
                JURISDICTIONS.find((j) => j.value === openRow.record?.site.jurisdiction)?.label ??
                openRow.record?.site.jurisdiction ??
                'Not recorded',
            },
            { label: 'Facility type', value: openRow.record?.site.facilityType ?? 'Not recorded' },
            { label: 'Client', value: openRow.client },
            { label: 'Assessment type', value: openRow.type },
            { label: 'Status', value: openRow.status },
            { label: 'Site visit', value: openRow.date },
            {
              label: 'Report due',
              value: openRow.reportDueDate ? formatDay(openRow.reportDueDate) : 'Not set',
            },
            { label: 'Engineer', value: openRow.eng },
          ]
        : [
            { label: 'Report', value: s.captureTarget.reference },
            { label: 'Site', value: s.captureTarget.site },
          ],
      obsWide: !narrow,
      obsStack: narrow,
      obsCols,
      obsList,
      obsReturning: !!s.obsReturn,
      obsLandingRow: landingRow,
      /* by location (CP-16): buildings, levels and locations, each with its
         observations, Add observation, and Edit and Remove */
      // Newest first unless grouped by location, one switch (CP-08 AC1, CP-16).
      toggleObsByLocation: () =>
        setState({ obsSort: s.obsSort === 'location' ? 'newest' : 'location', obsOpen: null }),
      obsByLocation,
      obsGroups: obsGroups.map((g) => {
        const count = g.levels.reduce(
          (n, level) => n + level.locations.reduce((m, l) => m + l.items.length, 0),
          0,
        )
        const open = !s.obsFolded[g.key]
        return {
          key: g.key,
          title: g.title,
          countLabel: plural(count, 'observation'),
          open,
          toggle: () => setState({ obsFolded: { ...s.obsFolded, [g.key]: open } }),
          levels: g.levels.map((level) => ({
            title: level.title,
            locations: level.locations.map((l) => {
              const isListed = listed(l.id)
              // Deleted ones count too, as the gateway refuses to remove a
              // location any observation is saved in (CP-08).
              const held = allRows.some(({ o }) => o.locationId === l.id)
              return {
                id: l.id,
                name: l.name,
                label: l.id === 'unrecorded' ? l.name : locationLabel(l),
                items: l.items,
                countLabel: l.items.length
                  ? plural(l.items.length, 'observation')
                  : 'No observations',
                // Capture opens there, with no need to choose where, and
                // returns there.
                addObservation:
                  isListed && canEdit && canCapture
                    ? () =>
                        setState({
                          screen: 'field',
                          fLocationId: l.id,
                          locOpen: false,
                          locDismissed: false,
                          obsReturn: { locationId: l.id, ids: [], local: 0 },
                        })
                    : undefined,
                landing: s.obsReturn?.locationId === l.id,
                edit: isListed && canChangeObs ? () => openLocationForm(l) : undefined,
                remove:
                  isListed && canEdit && canCapture && !held
                    ? () => setState({ locRemove: l.id })
                    : undefined,
              }
            }),
          })),
        }
      }),
      // Adds a location without capturing, e.g. before the visit (CP-16).
      obsAddLocation: canEdit && canCapture ? () => openLocationForm() : undefined,
      obsLocFormOpen: s.obsLocForm,
      toggleObs: (e: React.MouseEvent<HTMLElement>) => {
        const k = e.currentTarget.dataset.i ?? null
        setState({
          obsOpen: s.obsOpen === k ? null : k,
        })
      },
      obsCountLabel: obsRows.length
        ? filtersActive(s.of)
          ? 'Showing ' + shownRows.length + ' of ' + plural(obsRows.length, obsNoun)
          : 'Showing 1–' + obsRows.length + ' of ' + plural(obsRows.length, obsNoun)
        : plural(0, obsNoun),
      obsNext: () => toast('Later observations are not loaded in this prototype.', 'info'),
      /* observation filters (CP-06 AC2, CP-08 AC3): any one label returns what carries it */
      obsFilters: s.of,
      obsFiltering: filtersActive(s.of),
      obsNoMatch: filtersActive(s.of) && obsRows.length > 0 && shownRows.length === 0,
      // Nothing captured yet, and no locations to list by: the list offers
      // Add observation instead.
      obsNone: !s.obsShowDeleted && obsRows.length === 0 && !(obsByLocation && obsGroups.length),
      setObsFilter: (key: keyof ObservationFilters) => (e: React.ChangeEvent<HTMLSelectElement>) =>
        setState({ of: { ...s.of, [key]: e.target.value } }),
      clearObsFilters: () => setState({ of: NO_FILTERS }),
      obsTypeFilterOptions: [{ value: '', label: 'All types' }, ...OBSERVATION_TYPES],
      obsCatFilterOptions: [{ value: '', label: 'All categories' }, ...CATEGORY_OPTIONS],
      obsSevFilterOptions: [{ value: '', label: 'All severities' }, ...SEVERITY_OPTIONS],
      // A building, a level of it or one location, grouped by building (CP-16).
      obsPlaceFilterOptions: [{ value: '', label: 'All locations' }, ...placeOptions.options],
      obsStatusFilterOptions: [{ value: '', label: 'All statuses' }, ...OBSERVATION_STATUSES],
      // Each filter set, as a chip that removes it, in the panel's order.
      obsFilterChips: (
        [
          ['place', 'Location', placeOptions.labels[s.of.place]],
          ['type', 'Type', s.of.type],
          ['cat', 'Category', s.of.cat],
          ['sev', 'Severity', SEVERITY_OPTIONS.find((x) => x.value === s.of.sev)?.label],
          ['status', 'Status', s.of.status],
        ] as const
      )
        .filter(([key]) => s.of[key])
        .map(([key, name, value]) => ({
          key,
          label: name + ': ' + (value ?? s.of[key]),
          remove: () => setState({ of: { ...s.of, [key]: '' } }),
        })),
      // The phone's Filters sheet closes on this, saying what it shows.
      obsShowLabel: 'Show ' + plural(shownRows.length, obsNoun),
      /* Show deleted (CP-08 AC14): the deleted observations instead */
      obsShowDeleted: s.obsShowDeleted,
      // How many are deleted, shown on the button that lists them.
      obsDeletedCount: allRows.filter(({ o }) => o.deleted).length,
      setObsShowDeleted: (on: boolean) => setState({ obsShowDeleted: on, obsOpen: null }),
      obsNoDeleted: s.obsShowDeleted && obsRows.length === 0,
      /* transcript and delete dialogs (CP-08) */
      obsDialog:
        s.obsDialog && dialogRow
          ? {
              kind: s.obsDialog.kind,
              key: s.obsDialog.key,
              summary: dialogRow.o.text,
              recording: dialogRow.o.recordings?.find((r) => r.id === s.obsDialog!.recordingId),
              // The recording or photo to remove (CP-08).
              media: s.obsDialog.media,
              // What the Add media dialog adds to (CP-08): where it was
              // captured, whether the gateway holds it, and the number its
              // next recording takes after those it has, removed ones included.
              where: placeOf(dialogRow.o),
              saved: !!dialogRow.o.id,
              nextRecording:
                (dialogRow.o.recordings?.length ?? 0) +
                (dialogRow.o.removedMedia ?? []).filter((m) => m.kind === 'recordings').length +
                1,
            }
          : null,
      closeObsDialog: () => setState({ obsDialog: null }),
      saveTranscript,
      confirmDelete,
      addMedia,
      confirmRemoveMedia,
      /* the Edit dialog: tags (CP-06) and note (CP-08) */
      tagOpen: !!tagRow,
      tagEdit: s.tagEdit,
      tagBusy: s.tagBusy,
      tagError: s.tagError,
      toggleTagCat: (cat: string) =>
        s.tagEdit &&
        setState({ tagEdit: { ...s.tagEdit, cats: toggleCategory(s.tagEdit.cats, cat) } }),
      setTagSev: (sev: string) => s.tagEdit && setState({ tagEdit: { ...s.tagEdit, sev } }),
      tagLocOptions: [
        // A location not on the assessment's list can be kept, not chosen again.
        ...(tagRow && !places.locations.some((l) => l.id === s.tagEdit?.locationId)
          ? [
              {
                value: s.tagEdit!.locationId,
                label: placeOf(tagRow.o),
              },
            ]
          : []),
        // In the picker's order: by building, then level (CP-16).
        ...groupLocations(places.locations).flatMap((g) =>
          g.levels.flatMap((level) =>
            level.locations.map((l) => ({ value: l.id, label: locationLabel(l) })),
          ),
        ),
      ],
      tagStdOptions: [
        { value: '', label: 'None, let the draft find it' },
        ...labelValues(STANDARD_REFERENCES, s.tagEdit?.std ?? '').map((name) => ({
          value: name,
          label: name,
        })),
      ],
      setTag:
        (field: 'locationId' | 'std' | 'note') =>
        (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) =>
          s.tagEdit && setState({ tagEdit: { ...s.tagEdit, [field]: e.target.value } }),
      closeTags: () => !s.tagBusy && setState({ tagEdit: null, tagError: null }),
      saveTags: () => void saveTags(),
      isGenerate: isAssessment && s.tab === 'generate',
      isReview: isAssessment && s.tab === 'review',
      isExport: isAssessment && s.tab === 'export',
      // Capture is part of the workspace, so it keeps the workspace's header,
      // named from the capture session when one is live.
      eyebrow:
        sc === 'dashboard'
          ? 'Risk engineering'
          : sc === 'create'
            ? s.cfEdit
              ? 'Assessment workspace'
              : 'New assessment'
            : sc === 'users' || sc === 'knowledge'
              ? 'Administration'
              : sc === 'usage'
                ? 'Reporting'
                : sc === 'chat'
                  ? 'Knowledge'
                  : 'Assessment workspace',
      title:
        sc === 'dashboard'
          ? 'Assessments'
          : sc === 'create'
            ? s.cfEdit
              ? 'Edit assessment details'
              : 'Create assessment'
            : sc === 'field'
              ? captureSite
              : sc === 'users'
                ? 'User accounts'
                : sc === 'knowledge'
                  ? 'Knowledge base'
                  : sc === 'usage'
                    ? 'Usage and costs'
                    : sc === 'chat'
                      ? 'Ask the knowledge base'
                      : s.captureTarget.site,
      meta:
        sc === 'dashboard'
          ? rows.length + ' assessments · ' + session.user.name
          : sc === 'create'
            ? 'Opening an assessment creates the report record and its drafting set.'
            : sc === 'users'
              ? 'Add your team’s accounts, and keep their details and roles up to date.'
              : sc === 'knowledge'
                ? 'The standards and past reports used to draft new reports. Correct, withdraw or add them.'
                : sc === 'usage'
                  ? 'What the AI calls cost, how much they were used, and how fast they ran.'
                  : sc === 'chat'
                    ? 'Answers come from the standards and past reports in the knowledge base.'
                    : // An assessment shows only its name; its details are in its Overview.
                      '',
      showSeverity: isAssessment,
      tab: s.tab,
      setTab: (v: string) =>
        setState({
          tab: v,
        }),
      tabItems: [
        {
          value: 'overview',
          label: 'Overview',
          icon: 'file-pen',
        },
        {
          value: 'observations',
          label: 'Observations',
          icon: 'camera',
          count: fieldSaved,
        },
        {
          value: 'generate',
          label: 'Generation',
          icon: 'sparkles',
        },
        {
          value: 'review',
          label: 'Review',
          icon: 'user-round-search',
          // Counts only for the demo's sample review, shown while it is not on the server.
          count: isDemoCapture && !openRow?.persisted ? live.length : undefined,
        },
        {
          value: 'export',
          label: 'Export',
          icon: 'stamp',
          count: isDemoCapture && !openRow?.persisted ? open.length : undefined,
        },
      ].filter((item) => canOpenTab(item.value, session)),
      toast: s.toast,
      toastTone: s.toastTone,
      clearToast: () =>
        setState({
          toast: null,
        }),
      // Lets a screen outside this hook confirm an action, e.g. KB-01's saves.
      notify: (message: string) => toast(message),
      openEvidenceSource: () =>
        toast('Source files are not connected in this demo. Excerpts are sample evidence.', 'info'),
      playSampleAudio: () => toast('Audio playback is not connected in this demo.', 'info'),
      // The ⋯ menu's Version history (RV-06): a saved assessment's opens in its
      // Review tab; the sample assessment has none.
      reviewHistory: s.reviewHistory,
      showVersionHistory: () =>
        openRow?.persisted
          ? setState({ tab: 'review', reviewHistory: s.reviewHistory + 1 })
          : toast('Version history is not connected in this demo.', 'info'),
      /* annotations */

      /* dashboard */
      q: s.q,
      setQ: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          q: e.target.value,
        }),
      fStatus,
      setStatus: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          fStatus: e.target.value,
        }),
      statusOptions: [
        'All statuses',
        ...Object.values(STATUS_LABEL).filter((label) => label !== STATUS_LABEL.archived),
      ],
      // Group by client, then site (CP-17 AC9); the button says what pressing it does.
      workByClient: s.workByClient && !s.showArchived,
      toggleWorkByClient: () => setState({ workByClient: !s.workByClient }),
      workGroups,
      // The archived assessments, a list of their own.
      showArchived: s.showArchived,
      archivedCount: rows.filter(isArchived).length,
      toggleArchived: () => setState({ showArchived: !s.showArchived }),
      workSort: s.workSort,
      sortOptions: ['Latest site visit', 'Report due: earliest first'],
      setWorkSort: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) => setState({ workSort: e.target.value }),
      filteredRows: filtered,
      noResults: filtered.length === 0,
      resultLabel: filtered.length + ' of ' + rows.length + ' assessments',
      // The boxes above the list: how many assessments each date filter matches,
      // whatever the search and status filter, and the one filtering the list.
      dateCounts: Object.fromEntries(
        Object.entries(DATE_FILTERS).map(([key, matches]) => [key, rows.filter(matches).length]),
      ) as Record<DateFilter, number>,
      dateFilter: s.fDate,
      // Selecting the box filtering the list again clears it.
      toggleDateFilter: (filter: DateFilter) =>
        setState({ fDate: s.fDate === filter ? null : filter }),
      listOffline: listFailed && !serverRows,
      onRow: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.id
        const row = rows.find((r) => r.id === id)
        if (!row) return
        releaseDraft(row.id)
        setState({
          ...openAssessment({ reference: row.id, site: row.site }, s),
          toast: null,
        })
      },
      /* create */
      cfSite: s.cf.site,
      cfClient: s.cf.client,
      cfAddr: s.cf.addr,
      cfType: s.cf.type,
      cfSurvey: s.cf.survey,
      cfDate: s.cf.date,
      cfDue: s.cf.due,
      errSite: !s.cfErr
        ? ''
        : needsSiteName && !s.cf.site.trim()
          ? 'Site name is required'
          : siteTaken
            ? listedClient!.name + ' already has a site named ' + siteTaken.name
            : '',
      errClient: s.cfErr && !s.cf.client.trim() ? 'Client is required' : '',
      errSiteChoice:
        s.cfErr && pickingSite && !s.cf.siteId ? 'Choose a site, or add a new one' : '',
      hasCfError: s.cfErr && cfProblems.length > 0,
      cfProblems:
        cfProblems.join(' ') +
        (s.cfEdit
          ? ' Correct the fields above, then save again.'
          : ' Correct the fields above, then create the assessment.'),
      setCfSite: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            site: e.target.value,
            check: null,
          },
        }),
      // A different client clears a listed site chosen for the last one.
      setCfClient: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) => {
        const next = clients?.find((c) => clientKey(c.name) === clientKey(e.target.value))
        setState({
          cf: {
            ...s.cf,
            client: e.target.value,
            clientId: '',
            check: null,
            ...(next?.id !== listedClient?.id && {
              siteId: '',
              ...(chosenSite && siteFields()),
            }),
          },
        })
      },
      // Every client, whoever added it (CP-17 AC3), offered as the engineer types.
      clientNames: clients?.map((c) => c.name) ?? [],
      clientLocked: !!s.cfEdit,
      clientHint: s.cfEdit
        ? 'An assessment’s client can’t be changed.'
        : listedClient
          ? 'Listed client'
          : s.cf.client.trim() && clients
            ? 'New client: it will be added to the list.'
            : '',
      // A listed client's sites, then Add a new site (AC4).
      pickingSite,
      sitesLoading: !s.cfEdit && !!listedClient && !clientSitesNow,
      cfSiteId: s.cf.siteId,
      siteOptions: [
        { value: '', label: 'Choose a site…' },
        ...(clientSitesNow ?? []).map((x) => ({
          value: x.id,
          label: x.name + (x.latest ? ' · last visit ' + x.latest.reference : ''),
        })),
        { value: NEW_SITE, label: 'Add a new site' },
      ],
      setCfSiteId: (e: React.ChangeEvent<HTMLSelectElement>) => {
        const chosen = clientSitesNow?.find((x) => x.id === e.target.value)
        setState({
          cf: {
            ...s.cf,
            siteId: e.target.value,
            check: null,
            copy: true,
            // A listed site brings its details; leaving one clears them.
            ...((chosen || chosenSite) && siteFields(chosen)),
          },
        })
      },
      // A listed site's details are its own, and a shared site's are locked
      // on its assessments (AC8).
      siteLocked,
      siteLockedHint: s.cfEdit
        ? 'Other assessments share this site, so its details can’t be changed here.'
        : 'From the listed site.',
      // The copy offered for a listed site with locations (AC5).
      copyOffer:
        chosenSite?.latest && chosenSite.latest.locations > 0
          ? {
              label:
                'Copy ' +
                chosenSite.latest.locations +
                (chosenSite.latest.locations === 1 ? ' location' : ' locations') +
                ' from ' +
                chosenSite.latest.reference,
              description:
                (chosenSite.latest.buildings
                  ? chosenSite.latest.buildings +
                    (chosenSite.latest.buildings === 1 ? ' building' : ' buildings') +
                    ' and places elsewhere on site, as last recorded'
                  : 'As last recorded') +
                (chosenSite.latest.siteVisitDate
                  ? ' on the visit of ' + formatDay(chosenSite.latest.siteVisitDate)
                  : '') +
                '. Each copy is this assessment’s own. Untick to start with none.',
            }
          : null,
      cfCopy: s.cf.copy,
      setCfCopy: (copy: boolean) => setState({ cf: { ...s.cf, copy } }),
      // A likely typo asked about on Create (AC11).
      cfCheck: s.cf.check,
      acceptCfSuggestion: () => {
        const check = s.cf.check
        if (!check) return
        if (check.field === 'client') {
          setState({
            cf: { ...s.cf, client: check.suggestion, clientId: '', siteId: '', check: null },
          })
          return
        }
        const listed = clientSitesNow?.find((x) => x.name === check.suggestion)
        setState({
          cf: { ...s.cf, siteId: listed?.id ?? '', check: null, copy: true, ...siteFields(listed) },
        })
      },
      // Keeps the name as typed; Create then carries on with the names kept.
      keepCfName: () => {
        const kept = s.cf.check ? [...s.cf.kept, clientKey(s.cf.check.typed)] : s.cf.kept
        setState({ cf: { ...s.cf, kept, check: null } })
        return kept
      },
      setCfAddr: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            addr: e.target.value,
          },
        }),
      setCfType: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            type: e.target.value,
          },
        }),
      setCfSurvey: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            survey: e.target.value,
          },
        }),
      setCfDate: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            date: e.target.value,
          },
        }),
      setCfDue: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            due: e.target.value,
          },
        }),
      cfJurisdiction: s.cf.jurisdiction,
      setCfJurisdiction: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            jurisdiction: e.target.value,
          },
        }),
      jurisdictionOptions: JURISDICTIONS,
      cfBusy: s.cfBusy,
      cfServerError: s.cfServerError,
      createLabel: s.cfEdit
        ? s.cfBusy
          ? 'Saving changes…'
          : 'Save changes'
        : s.cfBusy
          ? 'Creating assessment…'
          : 'Create assessment',
      cfErrorTitle: s.cfEdit ? 'Changes not saved' : 'Assessment not created',
      facilityOptions: FACILITY_TYPES,
      surveyOptions: [
        'Property risk survey',
        'Follow-up visit',
        'Business interruption',
        'Natural hazard review',
      ],
      directoryError: directoryStatus === 'error',
      directoryLoading: directoryStatus === 'loading',
      hasDirectory: directory.length > 0,
      engAssigned: assignedEng ? engChoice(assignedEng) : null,
      engQuery: s.cf.engQuery,
      setEngQuery: (e: React.ChangeEvent<HTMLInputElement>) =>
        setState({ cf: { ...s.cf, engQuery: e.target.value } }),
      engResults: engMatches.slice(0, ENGINEER_MATCH_LIMIT).map(engChoice),
      engResultLabel: !engQuery
        ? ''
        : engMatches.length === 0
          ? 'No engineer matches "' + s.cf.engQuery.trim() + '".'
          : engMatches.length > ENGINEER_MATCH_LIMIT
            ? 'Showing ' +
              ENGINEER_MATCH_LIMIT +
              ' of ' +
              engMatches.length +
              ' matches. Keep typing to narrow it down.'
            : engMatches.length === 1
              ? '1 match'
              : engMatches.length + ' matches',
      // Choosing closes the matches: the search has done its job.
      selectEng: (id: string) => setState({ cf: { ...s.cf, eng: id, engQuery: '' } }),
      createAssessment: async (kept: string[] = s.cf.kept) => {
        if (s.cfBusy) return
        if (cfProblems.length) {
          setState({
            cfErr: true,
          })
          return
        }
        const check = s.cfEdit ? null : nameCheck(kept)
        if (check) {
          setState({ cf: { ...s.cf, kept, check }, cfErr: false })
          return
        }
        setState({ cfBusy: true, cfErr: false, cfServerError: null })
        if (s.cfEdit) {
          const reference = s.cfEdit
          try {
            await requestUpdateAssessment(reference, {
              site: {
                name: s.cf.site,
                address: s.cf.addr,
                jurisdiction: s.cf.jurisdiction,
                facilityType: s.cf.type,
              },
              surveyType: s.cf.survey,
              siteVisitDate: s.cf.date,
              reportDueDate: s.cf.due,
            })
            // The work list reloads only on the dashboard, so reload it here.
            const list = await listAssessments().catch(() => null)
            if (list) setServerRows(list.map(toRow))
            setState({ ...blankForm(), cfBusy: false, screen: 'assessment', tab: 'overview' })
            toast('Details saved for ' + reference + '.')
          } catch (error: unknown) {
            const problems = error instanceof GatewayError ? Object.values(error.fields) : []
            setState({
              cfBusy: false,
              cfServerError: problems.length
                ? problems.join(' ') + ' Correct the details above, then save again.'
                : error instanceof GatewayError && error.status !== null
                  ? error.message
                  : 'The gateway could not be reached. Your changes are still here; save again.',
            })
          }
          return
        }
        try {
          const created = await requestCreateAssessment({
            ...(chosenSite
              ? { siteId: chosenSite.id, copyLocations: s.cf.copy }
              : {
                  site: {
                    name: s.cf.site,
                    address: s.cf.addr,
                    jurisdiction: s.cf.jurisdiction,
                    facilityType: s.cf.type,
                  },
                }),
            ...(listedClient ? { clientId: listedClient.id } : { client: s.cf.client }),
            surveyType: s.cf.survey,
            siteVisitDate: s.cf.date,
            reportDueDate: s.cf.due,
            engineerId: s.cf.eng,
          })
          const mine = created.engineer?.id === session.user.id
          addCreatedRow(toRow(created), mine)
          toast(
            created.reference +
              ' created for ' +
              created.site.name +
              (mine ? '.' : '. It will appear in the assigned engineer’s work list.'),
          )
        } catch (error: unknown) {
          if (error instanceof GatewayError && error.status === null) {
            // Keep the demo usable without the gateway, and say nothing was saved.
            const id = `RPT-2026-${String(416 + s.createdRows.length).padStart(4, '0')}`
            addCreatedRow(
              {
                id,
                site: s.cf.site,
                client: s.cf.client,
                type: s.cf.survey,
                date: formatDay(s.cf.date || null),
                siteVisitDate: s.cf.date || null,
                reportDueDate: s.cf.due || null,
                engineerId: s.cf.eng || null,
                eng: s.cf.eng
                  ? (directory.find((e) => e.id === s.cf.eng)?.name ??
                    (s.cf.eng === session.user.id ? session.user.name : 'Unassigned'))
                  : 'Unassigned',
                status: STATUS_LABEL.not_started,
                sev: 'low',
                open: 0,
              },
              s.cf.eng === session.user.id,
            )
            toast(
              'The gateway could not be reached, so ' +
                id +
                ' exists only in this demo and is not saved.',
              'warning',
            )
            return
          }
          const problems = error instanceof GatewayError ? Object.values(error.fields) : []
          setState({
            cfBusy: false,
            cfServerError: problems.length
              ? problems.join(' ') + ' Correct the details above, then create the assessment again.'
              : (error instanceof Error ? error.message : 'The assessment could not be created.') +
                ' Try again, or check the gateway logs if it keeps failing.',
          })
        }
      },
      /* field */
      capture: capture.state,
      retryCapture: capture.retry,
      // Save waits for the session, so nothing is kept in this browser by
      // being saved a moment too soon.
      captureStarting: capture.state?.status === 'starting',
      // Wide enough for the tags and Save in a panel beside the form.
      captureSplit: !narrow,
      captureRef,
      // Back to the Observations tab, or to the workspace tab chosen.
      leaveCapture: () => leaveCapture('observations'),
      leaveCaptureTo: leaveCapture,
      leaveOpen: sc === 'field' && s.fLeaveOpen,
      unsavedLabel,
      closeLeave: () => setState({ fLeaveOpen: false }),
      discardAndLeave: () => {
        dropDraftFiles()
        setState({ ...BLANK_DRAFT, ...toTab(s.fLeaveTo) })
      },
      // The switcher shows what each mode holds, so nothing waits unseen
      // behind another mode.
      noteWritten,
      voiceCount,
      photoCount: s.fPhotos.length,
      pageCount: s.fPages.length,
      isNoteMode: s.fMode === 'note',
      isVoiceMode: s.fMode === 'voice',
      isPhotoMode: s.fMode === 'photo',
      isScanMode: s.fMode === 'scan',
      tabNoteStyle: modeStyle(s.fMode === 'note'),
      tabVoiceStyle: modeStyle(s.fMode === 'voice'),
      tabPhotoStyle: modeStyle(s.fMode === 'photo'),
      tabScanStyle: modeStyle(s.fMode === 'scan'),
      modeNote: () =>
        setState({
          fMode: 'note',
        }),
      modeVoice: () =>
        setState({
          fMode: 'voice',
        }),
      modePhoto: () =>
        setState({
          fMode: 'photo',
        }),
      modeScan: () =>
        setState({
          fMode: 'scan',
        }),
      // One note per observation, saved exactly as typed in the box.
      fNote: s.fNote,
      fSaving: s.fSaving,
      fSaveError: s.fSaveError,
      setFNote: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          fNote: e.target.value,
        }),
      waveBars,
      fClock: mm + ':' + ss,
      liveVoice,
      recLabel: s.fRec
        ? 'Stop recording'
        : s.fTransBusy
          ? 'Loading transcript…'
          : liveVoice && s.fClips.length
            ? 'Record another'
            : 'Start recording',
      recHint: liveVoice
        ? s.fRec
          ? 'Recording. Stop to add it below.'
          : 'Each recording is transcribed once you save.'
        : s.fRec
          ? 'Simulating recording; your microphone is not accessed.'
          : s.fTransBusy
            ? 'Loading the sample transcript.'
            : 'No capture session, so recording is simulated and produces a sample transcript.',
      fVoiceError: s.fVoiceError,
      recBusy: s.fRec || s.fTransBusy || s.fSaving,
      uploadRecording: (e: React.ChangeEvent<HTMLInputElement>) => {
        for (const file of e.target.files ?? []) addClip(file, file.name, null)
        e.target.value = ''
        setState({ fVoiceError: null })
      },
      fClips: s.fClips,
      removeClip: dropClip,
      recStyle: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        height: '46px',
        borderRadius: '5px',
        border: '1px solid ' + (s.fRec ? 'var(--action-danger)' : 'var(--action-primary)'),
        background: s.fRec ? 'var(--action-danger)' : 'var(--action-primary)',
        color: '#fff',
        fontFamily: 'inherit',
        fontSize: '16px',
        fontWeight: '500',
        cursor: 'pointer',
      } as React.CSSProperties,
      toggleRec: () => {
        if (s.fTransBusy || s.fSaving) return
        if (liveVoice) {
          if (media.recorder) {
            // The clock goes back to 00:00; the clip waits in the list for Save observation.
            setState({ fRec: false, fSecs: 0 })
            media.recorder.stop()
          } else void startRecording()
          return
        }
        if (s.fRec) {
          setState({
            fRec: false,
            fTransBusy: true,
          })
          // Unless the draft was discarded in the meantime.
          later(
            () =>
              updateState((previous) =>
                previous.fTransBusy ? { ...previous, fTransBusy: false, fTrans: true } : previous,
              ),
            1200,
          )
        } else
          setState({
            fRec: true,
            fSecs: 0,
            fTrans: false,
          })
      },
      hasTranscript: s.fTrans,
      fTranscriptText: SAMPLE_TRANSCRIPT,
      transcriptToNote: () =>
        setState({
          fMode: 'note',
          fTrans: false,
          fNote: SAMPLE_TRANSCRIPT,
        }),
      fPhotos: s.fPhotos,
      fPhotoError: s.fPhotoError,
      photoHint: liveCapture
        ? 'JPG or PNG, stored exactly as taken.'
        : 'No capture session, so photographs stay in this browser and are not uploaded.',
      // Photos taken on the device or chosen from it (CP-04 AC6). Anything
      // but a JPG or PNG is refused here with the gateway's reason (AC4); the
      // gateway checks the image itself too, as a browser can report no type.
      addPhotos: (e: React.ChangeEvent<HTMLInputElement>) => {
        const { photos, refused } = choosePhotos([...(e.target.files ?? [])])
        e.target.value = ''
        const added = photos.map((file) => {
          const id = ++media.photos
          return {
            id,
            name: file.name || 'Photo ' + id,
            image: file,
            url: URL.createObjectURL(file),
          }
        })
        updateState((previous) => ({
          ...previous,
          fPhotos: [...previous.fPhotos, ...added],
          fPhotoError: refused.length ? unsupportedPhotos(refused) : null,
        }))
      },
      removePhoto: (photo: PhotoFile) => {
        URL.revokeObjectURL(photo.url)
        updateState((previous) => ({
          ...previous,
          fPhotos: previous.fPhotos.filter((p) => p.id !== photo.id),
        }))
      },
      // Pages of handwritten notes (CP-19), taken or chosen like photos and
      // checked the same way (AC2); each is transcribed once saved (AC6).
      fPages: s.fPages,
      fPageError: s.fPageError,
      pageHint: liveCapture
        ? 'JPG or PNG, one photo per page. Each page is transcribed once you save.'
        : 'No capture session, so pages stay in this browser and are not transcribed.',
      addPages: (e: React.ChangeEvent<HTMLInputElement>) => {
        const { photos, refused } = choosePhotos([...(e.target.files ?? [])])
        e.target.value = ''
        const added = photos.map((file) => {
          const id = ++media.pages
          return {
            id,
            name: file.name || 'Page ' + id,
            image: file,
            url: URL.createObjectURL(file),
          }
        })
        updateState((previous) => ({
          ...previous,
          fPages: [...previous.fPages, ...added],
          fPageError: refused.length ? unsupportedPhotos(refused) : null,
        }))
      },
      removePage: (page: PhotoFile) => {
        URL.revokeObjectURL(page.url)
        updateState((previous) => ({
          ...previous,
          fPages: previous.fPages.filter((p) => p.id !== page.id),
        }))
      },
      /* location */
      locationLabel: currentLocation ? locationLabel(currentLocation) : null,
      locSheetOpen,
      openLocations: () => setState({ locOpen: true }),
      closeLocations: () => setState(pickerClosed),
      // The location bar opens the picker, or closes the dropdown it anchors.
      toggleLocations: () => setState(locSheetOpen ? pickerClosed : { locOpen: true }),
      locQuery: s.locQuery,
      setLocQuery: (e: React.ChangeEvent<HTMLInputElement>) =>
        setState({ locQuery: e.target.value }),
      // By building, then level, then elsewhere on site (CP-16). A group
      // opens where the engineer is, or as they last left it this visit;
      // while searching, every group with a match is open. One group alone
      // has nothing to fold.
      locationGroups: locationGroups.map((g) => {
        const open =
          !!query || locationGroups.length === 1 || (s.locGroups[g.key] ?? g.key === currentGroup)
        return {
          key: g.key,
          title: g.title,
          count: g.levels.reduce((n, level) => n + level.locations.length, 0),
          open,
          collapsible: !query && locationGroups.length > 1,
          toggle: () => setState({ locGroups: { ...s.locGroups, [g.key]: !open } }),
          levels: g.levels.map((level) => ({
            title: level.title,
            locations: level.locations.map((l) => {
              const count = fieldRecent.filter((o) =>
                o.locationId ? o.locationId === l.id : o.locationName === l.name,
              ).length
              return {
                id: l.id,
                name: l.name,
                label: locationLabel(l),
                detail: count ? plural(count, 'observation') : '',
                selected: l.id === s.fLocationId,
                // Only a location with nothing saved in it can be removed, once confirmed.
                remove: count ? undefined : () => setState({ locRemove: l.id }),
                // Changed by the assigned engineer, as observations are (CP-16).
                edit: canChangeObs
                  ? () =>
                      setState({
                        locAdding: true,
                        locEdit: l.id,
                        ...FORM_CLEAR,
                        lf: {
                          kind: l.building || l.floor ? 'building' : 'elsewhere',
                          building: l.building ?? '',
                          floor: l.floor ?? '',
                          name: l.name,
                        },
                      })
                  : undefined,
              }
            }),
          })),
        }
      }),
      locNoMatch: !!query && locationGroups.length === 0,
      noLocations: places.locations.length === 0,
      // Choosing one leaves any half-filled form behind.
      chooseLocation: (id: string) =>
        setState({
          fLocationId: id,
          locOpen: false,
          locQuery: '',
          locAdding: false,
          locEdit: null,
          ...FORM_CLEAR,
        }),
      locAdding: s.locAdding || places.locations.length === 0,
      locEditing: !!s.locEdit,
      locEditId: s.locEdit,
      // Starts from where the engineer is: the next location on the same
      // level is one field to type. The search becomes its name.
      startAddLocation: () =>
        setState({
          locAdding: true,
          locEdit: null,
          ...FORM_CLEAR,
          lf: {
            ...BLANK_LOCATION,
            ...(currentLocation?.building
              ? { building: currentLocation.building, floor: currentLocation.floor ?? '' }
              : currentLocation && !currentLocation.floor && { kind: 'elsewhere' as const }),
            name: s.locQuery.trim(),
          },
        }),
      cancelLocationForm: () =>
        setState({
          locAdding: false,
          locEdit: null,
          lf: BLANK_LOCATION,
          obsLocForm: false,
          ...FORM_CLEAR,
        }),
      lf: s.lf,
      setLfKind: (kind: LocationForm['kind']) =>
        setState({ lf: { ...s.lf, kind }, lfErrors: {}, lfCheck: null }),
      // Typing again drops the question about that field, and any choice to keep it.
      setLf: (field: 'building' | 'floor' | 'name') => (e: React.ChangeEvent<HTMLInputElement>) =>
        setState({
          lf: { ...s.lf, [field]: e.target.value },
          lfErrors: {},
          lfCheck: null,
          lfKept: { ...s.lfKept, [field]: undefined },
        }),
      // The question about a new building or level that looks mistyped: use
      // the name it was probably meant to be, keep it as typed, or change it.
      // Either of the first two carries on saving.
      lfCheck: s.lfCheck,
      acceptCheckedSuggestion: () =>
        s.lfCheck?.suggestion &&
        void submitLocation({ ...s.lf, [s.lfCheck.field]: s.lfCheck.suggestion }),
      keepCheckedName: () =>
        s.lfCheck && void submitLocation(s.lf, { ...s.lfKept, [s.lfCheck.field]: s.lfCheck.typed }),
      changeCheckedName: () => setState({ lfCheck: null }),
      // Names already used, so a building or level is spelt one way; for a
      // level, those in the building typed first, then the usual ones.
      buildingSuggestions: suggestions(places.locations.map((l) => l.building)),
      levelSuggestions: suggestions(
        [
          ...places.locations
            .filter((l) => sameName(l.building, s.lf.building))
            .map((l) => l.floor),
          ...places.locations.map((l) => l.floor),
        ],
        LEVEL_SUGGESTIONS,
      ),
      // Names already used on the site, then the usual ones (CP-16).
      locationNameSuggestions: suggestions(
        places.locations.map((l) => l.name),
        LOCATION_NAMES,
      ),
      lfBusy: s.lfBusy,
      lfErrors: s.lfErrors,
      /* the Remove this location? dialog */
      locRemoveLabel: (() => {
        const l = places.locations.find((x) => x.id === s.locRemove)
        return l ? locationLabel(l) : null
      })(),
      closeLocRemove: () => setState({ locRemove: null }),
      confirmLocRemove: removeLocation,
      submitLocation: () => void submitLocation(),
      fCats: s.fCats,
      toggleFCat: (cat: string) => setState({ fCats: toggleCategory(s.fCats, cat) }),
      fSev: s.fSev,
      setFSev: (fSev: string) => setState({ fSev }),
      fToast: s.fToast,
      saveObservation: () => {
        if (s.fSaving || s.fRec || capture.state?.status === 'starting') return
        if (!currentLocation) {
          setState({ fToast: { text: 'Choose a location first.', warn: true }, locOpen: true })
          return
        }
        // With a capture session live, the note, recordings, photos and pages
        // are saved on the server as one observation; otherwise in this demo.
        const note = s.fNote.trim() ? s.fNote : undefined
        const live =
          !!liveCapture && !!(note || s.fClips.length || s.fPhotos.length || s.fPages.length)
        const text =
          s.fNote.trim() ||
          (s.fTrans ? SAMPLE_TRANSCRIPT : '') ||
          (s.fPhotos.length
            ? plural(s.fPhotos.length, 'photograph') + ' captured at ' + currentLocation.name + '.'
            : '') ||
          (s.fPages.length
            ? plural(s.fPages.length, 'handwritten page') +
              ' captured at ' +
              currentLocation.name +
              '.'
            : '')
        if (!live && !text) {
          setState({
            fToast: { text: 'Add a note, recording, photograph or page first.', warn: true },
          })
          return
        }
        // Severity is what the report grades the finding by (CP-02), so it is
        // always chosen, never assumed.
        if (!s.fSev) {
          setState({ fToast: { text: 'Choose a severity first.', warn: true } })
          return
        }
        if (live) {
          void saveToGateway(currentLocation, note, s.fClips, s.fPhotos, s.fPages)
          return
        }
        const entry: Observation = {
          icon:
            s.fMode === 'photo'
              ? 'camera'
              : s.fMode === 'voice'
                ? 'mic'
                : s.fMode === 'scan'
                  ? IconRegistry.evidence.handwriting
                  : 'sticky-note',
          color:
            s.fMode === 'photo'
              ? '#4f9aee'
              : s.fMode === 'voice'
                ? '#8f7dff'
                : s.fMode === 'scan'
                  ? 'var(--text-secondary)'
                  : '#f9ac10',
          cats: s.fCats,
          time: formatDayYearTime(new Date()),
          text,
          locationName: currentLocation.name,
          building: currentLocation.building,
          locationId: currentLocation.id,
          floor: currentLocation.floor,
          sev: s.fSev,
          std: '',
          // Kept in this browser: the preview stays, as the demo never uploads it.
          // Its photos are read only when the engineer asks (CP-05).
          media: s.fPhotos.map((p) => ({ name: p.name, url: p.url })),
          // Kept in this browser too, and never transcribed without a session.
          pages: s.fPages.map((p) => ({
            id: 'local-page-' + p.id,
            name: p.name,
            url: p.url,
            status: null,
            transcript: null,
            uncertain: [],
            error: null,
          })),
          detail: text,
        }
        const reference = s.captureTarget.reference
        setState({
          ...(isDemoCapture
            ? { fRecent: [entry].concat(s.fRecent) }
            : { captureObs: { ...s.captureObs, [reference]: [entry].concat(localRecent) } }),
          // Listed first, as local-0, so the Observations tab marks it New.
          obsReturn: {
            locationId: currentLocation.id,
            ids: s.obsReturn?.ids ?? [],
            local: (s.obsReturn?.local ?? 0) + 1,
          },
          obsFolded: { ...s.obsFolded, [groupKey(currentLocation)]: false },
          fNote: '',
          fPhotos: [],
          fPages: [],
          fTrans: false,
          fCats: [],
          fSev: '',
          fToast: { text: 'Observation added to ' + reference + '. It is kept in this demo only.' },
        })
        later(
          () =>
            setState({
              fToast: null,
            }),
          3200,
        )
      },
      /* generation */
      gsecs,
      running: s.running,
      notRunning: !s.running,
      genPercent: Math.round((doneCount / 7) * 100),
      genProgressLabel: doneCount + ' of 7 sections drafted',
      genCalloutTitle: s.running ? 'Drafting in progress' : 'Drafting paused',
      genCalloutBody: s.running
        ? 'Drafted from 28 site observations, 4 past reports and 11 external standards. Sections appear for review as each one completes.'
        : 'Sections already drafted are kept. Resume drafting to continue from the first section that did not complete.',
      genFootnote:
        attention > 0
          ? doneCount + ' of 7 sections drafted · ' + attention + ' need attention before review'
          : doneCount + ' of 7 sections drafted · nothing outstanding in drafting',
      askStop: () =>
        setState({
          stopOpen: true,
        }),
      closeStop: () =>
        setState({
          stopOpen: false,
        }),
      stopOpen: s.stopOpen,
      stopDescription:
        doneCount +
        ' of 7 sections are already drafted and will be kept. Sections still drafting or queued will stop where they are, and you can resume from there.',
      stopFooter: (
        <div
          style={{
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            type={'button'}
            onClick={() =>
              setState({
                stopOpen: false,
              })
            }
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              color: 'var(--text-body)',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Keep drafting'}
          </button>
          <button
            type={'button'}
            onClick={() => stopGen()}
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--action-danger)',
              background: 'var(--action-danger)',
              color: '#fff',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Stop generation'}
          </button>
        </div>
      ),
      resumeGen: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        g.forEach((x) => {
          if (x.st === 'stopped') x.st = 'queued'
        })
        setState({
          gsecs: g,
          running: true,
          toast: null,
        })
      },
      retrySection: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        const f = g.find((x) => x.st === 'failed')
        if (f) {
          f.st = 'queued'
        }
        setState({
          gsecs: g,
          running: true,
        })
        toast('Simulating a retry of 4.0 Business interruption exposure.', 'info')
      },
      useCached: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        const f = g.find((x) => x.st === 'failed')
        if (f) {
          f.st = 'done'
          f.conf = 'medium'
        }
        setState({
          gsecs: g,
        })
        toast(
          "4.0 drafted from the cached standards copy of 08 Apr. The cache date is recorded in the section's sources.",
          'warning',
        )
      },
      draftManually: () => {
        const g = s.gsecs.map((x) => ({
          ...x,
        }))
        const f = g.find((x) => x.st === 'insufficient')
        if (f) f.st = 'manual'
        setState({
          gsecs: g,
          sel: 's4',
          tab: 'review',
          editing: true,
          draft: '',
        })
        toast('3.3 Water supplies is yours to write. Nothing has been drafted for it.', 'info')
      },
      /* review */
      railItems,
      selectSection: (e: React.MouseEvent<HTMLElement>) =>
        setState({
          sel: e.currentTarget.dataset.id || 's3',
          editing: false,
          activeCite: null,
        }),
      reviewPercent: Math.round((reviewed / Math.max(1, live.length)) * 100),
      reviewLabel: reviewed + ' of ' + live.length + ' sections reviewed',
      selEyebrow:
        TITLES[sel] +
        ' · ' +
        (s.secSt[sel] === 'accepted'
          ? 'accepted'
          : s.secSt[sel] === 'edited'
            ? 'edited by you'
            : 'awaiting your review'),
      selHeading: TITLES[sel],
      selStatus: selOpen.length > 0 ? 'flagged' : s.secSt[sel] || 'draft',
      selConf: sel === 's4' ? 'low' : sel === 's5' ? 'medium' : 'high',
      selEvCount: (EVIDENCE[sel] || []).length,
      selIsRejected: selRejected,
      selShowBlock: !selRejected,
      rejectedLabel: TITLES[sel] + ' was rejected and is excluded from the report.',
      acceptSection: () => {
        if (selOpen.length > 0) {
          toast(
            'Resolve the open review item in ' + TITLES[sel] + ' before accepting it.',
            'warning',
          )
          return
        }
        setState({
          secSt: {
            ...s.secSt,
            [sel]: 'accepted',
          },
        })
        toast(TITLES[sel] + ' accepted. The passage is now recorded as yours.')
      },
      startEdit: () =>
        setState({
          editing: true,
          draft: s.bodyOv[sel] || PLAIN[sel],
        }),
      cancelEdit: () =>
        setState({
          editing: false,
        }),
      saveEdit: () => {
        setState({
          editing: false,
          bodyOv: {
            ...s.bodyOv,
            [sel]: s.draft,
          },
          secSt: {
            ...s.secSt,
            [sel]: 'edited',
          },
        })
        toast(TITLES[sel] + ' updated. The section is recorded as written by you.')
      },
      editing: s.editing,
      draft: s.draft,
      setDraft: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          draft: e.target.value,
        }),
      showOverride: !s.editing && !!s.bodyOv[sel],
      showProse: !s.editing && !s.bodyOv[sel],
      selBodyText: s.bodyOv[sel] || '',
      is_s1: sel === 's1',
      is_s2: sel === 's2',
      is_s3g: sel === 's3g',
      is_s3: sel === 's3',
      is_s4: sel === 's4',
      is_s5: sel === 's5',
      is_s6: sel === 's6',
      rejectSection: () => {
        const order = Object.keys(TITLES)
        const next = order.find((k) => k !== sel && !s.rejected[k]) || sel
        setState({
          rejected: {
            ...s.rejected,
            [sel]: true,
          },
          sel: next,
          editing: false,
        })
        toast(TITLES[sel] + ' rejected and removed from the report.', 'warning')
      },
      undoReject: () => {
        const r = {
          ...s.rejected,
        }
        delete r[sel]
        setState({
          rejected: r,
        })
        toast(TITLES[sel] + ' restored to the report.')
      },
      prevSection: () => {
        const order = Object.keys(TITLES)
        const i = order.indexOf(sel)
        setState({
          sel: order[Math.max(0, i - 1)],
          editing: false,
        })
      },
      nextSection: () => {
        const order = Object.keys(TITLES)
        const i = order.indexOf(sel)
        setState({
          sel: order[Math.min(order.length - 1, i + 1)],
          editing: false,
        })
      },
      focusEvidence: () =>
        toast(
          (EVIDENCE[sel] || []).length +
            ' sources behind ' +
            TITLES[sel] +
            ' are listed in the evidence panel.',
          'info',
        ),
      onProse: (e: React.MouseEvent<HTMLElement>) => {
        const c = e.target instanceof HTMLElement && e.target.dataset.cite
        if (c)
          setState({
            activeCite: Number(c),
          })
      },
      claimVisible: s.u3 !== 'removed',
      claimTone: s.u3 ? 'neutral' : 'moderate',
      claimIcon: s.u3 ? 'check' : 'triangle-alert',
      claimLabel: s.u3 === 'cited' ? 'Source attached' : 'Unsupported claim',
      claimStyle: claimFlagged
        ? ({
            borderBottom: '2px solid var(--status-moderate-fg)',
            background: 'var(--status-moderate-bg)',
            padding: '1px 2px',
          } as React.CSSProperties)
        : ({
            borderBottom: 'none',
          } as React.CSSProperties),
      conflictTone: s.u2 ? 'neutral' : 'moderate',
      conflictIcon: s.u2 ? 'check' : 'git-compare-arrows',
      conflictLabel: s.u2
        ? s.u2 === '8'
          ? 'Source chosen — 2023 report'
          : 'Source chosen — site interview'
        : 'Conflicting sources',
      conflictStyle: conflictFlagged
        ? ({
            borderBottom: '2px solid var(--status-moderate-fg)',
            background: 'var(--status-moderate-bg)',
            padding: '1px 2px',
          } as React.CSSProperties)
        : ({
            borderBottom: 'none',
          } as React.CSSProperties),
      leadTime: s.u2 === '8' ? '8 weeks' : '14 weeks',
      selOpenItems: selOpen,
      hasSelOpenItems: selOpen.length > 0,
      resolveItem: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.item,
          ch = e.currentTarget.dataset.choice
        if (id === 'u3') {
          setState({
            u3: ch === 'a' ? 'removed' : 'cited',
          })
          toast(
            ch === 'a'
              ? 'Unsupported sentence removed from 3.2 Sprinkler protection.'
              : '2021 calculation sheet attached as source 6. The claim is now supported.',
          )
        } else if (id === 'u1') {
          setState({
            u1: ch === 'a' ? 'attached' : 'finding',
          })
          toast(
            ch === 'a'
              ? 'Pump test certificate attached to 3.3 Water supplies.'
              : 'Recorded as a finding: pump test certificate not evidenced at the time of survey.',
          )
        } else {
          setState({
            u2: ch === 'a' ? '14' : '8',
          })
          toast(
            ch === 'a'
              ? 'Lead time set to 14 weeks from the site interview. The passage has been rewritten.'
              : 'Lead time set to 8 weeks from the 2023 report. The passage has been rewritten.',
          )
        }
      },
      selEvidence: evidence,
      selEvLabel: evidence.length + ' items',
      pickEvidence: (e: React.MouseEvent<HTMLElement>) =>
        setState({
          activeCite: Number(e.currentTarget.dataset.i),
        }),
      selObservations: OBS[sel] || [],
      /* export */
      checklist,
      blocked,
      notBlocked: !blocked,
      blockTitle:
        'Export blocked — ' + checklist.filter((c) => !c.ok).length + ' checks outstanding',
      blockBody:
        'A report cannot be issued while sections are unreviewed or review items are open. ' +
        (live.length - reviewed) +
        ' sections await your review and ' +
        open.length +
        ' review items are unresolved.',
      outstanding: open,
      noOutstanding: open.length === 0,
      outstandingLabel: open.length === 0 ? 'None' : open.length + ' open',
      jumpToSection: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.sec
        if (!id) return
        setState({
          tab: 'review',
          sel: id,
          editing: false,
        })
      },
      isDocx: s.fmt === 'DOCX',
      isPdf: s.fmt === 'PDF',
      pickDocx: () =>
        setState({
          fmt: 'DOCX',
        }),
      pickPdf: () =>
        setState({
          fmt: 'PDF',
        }),
      optCite: s.optCite,
      optPhotos: s.optPhotos,
      optIdx: s.optIdx,
      setOptCite: (v: boolean) =>
        setState({
          optCite: v,
        }),
      setOptPhotos: (v: boolean) =>
        setState({
          optPhotos: v,
        }),
      setOptIdx: (v: boolean) =>
        setState({
          optIdx: v,
        }),
      exportLabel: 'Export as ' + s.fmt,
      exportHint: blocked
        ? 'Enabled once the checklist passes.'
        : 'Demo only. No file is generated and no sign-off is recorded.',
      askExport: () => {
        if (!isBlocked())
          setState({
            exportOpen: true,
          })
      },
      closeExport: () =>
        setState({
          exportOpen: false,
        }),
      exportOpen: s.exportOpen,
      exportDialogTitle: 'Export RPT-2026-0411 as ' + s.fmt + '?',
      exportDialogBody:
        live.length +
        ' sections selected. This simulates export only: no file is generated, no report is issued and no sign-off is recorded.',
      exportFooter: (
        <div
          style={{
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            type={'button'}
            onClick={() =>
              setState({
                exportOpen: false,
              })
            }
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              color: 'var(--text-body)',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Cancel'}
          </button>
          <button
            type={'button'}
            onClick={() => {
              setState({
                exportOpen: false,
                screen: 'dashboard',
              })
              toast('Demo export complete. No file was generated or issued.')
            }}
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 5,
              border: '1px solid var(--action-primary)',
              background: 'var(--action-primary)',
              color: '#fff',
              fontFamily: 'var(--font-sans)',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            {'Simulate export'}
          </button>
        </div>
      ),
      wordCount: '7 sections · 4,180 words · 28 photographs',
    }
  }
  function stopGen() {
    const g = state.gsecs.map((x) => ({
      ...x,
    }))
    g.forEach((x) => {
      if (x.st === 'processing' || x.st === 'queued') x.st = 'stopped'
    })
    setState({
      gsecs: g,
      running: false,
      stopOpen: false,
    })
    toast('Generation stopped. Drafted sections are kept and you can resume.', 'warning')
  }
  return renderVals()
}

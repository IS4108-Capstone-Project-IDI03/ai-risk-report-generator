import { useState, useEffect, useRef } from 'react'
import type * as React from 'react'
import { Button, Icon, IconRegistry, toast as sonner } from '../../design-system'
import {
  archiveAssessment as requestArchive,
  restoreAssessment as requestRestore,
  GatewayError,
  listAssessments,
  readObservation,
  retranscribePage,
  retryPageTranscription,
  retryTranscription,
  saveObservation,
  updateObservation,
  correctTranscript,
  correctPageText,
  deleteObservation,
  restoreObservation,
  addObservationMedia,
  removeMedia,
  restoreMedia,
  type MediaKind,
  type ReadingPart,
  type Assessment,
  type ChecklistItem,
  type SavedObservation,
  type SiteLocation,
  type Stamp,
} from './api'
import {
  formatDay as formatDate,
  formatDayYearTime,
  rowStage,
  STAGE_LABEL,
  STATUS_LABEL,
} from './format'
import { guardLeave } from './leaveGuard'
import { choosePhotos, microphoneProblem, record, unsupportedPhotos } from './media'
import {
  filtersActive,
  matchesFilters,
  matchesPlace,
  NO_FILTERS,
  OBSERVATION_STATUSES,
  OBSERVATION_TYPES,
  placeFilter,
  statusOf,
  typeLabel,
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
  ObservationPage,
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
import type { Cope, Severity } from '../site-walk/api'
import { siteWalkReview } from '../site-walk/openReview'
import { reportAssessmentMissing } from './openAssessment'
import { useActivity } from '../marshbot/useActivity'
import type { Priority } from '../marshbot/types'
import {
  addCapturedObservation,
  proposalCapture,
  type ProposalCaptureTarget,
} from '../site-walk/proposalCapture'
import { formatCoordinates, parseCoordinates, type Coordinates } from './googleMaps'
import { useLocations } from './useLocations'
import { useObservations } from './useObservations'
import {
  initialState,
  CAPTURE_ASSESSMENT,
  JURISDICTIONS,
  ROWS,
  CAT_ICON,
  DEMO_LOCATIONS,
  SEV,
  TITLES,
  PLAIN,
  EVIDENCE,
  OBS,
  sampleInterpretation,
  SURVEY_TYPES,
} from './demo-data'
import { roleLabel } from '../accounts/api'
import type { Session } from '../auth/api'
import {
  can,
  canOpen,
  canOpenTab,
  CLIENT_PATH,
  clientIdForPath,
  homeScreen,
  reviewIdForPath,
  SCREEN_PATHS,
  screenForPath,
  type Screen,
} from '../auth/access'
import { clientFacts, type FactVisit } from '../clients/clientFacts'
import { useClientPage } from '../clients/useClientPage'
export type AssessmentWorkflow = ReturnType<typeof useAssessmentWorkflow>
// A change to an observation made in place on its page (CP-06, CP-08).
export type ObservationChange = {
  cats?: string[]
  sev?: string
  locationId?: string
  note?: string
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
// Assessments still in progress: neither finalised nor archived. The
// dashboard boxes and a client's open count both use it.
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
// "9 Nov 2026", as every screen dates a day (format.ts), or Unscheduled.
function formatDay(isoDay: string | null) {
  return isoDay ? formatDate(new Date(isoDay + 'T00:00:00')) : 'Unscheduled'
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
    stage: a.stage,
    priority: a.priority,
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
// What a recording, photo or page is called in what the page says (CP-08, CP-20).
const MEDIA_NOUN = { recordings: 'Recording', photos: 'Photo', pages: 'Page' } as const
// How many things an observation holds: its note, recordings, photos and
// pages. One of them can be removed only while another stays (CP-08, CP-20).
const capturedCount = (o: Observation) =>
  (o.detail?.trim() ? 1 : 0) +
  (o.audio ? 1 : 0) +
  (o.recordings?.length ?? 0) +
  o.media.length +
  (o.pages?.length ?? 0)
// A page written for in the demo (CP-20) shows that text instead.
const pageNote = (p: ObservationPage) =>
  p.status === null
    ? p.correction
      ? null
      : PAGE_TEXT.demo
    : p.status === 'transcribing'
      ? PAGE_TEXT.transcribing
      : p.status === 'transcribed' && !p.transcript?.trim()
        ? PAGE_TEXT.blank
        : null
// The categories the Observations tab filters by: the shared COPE vocabulary
// (CP-08 AC7), shown as the values they are stored as, or Uncategorised.
const CATEGORY_OPTIONS = [...Object.keys(CAT_ICON), UNCATEGORISED]
// The Assessments list's sort choices (the pill shows the current one); must match demo-data.ts.
const SORT_LATEST = 'Survey date, latest first'
const SORT_DUE = 'Report due, earliest first'
const SORT_CLIENT = 'Client name, A to Z'
const SORT_CHOICES = [SORT_LATEST, SORT_DUE, SORT_CLIENT]
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
  checklistOpen: false,
  fChecklistItem: null,
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
// Keep the saved fields intact; display labels cannot recover names containing separators.
const pathOf = (o: Observation) => ({
  building: o.building,
  floor: o.floor,
  name: o.locationName || 'Location not recorded',
  bare: !o.locationName,
})
// The picker's form, empty, adding a location in a building.
const BLANK_LOCATION: LocationForm = {
  kind: 'building',
  building: '',
  floor: '',
  name: '',
  coordinates: '',
}
// The form filled in from a saved location, to change it.
const formOf = (l: SiteLocation): LocationForm => ({
  kind: l.building || l.floor ? 'building' : 'elsewhere',
  building: l.building ?? '',
  floor: l.floor ?? '',
  name: l.name,
  coordinates: l.coordinates ? formatCoordinates(l.coordinates) : '',
})
// The form with nothing refused, asked about or kept as typed.
const FORM_CLEAR = { lfErrors: {}, lfCheck: null, lfKept: {} } satisfies Partial<WorkflowState>
const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')
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
// A page kept in this browser by the demo (CP-19): never transcribed, so it
// has no status, and holds only the text an engineer writes for it (CP-20).
const demoPage = (id: string, name: string, url: string, added: Stamp | null) => ({
  id,
  name,
  url,
  status: null,
  transcript: null,
  original: null,
  uncertain: [],
  error: null,
  correction: null,
  added,
})
// A handwritten page as the gateway sends it (CP-19), shown by the text that
// counts: the engineer's correction where there is one (CP-20), with what
// the model wrote kept beside it.
const toPage = (p: NonNullable<SavedObservation['pages']>[number]): ObservationPage => {
  const { status, transcript, uncertain, error, correction } = p.transcription
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    status,
    transcript: correction?.text ?? transcript,
    original: correction ? transcript : null,
    uncertain,
    error,
    correction: correction ? { at: correction.at, by: correction.by } : null,
    added: p.added ?? null,
  }
}
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
      // A site walk clip plays only its part of the walk (a media fragment).
      audioUrl: r.clip ? r.url + '#t=' + r.clip.start + ',' + r.clip.end : r.url,
      added: r.added,
    }
  })
  // Each handwritten page (CP-19), with its transcript and uncertain words.
  const pages = (o.pages ?? []).map(toPage)
  const removedPages = o.removedPages ?? []
  const statuses = [...recordings, ...pages].map((r) => r.status)
  // Where both parts of its proposal stand (CP-21).
  const reading = [o.interpretation?.status, o.interpretation?.photos?.status]
  // Where its recordings, pages and photos stand (CP-08 AC2, CP-05 AC2,
  // CP-19 AC4): anything still running first, then anything that failed.
  const status = statuses.includes('transcribing')
    ? 'Transcribing'
    : reading.includes('interpreting')
      ? 'Interpreting'
      : statuses.includes('failed')
        ? 'Transcription failed'
        : reading.includes('failed')
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
    checklist: o.checklistItem
      ? { text: o.checklistItem.text, result: o.checklistItem.result }
      : null,
    fromSiteWalk: !!o.fromSiteWalk,
    media: photos.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      added: p.added,
      redaction: p.redaction,
    })),
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
      // And removed handwritten pages (CP-20).
      ...removedPages.map((p) => ({
        kind: 'pages' as const,
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
      photos: o.interpretation.photos && {
        status: o.interpretation.photos.status,
        description: o.interpretation.photos.description,
        hazardType: o.interpretation.photos.hazardType,
        error: o.interpretation.photos.error,
        model: o.interpretation.photos.model,
        outOfDate: o.interpretation.photos.outOfDate,
      },
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
          o.removedRecordings.some((r) => r.id === item.id) ||
          removedPages.some((p) => p.id === item.id)
        const image =
          item.kind === 'photo'
            ? [...photos, ...o.removedPhotos].find((p) => p.id === item.id)?.url
            : item.kind === 'page'
              ? [...(o.pages ?? []), ...removedPages].find((p) => p.id === item.id)?.url
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

// A refusal with "Try again." added, unless it already says when to try
// again ("Try again once they finish."), so the advice is never doubled.
const tryAgain = (message: string) =>
  /\btry again\b/i.test(message) ? message : message + ' Try again.'

// A client name as the gateway matches it (CP-17): lowercased, with its
// spacing tidied, so "NUS" and "nus " are one client.
const clientKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

// Where in an assessment the engineer is, kept in the URL so a refresh (or a
// shared link) reopens the same assessment, tab and observation. Without it a
// refresh fell back to the demo default, Tilbury.
const ASSESSMENT_SCREENS = ['assessment', 'field']
function placeQuery(s: WorkflowState, fromProposal: boolean): string {
  if (!ASSESSMENT_SCREENS.includes(s.screen)) return ''
  const q = new URLSearchParams({ ref: s.captureTarget.reference })
  // The Observations tab's walk screen, which that tab keeps in the URL itself.
  const walk = new URLSearchParams(window.location.search).get('walk')
  if (s.screen === 'assessment') {
    q.set('tab', s.tab)
    if (s.obsOpen) q.set('obs', s.obsOpen)
    if (walk && s.tab === 'observations' && !s.obsOpen) q.set('walk', walk)
  }
  // A proposal's Add observation keeps its review's walk, so a refresh can go back to it.
  if (walk && s.screen === 'field' && fromProposal) q.set('walk', walk)
  return '?' + q.toString()
}
// Returns the assessment, tab and observation the URL names, or nothing.
function placeFromUrl(): Partial<WorkflowState> {
  const q = new URLSearchParams(window.location.search)
  const reference = q.get('ref')
  if (!reference) return {}
  // The site name shows until the gateway's own record arrives.
  const target = { reference, site: ROWS.find((r) => r.id === reference)?.site ?? '' }
  return {
    captureTarget: target,
    recent: [target],
    ...(q.get('tab') && { tab: q.get('tab')! }),
    obsOpen: q.get('obs'),
    // A refreshed proposal Add observation has lost its proposal, and Save
    // would add straight to the assessment; it reopens the review instead.
    ...(q.get('walk') &&
      window.location.pathname === SCREEN_PATHS.field && {
        screen: 'assessment',
        tab: 'observations',
      }),
  }
}

export function useAssessmentWorkflow(onSignOut: () => void, session: Session) {
  // The screen comes from the URL (F-05), so a screen can be linked to and
  // reopened after signing in; '/' opens the role's home screen.
  const [state, updateState] = useState<WorkflowState>(() => ({
    ...structuredClone(initialState),
    screen: screenForPath(window.location.pathname, session),
    ...placeFromUrl(),
    clientPage: clientIdForPath(window.location.pathname),
  }))
  // The URL follows the screen. The first update replaces '/' (or the path
  // opened) rather than adding a history entry.
  const urlSynced = useRef(false)
  // A site walk proposal's Add observation (CP-22 round 3): capture opens on
  // the proposal's locations and Save adds to the proposal, not the assessment.
  const [proposalTarget, setProposalTarget] = useState<ProposalCaptureTarget | null>(null)
  const place = placeQuery(state, !!proposalTarget)
  useEffect(() => {
    // A client's page (CP-18) has the client in its path.
    const path =
      state.screen === 'client' && state.clientPage
        ? CLIENT_PATH + encodeURIComponent(state.clientPage)
        : SCREEN_PATHS[state.screen as Screen]
    // A knowledge document's Review page is part of the knowledge screen, so
    // its own path stays (IN-07).
    const onReviewPage = state.screen === 'knowledge' && reviewIdForPath(window.location.pathname)
    if (path && !onReviewPage) {
      const url = path + place
      const here = window.location.pathname + window.location.search
      // A new screen is a history entry; a new tab or observation on the same
      // screen only rewrites it, so Back still leaves the screen.
      if (url === here) return void (urlSynced.current = true)
      if (urlSynced.current && window.location.pathname !== path)
        window.history.pushState(null, '', url)
      else window.history.replaceState(null, '', url)
    }
    urlSynced.current = true
  }, [state.screen, state.clientPage, place])
  // Back and forward move between screens.
  useEffect(() => {
    const follow = () =>
      updateState((previous) => ({
        ...previous,
        screen: screenForPath(window.location.pathname, session),
        ...placeFromUrl(),
        clientPage: clientIdForPath(window.location.pathname),
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
  useEffect(() => {
    const open = (e: Event) => {
      const target = (e as CustomEvent<ProposalCaptureTarget>).detail
      setProposalTarget(target)
      setState({
        screen: 'field',
        fLocationId: target.locationId,
        locDismissed: false,
        obsReturn: null,
      })
    }
    window.addEventListener(proposalCapture.event, open)
    return () => window.removeEventListener(proposalCapture.event, open)
  }, [])
  // Leaving capture, however, ends it and reopens the review on the Observations tab.
  if (proposalTarget && state.screen !== 'field') {
    siteWalkReview.walkId = proposalTarget.walkId
    setProposalTarget(null)
  }
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
  // Counts up with every read of the list and every change made here since. A reply is used only
  // if it is the latest: without this, a read sent just before a reassign could land after it and
  // put the old engineer back on the row.
  const rowsRead = useRef(0)
  // The assessment the open Archive confirm is for, when asked from a list row (CP-23).
  const [archiveRef, setArchiveRef] = useState<string | null>(null)
  // The Clients list is drawn from the work list, and a client page (CP-18)
  // opens the engineer's assessments, so both need it too, even when one is
  // the first screen opened.
  const onClientScreen = state.screen === 'client' && canOpen('client', session)
  const onClientsScreen = state.screen === 'clients' && canOpen('clients', session)
  const onDashboard = state.screen === 'dashboard' && canOpen('dashboard', session)
  // The Inbox opens an assessment from a row (F-10), which needs the list to find it.
  const onInbox = state.screen === 'inbox' && canOpen('inbox', session)
  const listScreen = onDashboard
    ? 'dashboard'
    : onClientScreen
      ? 'client'
      : onClientsScreen
        ? 'clients'
        : onInbox
          ? 'inbox'
          : null
  const clientPage = useClientPage(onClientScreen ? state.clientPage : null)
  // A refresh inside a workspace needs the list too, for the assessment's own record.
  const needsRows =
    listScreen ?? ((onWorkspace || onField) && serverRows === null ? 'workspace' : null)
  // Reads the work list and returns it. Its rows are used only if nothing newer happened since
  // it was sent: a read sent before a reassign or a create would otherwise undo it.
  async function readRows(signal?: AbortSignal) {
    const sent = ++rowsRead.current
    const list = await listAssessments(signal)
    if (sent === rowsRead.current) {
      setServerRows(list.map(toRow))
      // A row created in this browser that the gateway no longer lists has moved to another
      // engineer; without this it would stay on the old engineer's list until a refresh.
      const listed = new Set(list.map((a) => a.reference))
      updateState((previous) => ({
        ...previous,
        createdRows: previous.createdRows.filter((r) => !r.persisted || listed.has(r.id)),
      }))
    }
    return list
  }
  useEffect(() => {
    // Refetched on every return to the dashboard, so capture progress shows.
    if (!needsRows) return
    const controller = new AbortController()
    readRows(controller.signal).then(
      (list) => {
        setListFailed(false)
        // An assessment reopened from the URL knows only its reference: its
        // site name (header, Recent) comes from the list.
        const rows = list.map(toRow)
        updateState((previous) => {
          const row = rows.find((r) => r.id === previous.captureTarget.reference)
          if (!row || previous.captureTarget.site) return previous
          const target = { reference: row.id, site: row.site }
          return {
            ...previous,
            captureTarget: target,
            recent: previous.recent.map((r) => (r.reference === row.id ? target : r)),
          }
        })
      },
      () => {
        if (!controller.signal.aborted) setListFailed(true)
      },
    )
    return () => controller.abort()
  }, [needsRows])
  // Reads the work list again after a change elsewhere, e.g. a site corrected
  // from the Overview or a client page (CP-18).
  const reloadRows = () => readRows().catch(() => null)
  // The Undo in the archived toast (CP-23): restores it and reads the list again.
  async function undoArchive(reference: string) {
    try {
      await requestRestore(reference)
      await reloadRows()
      sonner.success(reference + ' restored')
    } catch {
      sonner.error('Could not restore', { description: 'Check your connection and try again.' })
    }
  }
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
  // `view` names an observation the toast offers to open.
  function toast(message: string, tone = 'success', view: string | null = null) {
    setState({
      toast: message,
      toastTone: tone || 'success',
      toastView: view,
    })
  }
  // The workspace and capture both act on the assessment last opened from the list.
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
  // Created from the New Assessment screen (CP-23): every new assessment is
  // the engineer's own (AC10), so each joins their list, which shows next.
  function addCreatedRows(rows: AssessmentRow[]) {
    rowsRead.current += 1
    updateState((previous) => ({
      ...previous,
      createdRows: [...rows, ...previous.createdRows],
      screen: 'dashboard',
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
        <button
          type="button"
          className="ds-sidenav-icon-button"
          title="Sign out"
          aria-label="Sign out"
          // Unsaved document edits ask first (RV-08 AC14).
          onClick={() => guardLeave(onSignOut)}
        >
          <Icon name="log-out" size={16} />
        </button>
      </div>
    )
  }
  // AS-06: the assigned engineer's time on the open workspace tab (an admin's is not counted).
  useActivity(
    state.screen === 'assessment' ? state.captureTarget.reference : null,
    'tab:' + state.tab,
    serverRows?.find((r) => r.id === state.captureTarget.reference)?.engineerId === session.user.id,
  )
  function renderVals() {
    const s = state
    const sc = s.screen,
      live = liveSections(),
      open = openItems()
    const isAssessment = sc === 'assessment'
    const w = viewportWidth
    const narrow = w < 1080
    const phone = w < 768
    // Tablets open with the icon rail (CP-23); a person's own toggle wins.
    const tablet = !phone && w < 1024

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
          path: pathOf(o),
          cat: categoryLabel(o.cats),
          cats: o.cats,
          text: o.text,
          time: o.time,
          openObservation: () =>
            setState({
              tab: 'observations',
              obsOpen: key,
              obsFrom: 'photos',
              obsShowDeleted: false,
              of: NO_FILTERS,
            }),
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
    const dialogRow = s.obsDialog && allRows.find((r) => r.key === s.obsDialog!.key)
    const obsNoun = s.obsShowDeleted ? 'deleted observation' : 'observation'
    // The Observations tab by building, level and location (CP-16), unless
    // sorted newest first; the deleted ones are always newest first.
    const obsByLocation = s.obsSort === 'location' && !s.obsShowDeleted
    // Real recording needs a capture session on the server; without one, voice stays simulated.
    const liveVoice = !!liveCapture
    // Capture starts from a location; the sheet stays open until one is chosen.
    // The locations capture picks from: the proposal's, when adding to one.
    const pickable = proposalTarget?.locations ?? places.locations
    const currentLocation = pickable.find((l) => l.id === s.fLocationId) ?? null
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
      locBlock: null,
      locAdding: false,
      locEdit: null,
      ...FORM_CLEAR,
      locRemove: null,
    }
    const query = s.locQuery.trim().toLowerCase()
    // The picker's groups, of the locations the search matches (CP-16).
    const locationGroups = groupLocations(
      pickable.filter(
        (l) =>
          (!s.locBlock || sameName(l.building, s.locBlock)) &&
          (!query || locationLabel(l).toLowerCase().includes(query)),
      ),
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
    // Adds the form to the site walk proposal (CP-22 round 3): its media go to
    // the walk, the observation into the proposal, then the review opens on it.
    // If it fails, everything stays for another try, as in saveToGateway.
    async function saveToProposal(
      target: ProposalCaptureTarget,
      location: SiteLocation,
      note: string | undefined,
    ) {
      const { fClips: clips, fPhotos: photos, fPages: pages } = s
      setState({ fSaving: true, fSaveError: null })
      try {
        siteWalkReview.observationRef = await addCapturedObservation(target, {
          locationId: location.id,
          note: note ?? '',
          copeDimension: (s.fCats[0] as Cope | undefined) ?? null,
          severity: (s.fSev || null) as Severity | null,
          clips: clips.map((c) => c.audio),
          photos: photos.map((p) => p.image),
          pages: pages.map((p) => p.image),
        })
      } catch (error: unknown) {
        setState({
          fSaving: false,
          fSaveError: {
            title: 'Observation not added',
            message:
              (error instanceof GatewayError && error.status !== null
                ? error.message
                : 'The gateway could not be reached.') +
              ' Everything is still listed; press Save observation to try again.',
          },
        })
        return
      }
      for (const file of [...clips, ...photos, ...pages]) URL.revokeObjectURL(file.url)
      setState({ ...BLANK_DRAFT, fSaving: false, ...toTab('observations') })
      toast('Observation added to the proposal')
    }
    async function saveToGateway(
      location: SiteLocation,
      note: string | undefined,
      clips: VoiceClip[],
      photos: PhotoFile[],
      pages: PhotoFile[],
    ) {
      const reference = s.captureTarget.reference
      // The checklist item this answers as Differs, if it was opened from one (CP-31 AC3).
      const { fCats: cats, fSev: severity, fChecklistItem: item } = s
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
            ...(item && { checklistItem: { itemId: item.id, result: 'differs' as const } }),
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
        fChecklistItem: previous.fChecklistItem === item ? null : previous.fChecklistItem,
        fToast: null,
        // A toast with View, so the engineer stays on the form for the next one.
        toast:
          'Observation saved' +
          (item ? ', and the checklist item answered as Differs' : '') +
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
        toastTone: 'success',
        toastView: observation.id,
      }))
    }
    // Changes the observation kept in this browser under a local-<n> row key,
    // a sample one: the demo keeps the change in memory only.
    // `from` is the latest state, for a change applied after other saves.
    function changeLocal(
      key: string,
      change: (o: Observation) => Observation,
      from: WorkflowState = s,
    ) {
      const n = Number(key.slice('local-'.length))
      const recent = isDemoCapture
        ? from.fRecent
        : (from.captureObs[from.captureTarget.reference] ?? [])
      const list = recent.map((x, i) => (i === n ? change(x) : x))
      return isDemoCapture
        ? { fRecent: list }
        : { captureObs: { ...from.captureObs, [from.captureTarget.reference]: list } }
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
    // Saves a change made in place on the observation page: its tags (CP-06)
    // or its note (CP-08 AC8), on the gateway for a saved observation, sending
    // only what changed, or in this browser for one kept in the demo. The note
    // is saved exactly as typed, and a blank one removes it, which an
    // observation with nothing else captured can't do (AC9). Throws the
    // reason a save failed, so the page keeps the change for another try (AC18).
    async function saveObsChanges(key: string, change: ObservationChange) {
      const row = allRows.find((r) => r.key === key)
      if (!row) return
      const { o } = row
      const cats = change.cats ?? o.cats
      const sev = change.sev ?? o.sev
      const note = change.note ?? o.detail ?? ''
      // Unlisted (e.g. a sample observation on a live assessment): left as it is.
      const location = change.locationId
        ? places.locations.find((l) => l.id === change.locationId)
        : undefined
      const noteChanged = change.note !== undefined && note !== (o.detail ?? '')
      if (!o.id) {
        if (noteChanged && !note.trim() && !o.audio && !o.media.length && !o.pages?.length)
          throw new Error(
            'An observation needs a note, a recording, a photo or a page, so this note can’t be removed.',
          )
        // Built on the latest state and row, so a queued save can't undo an earlier one.
        updateState((latest) => ({
          ...latest,
          ...changeLocal(
            key,
            (x) => ({
              ...x,
              cats: change.cats ?? x.cats,
              sev: change.sev ?? x.sev,
              ...(location && {
                locationName: location.name,
                building: location.building,
                floor: location.floor,
                locationId: location.id,
              }),
              ...(noteChanged && { detail: note, text: note.trim() ? note : x.text }),
              edited: stampNow(),
            }),
            latest,
          ),
        }))
        return
      }
      // A tag or note the change names is always sent: `o` can be older than a queued save,
      // so comparing with it could drop an undo as "no change".
      const changes = {
        ...(change.cats && { copeDimensions: copeDimensionsOf(cats) }),
        ...(change.sev && { severity: sev }),
        ...(location && { locationId: location.id }),
        ...(change.note !== undefined && { note: note.trim() ? note : null }),
      }
      if (!Object.keys(changes).length) return
      let saved
      try {
        saved = await updateObservation(o.id, changes)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
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
    // Saves a handwritten page's corrected text (CP-20). The gateway keeps
    // what the model wrote beside it, and drafting uses the correction. A
    // demo page, never transcribed, keeps the text written for it in this
    // browser.
    async function savePageText(text: string) {
      const page = dialogRow?.o.pages?.find((p) => p.id === s.obsDialog?.pageId)
      if (!dialogRow || !page) return
      if (text === (page.transcript ?? '')) return setState({ obsDialog: null })
      const { o, key } = dialogRow
      if (!o.id) {
        const correction = stampNow()
        setState({
          ...changeLocal(key, (x) => ({
            ...x,
            pages: x.pages?.map((p) =>
              p.id === page.id ? { ...p, transcript: text, correction } : p,
            ),
            edited: correction,
          })),
          obsDialog: null,
        })
        return toast('Page text saved in this demo only.')
      }
      let saved
      try {
        saved = await correctPageText(o.id, page.id, text)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      setState({ obsDialog: null })
      toast('Page text corrected. Report drafting uses your wording.')
    }
    // Transcribes a corrected page again once the engineer confirms (CP-20):
    // the correction goes with the old text. Throws the reason it failed, so
    // the dialog shows it.
    async function confirmTranscribeAgain() {
      const pageId = s.obsDialog?.pageId
      if (!dialogRow?.o.id || !pageId) return
      let saved
      try {
        saved = await retranscribePage(dialogRow.o.id, pageId)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      captured.reload()
      setState({ obsDialog: null })
      toast('Transcribing the page again. Your corrected text was replaced.')
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
      toast('Observation deleted. Restore it from Deleted observations.')
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
        return toast(tryAgain(refusal(error)), 'warning')
      }
      captured.replace(saved)
      setState({ obsOpen: null })
      toast('Observation restored. Report drafting uses it again.')
    }
    // Adds the recordings, photos and handwritten pages listed in the Add
    // media dialog (CP-08, CP-20): through the gateway for a saved
    // observation, which stores and transcribes them, or in this demo for a
    // sample one. Throws the reason a save failed, so the dialog keeps the
    // list for another try.
    async function addMedia(clips: VoiceClip[], photos: PhotoFile[], pages: PhotoFile[] = []) {
      if (!dialogRow) return
      const { o, key } = dialogRow
      const what = [
        clips.length ? plural(clips.length, 'recording') : '',
        photos.length ? plural(photos.length, 'photo') : '',
        pages.length ? plural(pages.length, 'page') : '',
      ]
        .filter(Boolean)
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1')
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
            pages: [
              ...(x.pages ?? []),
              ...pages.map((p) => demoPage('local-page-' + p.id, p.name, p.url, added)),
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
          pages.map((p) => ({ name: p.name, image: p.image })),
        )
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      // Re-reading the list keeps it refreshing until the transcriptions finish.
      if (clips.length || pages.length) captured.reload()
      // The gateway now serves them; the previews in this browser are done.
      for (const file of [...clips, ...photos, ...pages]) URL.revokeObjectURL(file.url)
      setState({ obsDialog: null })
      const transcribing = [
        clips.length ? plural(clips.length, 'recording') : '',
        pages.length ? plural(pages.length, 'page') : '',
      ]
        .filter(Boolean)
        .join(' and ')
      toast('Added ' + what + '.' + (transcribing ? ' Transcribing ' + transcribing + ' now.' : ''))
    }
    // Moves a sample observation's recording, photo or page out of, or back
    // into, its evidence, in this demo only (CP-08, CP-20).
    function moveLocal(x: Observation, item: { kind: MediaKind; id: string; name: string }) {
      const removed = x.removedMedia?.find((m) => m.id === item.id)
      if (removed)
        return {
          ...x,
          removedMedia: x.removedMedia!.filter((m) => m !== removed),
          ...(item.kind === 'photos'
            ? { media: [...x.media, { id: removed.id, name: removed.name, url: removed.url }] }
            : item.kind === 'pages'
              ? {
                  pages: [
                    ...(x.pages ?? []),
                    removed.page ?? demoPage(removed.id, removed.name, removed.url ?? '', null),
                  ],
                }
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
      const page = x.pages?.find((p) => p.id === item.id)
      return {
        ...x,
        media: x.media.filter((m) => m !== photo),
        recordings: x.recordings?.filter((r) => r !== recording),
        pages: x.pages?.filter((p) => p !== page),
        removedMedia: [
          ...(x.removedMedia ?? []),
          {
            ...item,
            url: photo?.url ?? recording?.audioUrl ?? page?.url ?? null,
            removed: stampNow(),
            ...(page && { page }),
          },
        ],
        interpretation:
          (photo || recording || page) && x.interpretation
            ? { ...x.interpretation, outOfDate: true }
            : x.interpretation,
        edited: stampNow(),
      }
    }
    // Removes the recording, photo or page in the Remove dialog (CP-08,
    // CP-20), a soft removal: the gateway keeps it to restore, and drafting
    // stops using it.
    async function confirmRemoveMedia() {
      const item = s.obsDialog?.media
      if (!dialogRow || !item) return
      const { o, key } = dialogRow
      const noun = MEDIA_NOUN[item.kind]
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
          {
            recordings: 'Report drafting no longer uses its transcript. ',
            photos: 'It leaves the Photos tab. ',
            pages: 'Report drafting no longer uses its text. ',
          }[item.kind] +
          'Restore it under Removed media.',
      )
    }
    // Restores a removed recording, photo or page to the observation (CP-08, CP-20).
    async function restoreItem(
      key: string,
      o: Observation,
      item: { kind: MediaKind; id: string; name: string },
    ) {
      const noun = MEDIA_NOUN[item.kind]
      if (!o.id) {
        setState(changeLocal(key, (x) => moveLocal(x, item)))
        return toast(noun + ' restored in this demo only.')
      }
      let saved
      try {
        saved = await restoreMedia(o.id, item.kind, item.id)
      } catch (error: unknown) {
        return toast(tryAgain(refusal(error)), 'warning')
      }
      captured.replace(saved)
      toast(
        noun +
          ' restored.' +
          {
            recordings: ' Report drafting uses its transcript again.',
            photos: '',
            pages: ' Report drafting uses its text again.',
          }[item.kind],
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
      const typedPoint = form.coordinates.trim()
      const coordinates = parseCoordinates(typedPoint)
      // Sent only when there's something to save or clear, so an edit of a
      // location without any stays as it was.
      const before = places.locations.find((l) => l.id === editing)
      const hadPoint = before?.coordinates
      const details = {
        name: form.name.trim(),
        ...(building && { building }),
        ...(floor && { floor }),
        ...((coordinates || hadPoint) && { coordinates }),
      }
      const missing = {
        ...(inBuilding && !building && { building: 'Name the building.' }),
        ...(!details.name && { name: 'Name the location.' }),
        ...(typedPoint &&
          !coordinates && { coordinates: 'Enter coordinates such as 1.2966, 103.8520' }),
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
        locBlock: null,
        // A new location is where the engineer is now; an edited one changes
        // nothing about where they are.
        ...(!editing && { locOpen: false, fLocationId: location.id }),
      })
      // The first coordinates in a block also set its pin on the site, so the
      // Geolocation card and the picker's tracking read the site again.
      const moved =
        coordinates?.lat !== hadPoint?.lat ||
        coordinates?.lng !== hadPoint?.lng ||
        building !== (before?.building ?? '')
      if (places.live && coordinates && moved) void reloadRows()
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
        toast(tryAgain(cause), 'warning')
      }
    }
    // The same for a handwritten page whose transcription failed (CP-19 AC11).
    async function retryPage(id: string, pageId: string) {
      try {
        await retryPageTranscription(id, pageId)
        captured.reload()
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.message : 'The retry was not accepted.'
        toast(tryAgain(cause), 'warning')
      }
    }
    // Transcribes a finished page again, when its text looks misread (CP-20).
    async function transcribeAgain(id: string, pageId: string) {
      try {
        await retranscribePage(id, pageId)
        captured.reload()
      } catch (error: unknown) {
        toast(tryAgain(refusal(error)), 'warning')
      }
    }
    // Reads a saved observation when the engineer asks (CP-05, CP-21): both
    // parts the first time, or one part again.
    async function readSaved(id: string, part?: ReadingPart) {
      try {
        await readObservation(id, part)
        captured.reload()
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.message : 'The request was not accepted.'
        toast(tryAgain(cause), 'warning')
      }
    }
    // A sample proposal settles after a moment, as a real reading would.
    // Matched by its sample flag, not its place in the list, which a later
    // observation shifts.
    function settleSamples() {
      const settle = (list: Observation[]) =>
        list.map((x) =>
          x.interpretation?.sample
            ? {
                ...x,
                interpretation: {
                  ...x.interpretation,
                  status: 'interpreted' as const,
                  photos: x.interpretation.photos && {
                    ...x.interpretation.photos,
                    status: 'interpreted' as const,
                  },
                },
              }
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
    function readSample(key: string, part?: ReadingPart) {
      setState(
        changeLocal(key, (x) => {
          const sample = sampleInterpretation(x.cats, x.locationName, x.media.length > 0)
          // One part read again leaves the other as it was (CP-21).
          return {
            ...x,
            interpretation:
              part && x.interpretation
                ? part === 'categories'
                  ? { ...x.interpretation, status: sample.status, categories: sample.categories }
                  : { ...x.interpretation, photos: sample.photos }
                : sample,
          }
        }),
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

    // Opens an assessment pressed elsewhere (an Inbox or bell row). A row that came in by poll
    // can be newer than the list held here, so a miss reads the list again before giving up.
    async function openFromOutside(reference: string, tab?: 'observations') {
      const row =
        rows.find((r) => r.id === reference) ??
        (await reloadRows())?.map(toRow).find((r) => r.id === reference)
      if (!row) {
        // Without this the walk's review would open on the next assessment's Observations tab.
        siteWalkReview.walkId = null
        sonner.error('Assessment not found', {
          description: 'It may have moved. Check your Assessments list.',
        })
        return reportAssessmentMissing(reference)
      }
      releaseDraft(row.id)
      const target = { reference: row.id, site: row.site }
      updateState((previous) => ({
        ...previous,
        ...openAssessment(target, previous),
        ...(tab && { tab }),
      }))
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
    const isMine = !!targetRow?.persisted && targetRow.engineerId === session.user.id
    // An admin's list holds everyone's assessments (RV-11), and they change only their own:
    // someone else's saved assessment is read-only here, as the gateway makes it.
    // So is one opened by link that is missing from the work list, which holds
    // only the engineer's own, once the gateway has sent its observations: it
    // is another engineer's, not a sample to change in this browser.
    const readOnlyHere = targetRow?.persisted ? !isMine : !targetRow && captured.synced
    const canCapture = !!targetRow && targetRow.status !== STATUS_LABEL.archived && !readOnlyHere
    // Changing an observation takes the assessment's assigned engineer, and
    // not once it is archived (CP-08 AC17). The gateway decides; the browser
    // hides the actions once the work list shows they'd be refused, for the
    // sample observations too, which change in this browser only.
    const canChangeObs =
      canEdit && !readOnlyHere && (!targetRow?.persisted || (isMine && canCapture))
    // An observation's handwritten pages as shown (CP-19): where each stands
    // when there is no text, Retry after a failure (only for the assigned
    // engineer, as a recording's), and Transcribe again once one is finished (only
    // for whoever may change the observation, as it replaces evidence; CP-20).
    // Whoever may change it can also correct a finished page's text, write a
    // demo page's, and remove a page while something else stays (CP-20).
    // Transcribing a corrected page again asks first, as it drops the correction.
    const pageViews = (o: Observation, key: string): PageView[] => {
      const changing = canChangeObs && !o.deleted
      return (o.pages ?? []).map((p) => ({
        ...p,
        note: pageNote(p),
        retry:
          canEdit && !readOnlyHere && !o.deleted && o.id ? () => void retryPage(o.id!, p.id) : null,
        again:
          changing && o.id && p.status === 'transcribed'
            ? p.correction
              ? () => setState({ obsDialog: { kind: 'retranscribe', key, pageId: p.id } })
              : () => void transcribeAgain(o.id!, p.id)
            : null,
        correct:
          changing && (o.id ? p.status === 'transcribed' : p.status === null)
            ? () => setState({ obsDialog: { kind: 'pageText', key, pageId: p.id } })
            : null,
        remove:
          changing && capturedCount(o) > 1
            ? () =>
                setState({
                  obsDialog: {
                    kind: 'removeMedia',
                    key,
                    media: { kind: 'pages', id: p.id, name: p.name },
                  },
                })
            : null,
        correctedLabel: p.correction ? 'Corrected by ' + stampLabel(p.correction) : null,
        addedLabel: p.added ? 'Added by ' + stampLabel(p.added) : null,
      }))
    }
    // The assessment's handwritten pages (CP-19), gathered as the photo
    // collection gathers its photos: every page of an observation not deleted,
    // newest first, each with the observation it belongs to.
    const scanCollection = allRows
      .filter(({ o }) => !o.deleted)
      .flatMap(({ o, key }) =>
        pageViews(o, key).map((page) => ({
          key: key + '/' + page.id,
          page,
          where: placeOf(o),
          path: pathOf(o),
          cat: categoryLabel(o.cats),
          cats: o.cats,
          text: o.text,
          time: o.time,
          openObservation: () =>
            setState({
              tab: 'observations',
              obsOpen: key,
              obsFrom: 'scans',
              obsShowDeleted: false,
              of: NO_FILTERS,
            }),
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
    // The Inbox (F-10) above the groups, then Work and Tools (CP-23) in that order for both
    // roles, then the assessments last opened, which fold away. A role sees only the places
    // it may open, and a group with none of them is left out.
    const order = ['', 'Work', 'Tools', 'Recent']
    const navSections = [
      // No heading: the Inbox is the one item that sits apart. Its red count is added by
      // AssessmentApp, from the shared notification counts.
      { label: '', items: [{ value: 'inbox', label: 'Inbox', icon: 'inbox' }] },
      {
        label: 'Work',
        items: [
          { value: 'dashboard', label: 'Assessments', icon: 'clipboard-list' },
          // The engineer's clients and their pages (CP-18).
          { value: 'clients', label: 'Clients', icon: IconRegistry.object.client },
        ],
      },
      {
        label: 'Tools',
        items: [
          { value: 'chat', label: 'MarshBot', icon: 'bot' },
          { value: 'knowledge', label: 'Knowledge base', icon: 'library' },
          { value: 'usage', label: 'Usage and Costs', icon: 'coins' },
          { value: 'users', label: 'User accounts', icon: 'users' },
        ],
      },
      { label: 'Recent', collapsible: true, items: recentItems },
    ]
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          canOpen(item.value.startsWith(RECENT_PREFIX) ? 'assessment' : item.value, session),
        ),
      }))
      .filter((section) => section.items.length > 0)
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))

    const q = s.q.trim().toLowerCase()
    // Archived is a Status filter choice (CP-23); without it archived rows are hidden.
    const fStatus = s.fStatus
    const showArchived = fStatus === STATUS_LABEL.archived
    const isArchived = (r: AssessmentRow) => r.status === STATUS_LABEL.archived
    const isFinished = (r: AssessmentRow) => r.status === STATUS_LABEL.finalised || isArchived(r)
    // A saved sort that is no longer a choice falls back to the default.
    const workSort = SORT_CHOICES.includes(s.workSort) ? s.workSort : SORT_LATEST
    const byName = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    const filtered = rows
      .filter((r) => {
        if (q && !(r.site + ' ' + r.client + ' ' + r.id).toLowerCase().includes(q)) return false
        if (isArchived(r) !== showArchived) return false
        if (!showArchived && fStatus !== 'All statuses' && rowStage(r) !== fStatus) return false
        if (s.fDate && !DATE_FILTERS[s.fDate](r)) return false
        if (s.fVisitType && r.type !== s.fVisitType) return false
        return true
      })
      // The list's order; By client groups follow it, each by its best row (below).
      .sort((a, b) =>
        workSort === SORT_DUE
          ? // Finished work has nothing left to chase, so it sorts after the open work.
            Number(isFinished(a)) - Number(isFinished(b)) ||
            (a.reportDueDate || '9999-12-31').localeCompare(b.reportDueDate || '9999-12-31')
          : workSort === SORT_CLIENT
            ? byName(a.client, b.client) ||
              byName(a.site, b.site) ||
              (b.siteVisitDate || '').localeCompare(a.siteVisitDate || '')
            : (b.siteVisitDate || '').localeCompare(a.siteVisitDate || ''),
      )
      .map((r) => ({
        ...r,
        overdue: isOverdue(r),
        sevIcon: SEV[r.sev].icon,
        sevColor: SEV[r.sev].color,
        dueDate: r.reportDueDate ? formatDay(r.reportDueDate) : 'Not set',
        countdown: dueCountdown(r),
      }))
    // The work list by client, then site, in name order, each site's visits in
    // the order chosen (CP-17 AC9). A site saved on the gateway is
    // grouped by its ids; the demo's by name. A search opens every client.
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
    // The archived list groups too (CP-18), so a client whose visits are all
    // archived can still be opened, to correct or restore its sites.
    for (const r of s.workByClient ? filtered : []) {
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
    // create form opens on it, its copy ticked. From the work list or a
    // client page (CP-18).
    const visitSite = (
      client: { id: string; name: string },
      site: Pick<Assessment['site'], 'id' | 'name' | 'address' | 'jurisdiction' | 'facilityType'>,
    ) =>
      setState({
        screen: 'create',
        createStart: {
          mode: 'form',
          clientId: client.id,
          clientName: client.name,
          siteId: site.id,
        },
      })
    // A new site for a client, from its page (CP-18): the create form with the
    // client chosen and Add a new site picked, as a site comes with its first
    // visit (CP-17).
    const addSiteTo = (client: { id: string; name: string }) =>
      setState({
        screen: 'create',
        createStart: { mode: 'form', clientId: client.id, clientName: client.name, siteId: 'new' },
      })
    // A client's page (CP-18), opened from the Clients list, the work list or
    // an assessment.
    const openClient = (id: string, tab: WorkflowState['clientTab'] = null) =>
      setState({
        screen: 'client',
        clientPage: id,
        clientDialog: null,
        clientTab: tab,
        toast: null,
      })
    // A client page's occasional actions (CP-18), behind the header's ⋯:
    // each disabled, with its reason, when it isn't the engineer's to take.
    // A removed client has none; its page offers Restore instead.
    const clientMenuModel = (() => {
      const page = clientPage.page
      if (sc !== 'client' || !page || page.removed) return null
      return {
        items: [
          {
            label: 'Rename client',
            icon: 'pencil',
            disabled: !page.rename.allowed,
            onSelect: () => setState({ clientDialog: 'rename' }),
          },
          {
            label: 'Remove client',
            icon: IconRegistry.action.discard,
            disabled: !page.remove.allowed,
            onSelect: () => setState({ clientDialog: 'remove' }),
          },
        ],
        notes: [
          ...new Set(
            [page.rename, page.remove].flatMap((x) => (!x.allowed && x.reason ? [x.reason] : [])),
          ),
        ],
      }
    })()
    // A client page's main action (CP-23): New assessment for a client still
    // in use, the create form with the client chosen; a removed one is restored first.
    const clientNewAssessment =
      sc === 'client' && clientPage.page && !clientPage.page.removed && canOpen('create', session)
        ? () => addSiteTo(clientPage.page!)
        : null
    // The engineer's clients (CP-18): each client of their assessments on the
    // gateway, with how many of its sites they visit, and their visits there,
    // open and archived. One whose sites are all removed is marked so.
    const myClients = (() => {
      const byId = new Map<
        string,
        {
          id: string
          name: string
          sites: Map<string, { name: string; removed: boolean; jurisdiction: string }>
          visits: FactVisit[]
          priorities: Priority[]
        }
      >()
      for (const r of rows) {
        const a = r.record
        if (!r.persisted || !a?.clientId) continue
        const c = byId.get(a.clientId) ?? {
          id: a.clientId,
          name: a.client,
          sites: new Map(),
          visits: [] as FactVisit[],
          priorities: [] as Priority[],
        }
        byId.set(a.clientId, c)
        c.sites.set(a.site.id, {
          name: a.site.name,
          removed: a.site.removed,
          jurisdiction: a.site.jurisdiction,
        })
        if (r.priority) c.priorities.push(r.priority)
        c.visits.push({
          site: a.site.name,
          surveyDate: a.siteVisitDate,
          dueDate: a.reportDueDate,
          archived: a.status === 'archived',
          done: a.status === 'archived' || a.status === 'finalised',
        })
      }
      return [...byId.values()]
        .sort((a, b) => byName(a.name, b.name))
        .map((c) => {
          const sites = [...c.sites.values()]
          const listed = sites.filter((x) => !x.removed).length
          return {
            id: c.id,
            name: c.name,
            removed: listed === 0,
            sites: listed,
            // Its listed sites' jurisdictions, each once (the Clients table's column).
            jurisdictions: [...new Set(sites.filter((x) => !x.removed).map((x) => x.jurisdiction))],
            facts: clientFacts(c.visits),
            // The reasons its assessments are urgent (AS-06); the Clients table marks the first.
            priorities: c.priorities,
            // Found by its name or one of its sites'.
            search: [c.name, ...sites.map((x) => x.name)].join(' ').toLowerCase(),
            open: () => openClient(c.id),
          }
        })
    })()
    // Groups and sites come out in the order their first (best) row has in the sorted list.
    const workGroups = [...workClients.values()].map((client) => {
      const sites = [...client.sites.values()]
      const open = !!q || !s.workFolded[client.key]
      // Only a client on the gateway has a page; sample rows have none.
      const clientId = sites
        .flatMap((site) => site.rows)
        .find((r) => r.persisted && r.record?.clientId)?.record?.clientId
      // "Open" is work still in progress, neither finalised nor archived (CP-23).
      const openCount = sites.reduce((n, site) => n + site.rows.filter(inProgress).length, 0)
      return {
        key: client.key,
        title: client.title,
        countLabel: plural(sites.length, 'site') + ' · ' + openCount + ' open',
        open,
        toggle: () => setState({ workFolded: { ...s.workFolded, [client.key]: open } }),
        viewClient: clientId && canOpen('client', session) ? () => openClient(clientId) : undefined,
        // The create form with the client chosen, as on the client's page (CP-23).
        newAssessment:
          clientId && canOpen('create', session)
            ? () => addSiteTo({ id: clientId, name: client.title })
            : undefined,
        sites: sites.map((site) => {
          const record = site.rows.find((r) => r.record?.clientId)?.record
          return {
            key: site.key,
            name: site.name,
            address: site.address,
            countLabel: plural(site.rows.length, 'visit'),
            rows: site.rows,
            // A removed site (CP-18) takes no new visit.
            newVisit:
              record && !record.site.removed && canOpen('create', session)
                ? () => visitSite({ id: record.clientId!, name: record.client }, record.site)
                : undefined,
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
          transition: 'background 120ms cubic-bezier(.2,0,.2,1)',
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
      obsFrom: null,
      locOpen: false,
      ...(tab === 'observations' && { of: NO_FILTERS }),
    })
    // The Review tab with its Version history open.
    const historyTab = () => ({ ...toTab('review'), reviewHistory: s.reviewHistory + 1 })
    // First asking Leave without saving? when something would be lost.
    const leaveCapture = (tab: string) =>
      setState(unsaved.length ? { fLeaveOpen: true, fLeaveTo: tab } : toTab(tab))
    // A checklist item's Differs, recorded in full capture (CP-31 AC3): from
    // the sheet or the Checklist tab, capture opens with the item's categories
    // and the link to it, which the next observation saved takes.
    const differInCapture = (item: ChecklistItem) =>
      setState({
        ...(sc !== 'field' && { screen: 'field', locDismissed: false, obsReturn: null }),
        checklistOpen: false,
        fChecklistItem: { id: item.id, text: item.text },
        fCats: item.COPE_dimension,
        fMode: 'note',
      })
    // The Observations tab's rows, as the filters show them.
    const obsList = shownRows.map(({ o, key }) => {
      const open = s.obsOpen === key
      const sev = o.sev || 'low'
      const status = statusOf(o)
      // A deleted observation changes only by being restored.
      const canChange = canChangeObs
      const reading = o.interpretation
      const proposed = reading?.status === 'interpreted' ? reading : null
      const described = reading?.photos?.status === 'interpreted' ? reading.photos : null
      // It is read only when a risk engineer asks (CP-05, CP-21), through the
      // gateway, or in this demo for a sample observation.
      const readPart = (part?: ReadingPart) =>
        canEdit && !readOnlyHere && !o.deleted
          ? o.id
            ? () => void readSaved(o.id!, part)
            : () => readSample(key, part)
          : null
      const read = readPart()
      // Recordings and photos can be added by whoever may change it, and
      // removed while something else stays captured (CP-08).
      const changing = canChange && !o.deleted
      const removing = (kind: MediaKind, id: string, name: string) =>
        changing && capturedCount(o) > 1
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
        path: pathOf(o),
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
        // offers only Get AI proposal, to whoever may ask; afterwards, each
        // part can be regenerated (CP-08, CP-21).
        proposal: !reading
          ? read
            ? { status: 'unread' as const, read }
            : null
          : {
              ...reading,
              // Each part is read again on its own (CP-21): the categories
              // from everything, the description from the photos. A
              // description is offered once there are photos to describe.
              readCategories: readPart('categories'),
              readDescription: o.media.length ? readPart('description') : null,
              // Copies the photos' description into the note, below what the
              // engineer wrote; offered until the note holds it, so it is
              // never added twice. These are changes, not actions: the page
              // saves them in its queue (ObservationPage.tsx), after any save
              // already on its way, so one never builds on an older note.
              addToNote:
                canChange && !o.deleted && described?.description
                  ? (o.detail ?? '').includes(described.description)
                    ? null
                    : ({
                        note: o.detail
                          ? o.detail + '\n\n' + described.description
                          : described.description!,
                      } satisfies ObservationChange)
                  : null,
              // Each proposed category, with Add while it is not one of the
              // observation's own: added to those it has.
              categories: reading.categories.map((c) => ({
                ...c,
                added: o.cats.includes(c.category),
                add:
                  canChange && !o.deleted && proposed && !o.cats.includes(c.category)
                    ? ({ cats: withCategory(o.cats, c.category) } satisfies ObservationChange)
                    : null,
                // A quote the gateway did not find in the item it cites.
                unverified: c.evidence.some((e) => e.verified === false),
              })),
            },
        icon: categoryIcon(o.cats),
        catLabel: categoryLabel(o.cats),
        // The capture date and time, e.g. "11 Apr 2026 09:22" (CP-08 AC2).
        clock: o.time || '',
        sev,
        sevLabel: sev.charAt(0).toUpperCase() + sev.slice(1),
        // Each recording shows its transcript, as corrected, or where its
        // transcription stands. Only a finished one can be corrected (AC10).
        recordings: (o.recordings ?? []).map((r) => ({
          ...r,
          // Someone else's recording is read, never retried (RV-11): the gateway would refuse.
          retry: readOnlyHere ? null : () => void retryVoice(o.id!, r.id),
          // A recording added in the demo has no transcript to correct.
          canCorrect: canChange && !o.deleted && r.status === 'transcribed' && !!o.id,
          correct: () => setState({ obsDialog: { kind: 'transcript', key, recordingId: r.id } }),
          correctedLabel: r.correction ? 'Corrected by ' + stampLabel(r.correction) : null,
          addedLabel: r.added ? 'Added by ' + stampLabel(r.added) : null,
          remove: removing('recordings', r.id, r.name),
        })),
        // Each handwritten page with its original, and its transcript or where
        // its transcription stands (CP-19 AC8-AC11).
        pages: pageViews(o, key),
        // A saved observation's recordings carry their own text below its note.
        detail: o.recordings ? o.detail : o.detail || o.text,
        hasAudio: !!o.audio,
        audioLabel: 'Audio note (' + (o.audio || '') + ')',
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
        lf: l ? formOf(l) : BLANK_LOCATION,
      })
    return {
      /* access (F-05) */
      routeBlocked,
      canEdit,
      canDraft: can('reports:generate', session),
      // A saved assessment opens its real sections 7-12 on the Generate tab;
      // the demo assessment keeps the sample generation run (GN-01).
      liveReference: openRow?.persisted ? openRow.id : null,
      // Its saved record, read again with the work list, so a corrected
      // client, site or detail shows on the document's cover (RV-12 AC3).
      liveRecord: openRow?.persisted ? (openRow.record ?? null) : null,
      canDraftSections: isMine && canCapture && can('reports:generate', session),
      // Its assigned engineer exports its report, archived or not (EX-01 AC2).
      canExportReport: isMine && can('reports:export', session),
      // Anyone who can open the assessment comments on its report (RV-03 AC7):
      // its assigned engineer, or a knowledge admin; not once it is archived. Not canCapture:
      // that is false on someone else's assessment (RV-11), so admins could no longer comment.
      canComment:
        !!targetRow?.persisted &&
        targetRow.status !== STATUS_LABEL.archived &&
        (isMine || session.user.role === 'knowledge_admin') &&
        can('reports:comment', session),
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
      // The workspace and capture both highlight the assessment they are for;
      // a client's page (CP-18), the Clients list.
      navValue:
        isAssessment || sc === 'field'
          ? RECENT_PREFIX + s.captureTarget.reference
          : sc === 'client'
            ? 'clients'
            : sc,
      // What is on screen: a new screen, workspace tab, client or assessment
      // opens at the top.
      viewKey: [sc, s.tab, s.clientPage, s.captureTarget.reference].join('|'),
      navFooter: userFooter(),
      // From 768px the sidebar always shows, as a rail while collapsed (CP-23).
      showSideNav: !phone,
      navCollapsed: s.navCollapsed ?? tablet,
      phone,
      showTopBar: phone,
      toggleNav: () =>
        phone
          ? setState({
              navOpen: !s.navOpen,
            })
          : setState({
              navCollapsed: !(s.navCollapsed ?? tablet),
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
      // New assessment's two starts (CP-23 screen 2A); the screen opens blank.
      goCreate: (mode: 'form' | 'documents') =>
        setState({ screen: 'create', createStart: { mode } }),
      cancelForm: () => setState({ screen: 'dashboard' }),
      // The Overview's Edit details (RV-10 AC10) and Edit site (CP-18), for
      // the engineer's own assessment on the gateway, with whether its site
      // is theirs to change and how many assessments a change reaches.
      // A record from a gateway before CP-18 has no site rights: then Edit
      // site isn't offered.
      ovEdit:
        isMine && canCapture && targetRow?.record
          ? {
              record: targetRow.record,
              site: targetRow.record.site.change ?? {
                allowed: false,
                reason: null,
                assessments: 0,
              },
            }
          : null,
      // The Overview's Geolocation card (CP-26): the site, this visit's buildings, and
      // whether the engineer may change its pins. A record from a gateway
      // before CP-26 has no pins.
      ovMap: targetRow?.record
        ? {
            site: {
              id: targetRow.record.site.id,
              coordinates: targetRow.record.site.coordinates ?? null,
              pins: targetRow.record.site.pins ?? [],
            },
            buildings: groupLocations(places.locations)
              .filter((g) => g.key.startsWith('building:'))
              .map((g) => g.title),
            canEdit: isMine && canCapture && !targetRow.record.site.removed,
          }
        : null,
      // A site corrected from the Overview: the work list reads it again, and
      // the header takes its name.
      // `toast` options send it to a toaster of its own (the Details panel's, with an Undo).
      siteSaved: async (
        message: string,
        options?: { undo?: { label: string; onClick: () => void }; toasterId?: string },
      ) => {
        const list = await reloadRows()
        const now = list?.find((a) => a.reference === s.captureTarget.reference)
        if (now)
          updateState((previous) => ({
            ...previous,
            captureTarget: { ...previous.captureTarget, site: now.site.name },
          }))
        if (options) sonner.success(message, { action: options.undo, toasterId: options.toasterId })
        else toast(message)
      },
      // The work list reloads only on the dashboard, so reload it here.
      detailsSaved: async (message: string, options?: { toasterId?: string }) => {
        await reloadRows()
        if (options) sonner.success(message, { toasterId: options.toasterId })
        else toast(message)
      },
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
          setState({ ...navigate('dashboard'), archiveBusy: false, fStatus: 'All statuses' })
          // A removed site comes back with it (CP-18).
          const site = targetRow?.record?.site
          toast(
            reference +
              ' restored to your work list' +
              (site?.removed ? ', with its site ' + site.name + '.' : '.'),
          )
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
      openArchive: () => {
        setArchiveRef(null)
        setState({ archiveOpen: true })
      },
      // The work list's row Archive icon: the same confirm, for that row's assessment (CP-23).
      askArchive: (reference: string) => {
        setArchiveRef(reference)
        setState({ archiveOpen: true })
      },
      // A row can be archived by its own engineer while it is not archived already.
      canArchiveRow: (r: AssessmentRow) =>
        !!r.persisted && r.engineerId === session.user.id && r.status !== STATUS_LABEL.archived,
      closeArchive: () => !s.archiveBusy && setState({ archiveOpen: false }),
      confirmArchive: async () => {
        if (s.archiveBusy) return
        // From a work list row it is that row's assessment; from the workspace, the open one.
        const reference = archiveRef ?? s.captureTarget.reference
        const isOpen = reference === s.captureTarget.reference
        setState({ archiveBusy: true })
        try {
          await requestArchive(reference)
          // Back to the work list, which reloads. If it was the open assessment,
          // capture falls back to the demo and its draft is dropped, as it takes
          // no more; another row's archive must not touch the open draft.
          if (isOpen) dropDraftFiles()
          setState({
            ...navigate('dashboard'),
            ...(isOpen
              ? { ...BLANK_DRAFT, fLocationId: null, captureTarget: CAPTURE_ASSESSMENT }
              : {}),
            archiveOpen: false,
            archiveBusy: false,
            recent: s.recent.filter((r) => r.reference !== reference),
          })
          setArchiveRef(null)
          void reloadRows()
          sonner.success(reference + ' archived', {
            description: 'Find it under Status, Archived.',
            action: { label: 'Undo', onClick: () => void undoArchive(reference) },
          })
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
      isInbox: sc === 'inbox',
      isDashboard: sc === 'dashboard',
      isCreate: sc === 'create',
      isField: sc === 'field',
      isUsers: sc === 'users',
      isKnowledge: sc === 'knowledge',
      isUsage: sc === 'usage',
      isChat: sc === 'chat',
      // The engineer's clients (CP-18), from the work list: loading until it
      // loads, and unavailable when the gateway can't be reached.
      isClients: sc === 'clients',
      clientList: {
        clients: myClients,
        onNewAssessment: addSiteTo,
        onChanged: (message: string) => {
          void reloadRows()
          toast(message)
        },
        loading: !serverRows && !listFailed,
        failed: !serverRows && listFailed,
      },
      // A client's page (CP-18) and what it does: open one of the engineer's
      // assessments, start a new visit, and reload the work list after a change.
      isClient: sc === 'client',
      clientPage: {
        ...clientPage,
        menu: clientMenuModel,
        onNewAssessment: clientNewAssessment,
        onClients: () => setState({ screen: 'clients', clientDialog: null, toast: null }),
        startTab: s.clientTab ?? undefined,
        // A visit as the work list shows it: its status, dates and countdown.
        visit: (reference: string) => {
          const r = rows.find((x) => x.id === reference)
          return r
            ? {
                status: r.status,
                date: r.date,
                dueDate: r.reportDueDate ? formatDay(r.reportDueDate) : 'Not set',
                due: r.reportDueDate ?? null,
                overdue: isOverdue(r),
                countdown: dueCountdown(r),
              }
            : null
        },
        // Rename client or Remove client, opened from the header's ⋯ menu.
        dialog: s.clientDialog,
        closeDialog: () => setState({ clientDialog: null }),
        onOpen: (reference: string, site: string) => {
          releaseDraft(reference)
          setState({ ...openAssessment({ reference, site }, s), toast: null })
        },
        onChanged: (message: string) => {
          void reloadRows()
          toast(message)
        },
        notify: (message: string, tone?: string) => toast(message, tone),
      },
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
      // The Overview's Site card: the site, shared by every assessment at it,
      // and its client, whose name opens the client's page (CP-18) for a
      // client on the gateway the engineer may manage.
      ovSiteFacts: (openRow
        ? [
            { label: 'Name', value: openRow.site },
            { label: 'Address', value: openRow.record?.site.address ?? 'Not recorded' },
            {
              label: 'Jurisdiction',
              value:
                JURISDICTIONS.find((j) => j.value === openRow.record?.site.jurisdiction)?.label ??
                openRow.record?.site.jurisdiction ??
                'Not recorded',
            },
            { label: 'Facility type', value: openRow.record?.site.facilityType ?? 'Not recorded' },
            {
              label: 'Client',
              value: openRow.client,
              open:
                openRow.persisted && openRow.record?.clientId && canOpen('client', session)
                  ? () => openClient(openRow.record!.clientId!)
                  : undefined,
              // AS-06: Details' See all, the same page on its Documents tab.
              documents:
                openRow.persisted && openRow.record?.clientId && canOpen('client', session)
                  ? () => openClient(openRow.record!.clientId!, 'documents')
                  : undefined,
            },
          ]
        : [{ label: 'Name', value: s.captureTarget.site }]) as {
        label: string
        value: string
        open?: () => void
        documents?: () => void
      }[],
      // Its Assessment record card: this assessment's own details.
      ovRecordFacts: openRow
        ? [
            { label: 'Report', value: openRow.id },
            { label: 'Assessment type', value: openRow.type },
            { label: 'Status', value: openRow.status },
            { label: 'Site visit', value: openRow.date },
            {
              label: 'Report due',
              value: openRow.reportDueDate ? formatDay(openRow.reportDueDate) : 'Not set',
            },
            { label: 'Engineer', value: openRow.eng },
          ]
        : [{ label: 'Report', value: s.captureTarget.reference }],
      obsList,
      obsReturning: !!s.obsReturn,
      obsLandingRow: landingRow,
      /* by location (CP-16): buildings, levels and locations, each with its
         observations, Add observation, and Edit and Remove */
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
      // After a site walk's Create all (CP-22): its locations and observations.
      reloadAfterWalk: () => {
        captured.reload()
        places.reload()
      },
      // Opens an assessment on its Observations tab, e.g. from the bell (CP-22).
      openObservationsOf: (reference: string) => void openFromOutside(reference, 'observations'),
      // Opens an assessment on its Overview, e.g. from an assigned Inbox row (F-10).
      openOverviewOf: (reference: string) => void openFromOutside(reference),
      // Opens an observation on its own page, or back to the list with null.
      // `step` is the page's arrows, which stay on the same way in; from the list it starts afresh.
      openObs: (key: string, step = false) =>
        setState({ obsOpen: key, ...(!step && { obsFrom: null }) }),
      // Back from an observation's page: to All Photos or All Handwritten Pages if it came from there.
      closeObs: () =>
        setState(s.obsFrom ? { obsOpen: null, tab: s.obsFrom, obsFrom: null } : { obsOpen: null }),
      obsFrom: s.obsFrom ?? null,
      obsCountLabel: obsRows.length
        ? filtersActive(s.of)
          ? 'Showing ' + shownRows.length + ' of ' + plural(obsRows.length, obsNoun)
          : 'Showing 1–' + obsRows.length + ' of ' + plural(obsRows.length, obsNoun)
        : plural(0, obsNoun),
      /* observation filters (CP-06 AC2, CP-08 AC3): any one label returns what carries it */
      obsFilters: s.of,
      obsFiltering: filtersActive(s.of),
      obsNoMatch: filtersActive(s.of) && obsRows.length > 0 && shownRows.length === 0,
      // Nothing captured yet, and no locations to list by: the list offers
      // Add observation instead.
      obsNone: !s.obsShowDeleted && obsRows.length === 0 && !(obsByLocation && obsGroups.length),
      setObsFilter: (key: keyof ObservationFilters, value: string) =>
        setState({ of: { ...s.of, [key]: value } }),
      clearObsFilters: () => setState({ of: NO_FILTERS }),
      obsTypeFilterOptions: [{ value: '', label: 'All types' }, ...OBSERVATION_TYPES],
      obsCatFilterOptions: [{ value: '', label: 'All categories' }, ...CATEGORY_OPTIONS],
      obsSevFilterOptions: [{ value: '', label: 'All severities' }, ...SEVERITY_OPTIONS],
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
              // The handwritten page whose text is corrected, or which is
              // transcribed again (CP-20).
              page: dialogRow.o.pages?.find((p) => p.id === s.obsDialog!.pageId),
              // The recording, photo or page to remove (CP-08, CP-20).
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
      savePageText,
      confirmTranscribeAgain,
      confirmDelete,
      addMedia,
      confirmRemoveMedia,
      /* the observation page, edited in place: tags (CP-06) and note (CP-08) */
      saveObsChanges,
      // Where an observation can be moved, for the one open on its page.
      obsLocOptions: (() => {
        const row = s.obsOpen ? allRows.find((r) => r.key === s.obsOpen) : undefined
        return [
          // A location not on the assessment's list can be kept, not chosen again.
          ...(row?.o.locationId && !places.locations.some((l) => l.id === row.o.locationId)
            ? [{ value: row.o.locationId, label: placeOf(row.o) }]
            : []),
          // In the picker's order: under each building's heading, then by
          // level (CP-16), so each line stays short: "Level 1 › Loading bay".
          ...groupLocations(places.locations).flatMap((g) =>
            g.levels.flatMap((level) =>
              level.locations.map((l) => ({
                value: l.id,
                label: level.title ? level.title + ' › ' + l.name : l.name,
                group: g.title,
              })),
            ),
          ),
        ]
      })(),
      isChecklist: isAssessment && s.tab === 'checklist',
      isGenerate: isAssessment && s.tab === 'generate',
      isReview: isAssessment && s.tab === 'review',
      isExport: isAssessment && s.tab === 'export',
      // Capture is part of the workspace, so it keeps the workspace's header,
      // named from the capture session when one is live. New Assessment has
      // none: its Back button already says where it sits (CP-23).
      eyebrow:
        sc === 'dashboard' || sc === 'clients'
          ? 'Risk engineering'
          : sc === 'create'
            ? ''
            : sc === 'users' || sc === 'knowledge'
              ? 'Administration'
              : sc === 'usage'
                ? 'Reporting'
                : sc === 'chat'
                  ? 'Knowledge'
                  : sc === 'client'
                    ? 'Client'
                    : 'Assessment workspace',
      title:
        sc === 'dashboard'
          ? 'Assessments'
          : sc === 'clients'
            ? 'Clients'
            : sc === 'create'
              ? 'New Assessment'
              : sc === 'field'
                ? captureSite
                : sc === 'users'
                  ? 'User accounts'
                  : sc === 'knowledge'
                    ? 'Knowledge base'
                    : sc === 'usage'
                      ? 'Usage and Costs'
                      : sc === 'chat'
                        ? 'Ask the knowledge base'
                        : sc === 'client'
                          ? 'Client'
                          : s.captureTarget.site,
      meta:
        sc === 'dashboard'
          ? plural(rows.length, 'assessment') + ' · ' + session.user.name
          : sc === 'clients'
            ? plural(myClients.filter((c) => !c.removed).length, 'client') +
              ' · ' +
              session.user.name
            : sc === 'create'
              ? ''
              : sc === 'users'
                ? 'Add your team’s accounts, and keep their details and roles up to date.'
                : sc === 'knowledge'
                  ? 'The standards and past reports used to draft new reports. Correct, withdraw or add them.'
                  : sc === 'usage'
                    ? 'What the AI calls cost, how much they were used, and how fast they ran.'
                    : sc === 'chat'
                      ? 'Answers come from the standards and past reports in the knowledge base.'
                      : sc === 'client'
                        ? ''
                        : // An assessment shows only its name; its details are in its Overview.
                          '',
      // The client page draws its own header with New assessment and ⋯ (CP-23).
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
          // The pre-survey checklist (CP-30): read before the visit, so it
          // comes before Observations.
          value: 'checklist',
          label: 'Checklist',
          icon: 'list-checks',
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
      // The toast's View: the saved observation on its own page (CP-22).
      toastView: s.toastView,
      openToastView: () =>
        setState({
          screen: 'assessment',
          tab: 'observations',
          obsOpen: s.toastView,
          obsFrom: null,
          obsShowDeleted: false,
          of: NO_FILTERS,
          toast: null,
        }),
      // Lets a screen outside this hook confirm an action, e.g. KB-01's saves.
      notify: (message: string, tone?: 'danger') => toast(message, tone),
      openEvidenceSource: () =>
        toast('Source files are not connected in this demo. Excerpts are sample evidence.', 'info'),
      playSampleAudio: () => toast('Audio playback is not connected in this demo.', 'info'),
      // The ⋯ menu's Version history (RV-06): a saved assessment's opens in its
      // Review tab; the sample assessment has none.
      reviewHistory: s.reviewHistory,
      // From capture it leaves the way a tab does, asking first when something
      // would be lost ('history' is that leave's destination, see discardAndLeave).
      showVersionHistory: () =>
        !openRow?.persisted
          ? toast('Version history is not connected in this demo.', 'info')
          : sc === 'field'
            ? setState(unsaved.length ? { fLeaveOpen: true, fLeaveTo: 'history' } : historyTab())
            : setState({ tab: 'review', reviewHistory: s.reviewHistory + 1 }),
      /* annotations */

      /* dashboard */
      q: s.q,
      setQ: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          q: e.target.value,
        }),
      // The filter pills (CP-23): '' is no filter.
      stageFilter: fStatus === 'All statuses' ? '' : fStatus,
      setStageFilter: (value: string) => setState({ fStatus: value || 'All statuses' }),
      // The stages, then Archived (AS-06 AC 2).
      stageOptions: [...Object.values(STAGE_LABEL), STATUS_LABEL.archived],
      // Focus (AS-06 AC 12): the rows the gateway gave a priority (only the engineer's own),
      // in its rank order. Built from the list itself, so it never lags or pops in after it.
      focus: rows
        .flatMap((r) =>
          r.priority
            ? [
                {
                  reference: r.id,
                  site: r.site,
                  client: r.client,
                  reportDueDate: r.reportDueDate ?? null,
                  priority: r.priority,
                },
              ]
            : [],
        )
        .sort((a, b) => a.priority.rank - b.priority.rank),
      visitType: s.fVisitType,
      setVisitType: (value: string) => setState({ fVisitType: value }),
      // The visit types the engineer's assessments have, the standard ones first.
      visitTypeOptions: [...new Set(rows.map((r) => r.type))].sort(
        (a, b) =>
          (SURVEY_TYPES.indexOf(a) + 1 || 99) - (SURVEY_TYPES.indexOf(b) + 1 || 99) ||
          a.localeCompare(b),
      ),
      // Group by client, then site (CP-17 AC9), on unless turned off (CP-23).
      // The archived list groups too (CP-18).
      workByClient: s.workByClient,
      toggleWorkByClient: () => setState({ workByClient: !s.workByClient }),
      workGroups,
      // The Status filter is on Archived: those rows show, and only those.
      showArchived,
      // The footer's late part applies the Report due filter's Late choice (CP-23).
      lateCount: filtered.filter((r) => inProgress(r) && r.overdue).length,
      workSort,
      sortOptions: SORT_CHOICES,
      setWorkSort: (value: string) => setState({ workSort: value }),
      filteredRows: filtered,
      noResults: filtered.length === 0,
      // None at all, archived or not: the list says so, not that filters hid them.
      noAssessments: rows.length === 0,
      // The Due pill (CP-23), which replaced the date boxes above the list.
      dateFilter: s.fDate,
      setDateFilter: (filter: DateFilter | null) => setState({ fDate: filter }),
      listOffline: listFailed && !serverRows,
      /* assigning (RV-11): an admin sees the Engineer column and can reassign a row */
      canAssign: can('assessments:assign', session),
      me: { id: session.user.id, name: session.user.name },
      // A row the gateway answered after a move replaces its entry in the list.
      rowMoved: (moved: Assessment) => {
        rowsRead.current += 1
        setServerRows(
          (list) => list?.map((r) => (r.id === moved.reference ? toRow(moved) : r)) ?? list,
        )
      },
      // Reads the list again, e.g. after a row turned out to be archived, or someone moved one.
      refreshList: () => void reloadRows(),
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
      /* create (CP-23) */
      newAssessment: {
        start: s.createStart,
        // An admin picks each assessment's engineer (RV-11); an engineer's own is assigned for them.
        assign: can('assessments:assign', session)
          ? { id: session.user.id, name: session.user.name }
          : undefined,
        // Back on the list with the new assessments; the screen's own toast names them (CP-23).
        onCreated: (created: Assessment[]) => addCreatedRows(created.map(toRow)),
        // The toast's View opens the first one.
        onView: (a: Assessment) => {
          releaseDraft(a.reference)
          updateState((previous) => ({
            ...previous,
            ...openAssessment({ reference: a.reference, site: a.site.name }, previous),
          }))
        },
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
        setState({
          ...BLANK_DRAFT,
          ...(s.fLeaveTo === 'history' ? historyTab() : toTab(s.fLeaveTo)),
        })
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
      // A page goes to the AI service as photographed: client details in it
      // can't be masked, so the engineer is asked to leave them off (PV-04).
      pagePrivacyHint: liveCapture
        ? 'Leave names, phone numbers and ID numbers off the page: an external AI service reads it.'
        : null,
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
      locationPath: currentLocation,
      locSheetOpen,
      openLocations: () => setState({ locOpen: true }),
      closeLocations: () => setState(pickerClosed),
      // The location bar opens the picker, or closes the dropdown it anchors.
      toggleLocations: () => setState(locSheetOpen ? pickerClosed : { locOpen: true }),
      locQuery: s.locQuery,
      // Every pin, so standing at a block with no location on this visit isn't
      // reported as being near the next one along (CP-26).
      locPins: targetRow?.record?.site.pins ?? [],
      // The block found (CP-26). Matched exactly, not by the search, or
      // "Block 1" would also bring up "Block 10".
      locBlock: s.locBlock,
      // A block with no location on this visit would narrow the list to nothing.
      showBlock: (name: string | null) =>
        setState({
          locBlock: name && pickable.some((l) => sameName(l.building, name)) ? name : null,
        }),
      // A new reading from the picker's tracking. An open Add a location form
      // follows it, unless the engineer has typed in or cleared the field.
      locHere: s.locHere,
      lfOwnPoint: s.lfOwnPoint,
      trackedTo: (point: Coordinates | null) =>
        updateState((previous) => ({
          ...previous,
          locHere: point,
          ...(point &&
            previous.locAdding &&
            !previous.locEdit &&
            !previous.lfOwnPoint && {
              lf: { ...previous.lf, coordinates: formatCoordinates(point) },
              lfErrors: { ...previous.lfErrors, coordinates: undefined },
            }),
        })),
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
                        lf: formOf(l),
                      })
                  : undefined,
              }
            }),
          })),
        }
      }),
      locNoMatch: !!query && locationGroups.length === 0,
      noLocations: pickable.length === 0,
      // Adding to a site walk proposal: the picker only picks, Save adds to the proposal.
      proposalCapture: !!proposalTarget,
      // Choosing one leaves any half-filled form behind.
      chooseLocation: (id: string) =>
        setState({
          fLocationId: id,
          locOpen: false,
          locQuery: '',
          locBlock: null,
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
          lfOwnPoint: false,
          lf: {
            ...BLANK_LOCATION,
            ...(s.locHere && { coordinates: formatCoordinates(s.locHere) }),
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
      setLf: (field: 'building' | 'floor' | 'name') => (value: string) =>
        setState({
          lf: { ...s.lf, [field]: value },
          lfErrors: {},
          lfCheck: null,
          lfKept: { ...s.lfKept, [field]: undefined },
        }),
      // On the latest form: the browser's position can arrive seconds later,
      // and what was typed meanwhile must stay (CP-26).
      setLfCoordinates: (coordinates: string) =>
        updateState((previous) => ({
          ...previous,
          lf: { ...previous.lf, coordinates },
          lfOwnPoint: true,
          lfErrors: { ...previous.lfErrors, coordinates: undefined },
        })),
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
      locRemovePath: places.locations.find((x) => x.id === s.locRemove) ?? null,
      closeLocRemove: () => setState({ locRemove: null }),
      confirmLocRemove: removeLocation,
      submitLocation: () => void submitLocation(),
      fCats: s.fCats,
      // A proposed observation holds one category, so there a pick replaces the last.
      toggleFCat: (cat: string) =>
        setState({
          fCats: proposalTarget
            ? s.fCats.includes(cat)
              ? []
              : [cat]
            : toggleCategory(s.fCats, cat),
        }),
      fSev: s.fSev,
      setFSev: (fSev: string) => setState({ fSev }),
      /* the checklist over capture (CP-31): only with a capture session, as
         its answers are saved as observations */
      canOpenChecklist: !!liveCapture && !proposalTarget,
      checklistOpen: !!liveCapture && s.checklistOpen,
      openChecklist: () => setState({ checklistOpen: true }),
      closeChecklist: () => setState({ checklistOpen: false }),
      currentLocation,
      // Where to answer an item from: closes the checklist on the location picker.
      chooseLocationForChecklist: () => setState({ checklistOpen: false, locOpen: true }),
      // Answering saves or marks for the assessment, so it follows the rule
      // for changing its observations (AC8); the gateway decides.
      canAnswerChecklist: canChangeObs,
      // An answer saved from the checklist joins the list like any capture.
      checklistSaved: (observation: SavedObservation) => captured.add(observation),
      // The same answering from the Checklist tab, where the answer box asks where.
      checklistTabAnswering: canChangeObs
        ? {
            place: { kind: 'tab' as const, locations: places.locations, last: s.fLocationId },
            onSaved: (observation: SavedObservation) => captured.add(observation),
            onFullCapture: (item: ChecklistItem) => differInCapture(item),
          }
        : null,
      // Differs recorded in full capture (AC3), for a recording or handwritten
      // notes: capture opens with the item's categories and the link to it.
      differInCapture,
      fChecklistItem: s.fChecklistItem,
      // Leaves the difference unrecorded and goes back to the checklist.
      backToChecklist: () => setState({ fChecklistItem: null, checklistOpen: true }),
      goToChecklistTab: () => {
        setState({ checklistOpen: false })
        leaveCapture('checklist')
      },
      // An answer's observation, open on the Observations tab, first asking
      // Leave without saving? when leaving capture would lose something.
      showObservation: (id: string) =>
        setState(
          sc === 'field' && unsaved.length
            ? { checklistOpen: false, fLeaveOpen: true, fLeaveTo: 'observations' }
            : { ...toTab('observations'), checklistOpen: false, obsOpen: id },
        ),
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
        if (proposalTarget) {
          void saveToProposal(proposalTarget, currentLocation, note)
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
          pages: s.fPages.map((p) => demoPage('local-page-' + p.id, p.name, p.url, null)),
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
          fToast: null,
          // Listed first, so it is local-0 (see obsReturn above).
          toast: 'Observation saved in this demo only.',
          toastTone: 'success',
          toastView: 'local-0',
        })
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
        : 'Sample data shown without the gateway cannot be exported.',
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
      // Sample data has no saved report to make a file from (EX-01 AC11):
      // the cause is shown, and nothing is produced or simulated.
      exportDialogTitle: 'Sample data cannot be exported',
      exportDialogBody:
        'This assessment is sample data shown without the gateway, so there is no saved report to make a file from. No file was produced. Open a saved assessment from the dashboard to export its report.',
      exportFooter: (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <Button
            variant="secondary"
            onClick={() =>
              setState({
                exportOpen: false,
              })
            }
          >
            {'Close'}
          </Button>
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

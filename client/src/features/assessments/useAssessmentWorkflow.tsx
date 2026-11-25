import { useState, useEffect, useRef } from 'react'
import type * as React from 'react'
import { Icon, IconRegistry, toast as sonner } from '../../design-system'
import {
  archiveAssessment as requestArchive,
  createDraftRecordings,
  discardDraft,
  getObservation,
  restoreAssessment as requestRestore,
  GatewayError,
  listAssessments,
  type Kind,
  retranscribePage,
  retryPageTranscription,
  retrySuggestion,
  retryTranscription,
  saveObservation,
  updateObservation,
  correctTranscript,
  correctPageText,
  deleteObservation,
  restoreObservation,
  addObservationMedia,
  removeMedia,
  savePhotoRegion,
  type PhotoRegion,
  restoreMedia,
  type MediaKind,
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
import {
  NO_EVIDENCE_FILTERS,
  pageStates,
  photoStates,
  recordingStates,
  type EvidenceFilters,
} from './evidenceFilters'
import { NO_SPEECH, searchWords } from './evidenceSearch'
import { guardLeave } from './leaveGuard'
import { observationSaved } from './newObservationWalk'
import {
  audioSeconds,
  choosePhotos,
  clipSeconds,
  microphoneProblem,
  record,
  unsupportedPhotos,
} from './media'
import {
  filtersActive,
  matchedIn,
  matchesFilters,
  matchesPlace,
  NO_FILTERS,
  OBSERVATION_STATUSES,
  OBSERVATION_TYPES,
  placeFilter,
  statusOf,
  typeLabel,
} from './observationFilters'
import { rowStateOf, toCheckCount } from './observationRowState'
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
  CAT_ICON,
  categoryIcon,
  categoryLabel,
  copeDimensionsOf,
  sameCategories,
  toggleCategory,
  UNCATEGORISED,
} from './categories'
import type { PageView } from './components/PageEntry'
import { useCaptureSession } from './useCaptureSession'
import type { Cope, Severity } from '../site-walk/api'
import { siteWalkReview } from '../site-walk/openReview'
import { overviewNav } from './openOverviewLink'
import { reportAssessmentMissing, type AssessmentPlace } from './openAssessment'
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
import { useAssessmentEvents } from './useAssessmentEvents'
import { hasTag, tagFilterChips } from './noteKinds'
import { draftItem, type CaptureRecording } from './captureRecordings'
import { initialState } from './initialState'
import { JURISDICTIONS, SEV, SURVEY_TYPES } from './options'
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
import { onSignal } from '../walkthrough/signals'
export type AssessmentWorkflow = ReturnType<typeof useAssessmentWorkflow>
// A change to an observation made in place on its page (CP-06, CP-08).
export type ObservationChange = {
  cats?: string[]
  sev?: string
  locationId?: string
  note?: string
  // The tags; null clears them (CP-36).
  kinds?: Kind[] | null
  // The sort-only labels; null clears them (CP-36).
  labels?: string[] | null
  // Keeps these not-sure values as they are (CP-24): they become the engineer's.
  confirm?: ('category' | 'severity')[]
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
}
// What a recording, photo or page is called in what the page says (CP-08, CP-20).
const MEDIA_NOUN = { recordings: 'Recording', photos: 'Photo', pages: 'Page' } as const
// How many things an observation holds: its note, recordings, photos and
// pages. One of them can be removed only while another stays (CP-08, CP-20).
const capturedCount = (o: Observation) =>
  (o.detail?.trim() ? 1 : 0) + (o.recordings?.length ?? 0) + o.media.length + (o.pages?.length ?? 0)
const pageNote = (p: ObservationPage) =>
  p.status === 'transcribing'
    ? PAGE_TEXT.transcribing
    : p.status === 'transcribed' && !p.transcript?.trim()
      ? PAGE_TEXT.blank
      : null
// The categories the Observations tab filters by: the shared COPE vocabulary
// (CP-08 AC7), shown as the values they are stored as, or Uncategorised.
const CATEGORY_OPTIONS = [...Object.keys(CAT_ICON), UNCATEGORISED]
// The Assessments list's sort choices (the pill shows the current one); must match initialState.ts.
const SORT_LATEST = 'Survey date, latest first'
const SORT_DUE = 'Report due, earliest first'
const SORT_CLIENT = 'Client name, A to Z'
const SORT_CHOICES = [SORT_LATEST, SORT_DUE, SORT_CLIENT]
const SEVERITY_OPTIONS = ['critical', 'high', 'moderate', 'low'].map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))
// An empty capture form: no note, recordings, photos or pages, and no tags
// chosen. The location stays, as the engineer is still standing in it.
const BLANK_DRAFT = {
  fNote: '',
  fDraft: null,
  fSending: 0,
  fLengths: {},
  fLocRefused: 0,
  fKinds: [],
  fLabels: [],
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
  fVoiceError: null,
  fPhotoError: null,
  fSaveError: null,
  fLeaveOpen: false,
} satisfies Partial<WorkflowState>
// Recorders stopped to be thrown away with the draft they were recording for.
const discarded = new WeakSet<MediaRecorder>()
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
          ? (correction?.text ?? transcript) || NO_SPEECH
          : TRANSCRIPTION_TEXT[status],
      original: correction ? transcript : null,
      correction: correction && { at: correction.at, by: correction.by },
      error,
      // A site walk clip plays only its part of the walk (a media fragment).
      audioUrl: r.clip ? r.url + '#t=' + r.clip.start + ',' + r.clip.end : r.url,
      clip: r.clip ? { start: r.clip.start, end: r.clip.end } : null,
      added: r.added,
    }
  })
  // Each handwritten page (CP-19), with its transcript and uncertain words.
  const pages = (o.pages ?? []).map(toPage)
  const removedPages = o.removedPages ?? []
  // Where its recordings, pages, photo description and suggestion stand, and what is left to
  // check (CP-08 AC2, CP-19 AC4, CP-24): one rule, in observationRowState.ts.
  const { status } = rowStateOf({
    recordings,
    pages,
    suggestion: o.suggestion,
    toCheck: o.toCheck,
    interpretation: o.interpretation,
    cats: o.copeDimensions ?? [],
    sev: o.severity ?? '',
  })
  const photos = o.photos
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
    kinds: o.kinds,
    labels: o.labels,
    time: formatDayYearTime(new Date(o.recordedAt)),
    text,
    locationName: o.location?.name ?? '',
    building: o.location?.building ?? null,
    locationId: o.location?.id,
    floor: o.location?.floor ?? null,
    sev: o.severity ?? '',
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
      region: p.region ?? null,
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
    suggestion: o.suggestion,
    toCheck: o.toCheck,
    interpretation: o.interpretation && {
      photos: o.interpretation.photos && {
        status: o.interpretation.photos.status,
        description: o.interpretation.photos.description,
        hazardType: o.interpretation.photos.hazardType,
        error: o.interpretation.photos.error,
        model: o.interpretation.photos.model,
        outOfDate: o.interpretation.photos.outOfDate,
        photoIds: o.interpretation.photos.photoIds,
      },
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
// shared link) reopens the same assessment, tab and observation.
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
// Returns the assessment, tab and observation the URL names, or nothing. An
// assessment or capture path naming no assessment opens the Assessments list:
// there is nothing to show without one.
function placeFromUrl(): Partial<WorkflowState> {
  const q = new URLSearchParams(window.location.search)
  const reference = q.get('ref')
  if (!reference)
    return [SCREEN_PATHS.assessment, SCREEN_PATHS.field].includes(window.location.pathname)
      ? { screen: 'dashboard' }
      : {}
  // The site name fills in once the work list arrives.
  const target = { reference, site: '' }
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

/**
 * Returns the place the URL names after Back or Forward. The URL knows only an assessment's
 * reference, so when it is still the assessment that is open (Back from a tab a MarshBot link
 * opened, AS-06 round 9) its loaded site name and the Recent list are kept. Without this the page
 * title went blank: the work list that fills the name in is not read again.
 */
export function placeAfterBack(
  previous: Pick<WorkflowState, 'captureTarget' | 'recent'>,
  place: ReturnType<typeof placeFromUrl>,
) {
  return place.captureTarget?.reference === previous.captureTarget.reference
    ? { ...place, captureTarget: previous.captureTarget, recent: previous.recent }
    : place
}
// The evidence views' search and filters, as each view opens (CP-13).
const NO_EVIDENCE_SEARCH = { evidenceQuery: '', evidenceFilters: NO_EVIDENCE_FILTERS }

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
  // The observation that a MarshBot link on the Overview opened, while it is the one open. Its own
  // Back then goes back in history (to the Overview, where the link was) instead of to the
  // Observations tab; one opened from that tab, or another stepped to, keeps the tab's Back.
  const [obsViaOverview, setObsViaOverview] = useState<string | null>(null)
  useEffect(() => {
    if (obsViaOverview && state.obsOpen !== obsViaOverview) setObsViaOverview(null)
  }, [state.obsOpen, obsViaOverview])
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
      // screen only rewrites it, so Back still leaves the screen. A MarshBot link from the
      // Overview is the exception: it adds one, so Back returns to the Overview.
      if (url === here) return void (urlSynced.current = true)
      const fromOverview = overviewNav.push
      overviewNav.push = false
      if (urlSynced.current && (window.location.pathname !== path || fromOverview)) {
        window.history.pushState(null, '', url)
        // Only when the link itself opened an observation: one left open from the Observations
        // tab must keep its own Back.
        if (fromOverview && state.tab === 'observations' && state.obsOpen)
          setObsViaOverview(state.obsOpen)
      } else window.history.replaceState(null, '', url)
    }
    urlSynced.current = true
  }, [state.screen, state.clientPage, place])
  // Back and forward move between screens.
  useEffect(() => {
    const follow = () =>
      updateState((previous) => ({
        ...previous,
        screen: screenForPath(window.location.pathname, session),
        ...placeAfterBack(previous, placeFromUrl()),
        clientPage: clientIdForPath(window.location.pathname),
        navOpen: false,
        // Back from capture is a way of leaving it too.
        fLeaveOpen: false,
      }))
    window.addEventListener('popstate', follow)
    return () => window.removeEventListener('popstate', follow)
  }, [session])
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
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
    // The hidden draft holding New Observation's recordings (CP-24): its id, the sends to it
    // (one at a time, so two quick uploads never make two drafts), and a count that goes up
    // whenever the draft is thrown away, so a send that finishes late can see it was.
    draftId: null as string | null,
    sends: Promise.resolve() as Promise<unknown>,
    epoch: 0,
  }))
  useEffect(() => () => media.recorder?.stream.getTracks().forEach((t) => t.stop()), [media])
  // Throws the draft and its recordings away (CP-24 AC3). Nothing waits on it: if it fails, the
  // gateway's clean-up of stale drafts removes it.
  const discardCaptureDraft = () => {
    const id = media.draftId
    media.draftId = null
    media.epoch++
    if (id) void discardDraft(id).catch(() => {})
  }
  // Closing the page, or the app going away, without saving.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the draft's id is read from `media` when it fires
  useEffect(() => () => discardCaptureDraft(), [])
  // Leaving New Observation by any way but Save (Cancel, Back, another tab or screen) throws the
  // draft away. Not while a save is on its way: that turns the draft into the observation.
  // Runs even with no draft id yet: a first upload still on its way is then told it is late (the
  // epoch moves on), so it discards the draft it makes. Without this, that draft would reappear
  // on return.
  useEffect(() => {
    if (onField || state.fSaving) return
    const held = media.draftId || state.fSending
    discardCaptureDraft()
    if (held) updateState((previous) => ({ ...previous, fDraft: null, fSending: 0, fLengths: {} }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onField, state.fSaving])
  // A transcript finishing is pushed, never polled: read the draft again (AC1).
  useAssessmentEvents(
    onField && state.fDraft ? state.captureTarget.reference : '',
    'observations',
    () => {
      const id = media.draftId
      if (id)
        getObservation(id)
          .then((draft) =>
            updateState((previous) =>
              previous.fDraft?.id === id ? { ...previous, fDraft: draft } : previous,
            ),
          )
          .catch(() => {})
    },
    { firstConnect: true },
  )
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
  // The work list from the gateway (RV-10); null until it loads, and while the
  // gateway cannot be reached (listFailed), when the screens say so with Try again.
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
  // The Calendar (CP-60) is drawn from the list.
  const onCalendar = state.screen === 'calendar' && canOpen('calendar', session)
  const listScreen = onDashboard
    ? 'dashboard'
    : onClientScreen
      ? 'client'
      : onClientsScreen
        ? 'clients'
        : onInbox
          ? 'inbox'
          : onCalendar
            ? 'calendar'
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
      () => setListFailed(false),
      () => {
        if (!controller.signal.aborted) setListFailed(true)
      },
    )
    return () => controller.abort()
  }, [needsRows])
  // An assessment opened from the URL knows only its reference: its site name (header, Recent)
  // comes from the list, whichever of the two arrives last. F-12: a walkthrough opens the practice
  // assessment by URL just after making it, when the list was last read on another screen; filled
  // only as the dashboard's list arrived, its page title stayed blank.
  const openReference = state.captureTarget.reference
  const openSite = state.captureTarget.site
  useEffect(() => {
    const row = serverRows?.find((r) => r.id === openReference)
    if (!row || openSite) return
    const target = { reference: row.id, site: row.site }
    // Checked again on the state it is applied to: another assessment may have opened meanwhile.
    updateState((previous) =>
      previous.captureTarget.reference !== row.id || previous.captureTarget.site
        ? previous
        : {
            ...previous,
            captureTarget: target,
            recent: previous.recent.map((r) => (r.reference === row.id ? target : r)),
          },
    )
  }, [serverRows, openReference, openSite])
  // An assessment opened by URL that the loaded list does not hold is looked for once more (it
  // may be newer than the list, e.g. a practice assessment just made) before the workspace says it
  // isn't on the list. `rechecked` names the reference that second read was for.
  const [rechecked, setRechecked] = useState<string | null>(null)
  const recheckAsked = useRef<string | null>(null)
  const openListed =
    !!serverRows?.some((r) => r.id === openReference) ||
    state.createdRows.some((r) => r.id === openReference)
  useEffect(() => {
    if (!(onWorkspace || onField) || !serverRows || openListed) return
    if (recheckAsked.current === openReference) return
    recheckAsked.current = openReference
    void readRows()
      .catch(() => null)
      .finally(() => setRechecked(openReference))
  }, [onWorkspace, onField, serverRows, openListed, openReference])
  // Reads the work list again after a change elsewhere, e.g. a site corrected
  // from the Overview or a client page (CP-18).
  const reloadRows = () => readRows().catch(() => null)
  // F-12: a practice assessment set up again or reset is a new assessment. Without this read its
  // screens would open view-only, as the list would still hold the old one.
  useEffect(() => onSignal('practice-changed', () => void readRows().catch(() => null)), []) // eslint-disable-line react-hooks/exhaustive-deps
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
  function setState(patch: Partial<WorkflowState>) {
    updateState((previous) => ({
      ...previous,
      ...patch,
    }))
  }
  useEffect(() => {
    const measure = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => {
    // The recording clock; it goes back to 00:00 once capture is left.
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
    return () => clearInterval(recorder)
  }, [])
  // Confirms or reports something through the design system's toast (v2 section 7).
  // `tone` picks the icon: success (tick), info, or anything else (red alert, stays until closed).
  // `view` names an observation the toast offers to open.
  function toast(message: string, tone = 'success', view: string | null = null) {
    const action = view
      ? {
          label: 'View',
          onClick: () =>
            setState({
              screen: 'assessment',
              tab: 'observations',
              obsOpen: view,
              obsFrom: null,
              obsShowDeleted: false,
              of: NO_FILTERS,
            }),
        }
      : undefined
    if (tone === 'success') sonner.success(message, { action })
    else if (tone === 'info') sonner.info(message, { action })
    else sonner.error(message, { action })
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
    discardCaptureDraft()
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
    const sc = s.screen
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
    // The assessment's observations as the gateway holds them. Observations tab rows keep one
    // key whatever the filters: the observation's id.
    const allRows = [...captured.observations, ...captured.deleted].map((o) => ({
      o: toEntry(o),
      key: o.id,
    }))
    // Deleted observations stay out of capture and the default list (CP-08
    // AC13); Show deleted lists only them (AC14).
    const fieldRecent = allRows.filter(({ o }) => !o.deleted).map(({ o }) => o)
    // The assessment's photo collection (CP-04 AC3): every photo of an
    // observation not deleted, newest first, each with the observation it
    // belongs to. The report's photo appendix (EX-01) is to draw on it.
    const photoCollection = allRows
      .filter(({ o }) => !o.deleted)
      .flatMap(({ o, key }) => {
        // The AI's description of the observation's photos (CP-05, CP-21),
        // once written: one for all of them, so each row says which it covers.
        const described = o.interpretation?.photos
        const reading =
          described?.status === 'interpreted' && described.description ? described : null
        const idOf = (m: (typeof o.media)[number]) => m.id ?? m.name
        const covered = (m: (typeof o.media)[number]) =>
          !reading?.photoIds || reading.photoIds.includes(idOf(m))
        return o.media.map((photo, i) => ({
          key: key + '/' + i,
          name: photo.name,
          url: photo.url,
          // For the view's filters (CP-13).
          observation: o,
          states: photoStates(reading && { outOfDate: reading.outOfDate, thisOne: covered(photo) }),
          description: reading && {
            text: reading.description!,
            outOfDate: reading.outOfDate,
            // Whether it describes this photo, and how many others it describes.
            thisOne: covered(photo),
            others: o.media.filter((m) => m !== photo && covered(m)).length,
          },
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
        }))
      })
    const obsRows = allRows.filter(({ o }) => !!o.deleted === s.obsShowDeleted)
    // The tag filter row (CP-36): its chips with counts, over the listed observations. A chosen
    // label nothing carries any more falls back to All, so the list never goes blank without a chip.
    const tagChips = tagFilterChips(obsRows.map((r) => r.o))
    const obsTag = tagChips.some((c) => c.value === s.obsTag) ? s.obsTag : ''
    const shownRows = obsRows
      .filter(({ o }) => matchesFilters(o, s.of))
      .filter(({ o }) => hasTag(o, obsTag))
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
    // Recording needs a capture session on the server, or a site walk proposal, which keeps its
    // clips here until Save adds them to the walk.
    const liveVoice = !!liveCapture
    const canRecord = liveVoice || !!proposalTarget
    // No capture session could start, so nothing can be saved to the assessment: the screen
    // says so with Try again, and Save and recording stay off. Never kept on this device instead.
    const captureFailed = !proposalTarget && capture.state?.status === 'unavailable'
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
    // Adds a recording to the hidden draft (CP-24 AC1): the first creates the draft, later ones
    // join it, and the gateway starts transcribing each at once. If it fails nothing is kept, and
    // the voice panel says why.
    const addToDraft = (audio: Blob, name: string, length: string | null) => {
      const reference = s.captureTarget.reference
      const epoch = media.epoch
      updateState((previous) => ({
        ...previous,
        fSending: previous.fSending + 1,
        fVoiceError: null,
        // A recorded clip knows its length; an uploaded file is read for it.
        fLengths: length
          ? { ...previous.fLengths, [name]: clipSeconds(length) }
          : previous.fLengths,
      }))
      if (!length)
        void audioSeconds(audio).then((seconds) =>
          updateState((previous) => ({
            ...previous,
            fLengths: { ...previous.fLengths, [name]: seconds },
          })),
        )
      media.sends = media.sends.then(async () => {
        // Left in the meantime: the draft is gone, so this one is not wanted.
        if (epoch !== media.epoch) return
        try {
          const draft = await createDraftRecordings(
            reference,
            [{ name, audio }],
            media.draftId ?? undefined,
          )
          if (epoch !== media.epoch) return void discardDraft(draft.id).catch(() => {})
          media.draftId = draft.id
          updateState((previous) => ({
            ...previous,
            fDraft: draft,
            fSending: previous.fSending - 1,
          }))
        } catch (error: unknown) {
          if (epoch !== media.epoch) return
          updateState((previous) => ({
            ...previous,
            fSending: previous.fSending - 1,
            fVoiceError: {
              title: 'Recording not added',
              message:
                (error instanceof GatewayError && error.status !== null
                  ? error.message
                  : 'Can’t reach the server.') + ' Record or upload it again.',
            },
          }))
        }
      })
    }
    // Starts a failed draft recording's transcription again (the gateway pushes the new state).
    const retryDraftRecording = async (recordingId: string) => {
      if (!media.draftId) return
      try {
        await retryTranscription(media.draftId, recordingId)
        const draft = await getObservation(media.draftId)
        updateState((previous) => ({ ...previous, fDraft: draft }))
      } catch (error: unknown) {
        toast(tryAgain(refusal(error)), 'warning')
      }
    }
    // Deletes a recording from the draft for good (the gateway does not keep a draft's).
    const removeDraftRecording = async (recordingId: string) => {
      if (!media.draftId) return
      try {
        const draft = await removeMedia(media.draftId, 'recordings', recordingId)
        updateState((previous) => ({ ...previous, fDraft: draft }))
      } catch (error: unknown) {
        toast(tryAgain(refusal(error)), 'warning')
      }
    }
    // A recording is named by its number; an uploaded file keeps its own name.
    const addClip = (audio: Blob, name: string | null, length: string | null) => {
      const id = ++media.clips
      // Only the assessment's own capture has a draft; a site walk proposal keeps its clips here.
      if (liveCapture && !proposalTarget)
        return addToDraft(audio, name ?? 'Recording ' + id, length)
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
          ...(s.fKinds.length > 0 && { kinds: s.fKinds }),
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
                : 'Can’t reach the server.') +
              ' Everything is still listed, so press Save observation to try again.',
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
            severity: severity || null,
            locationId: location.id,
            // The hidden draft becomes this observation; its recordings are not sent again.
            ...(media.draftId && { draftId: media.draftId }),
            ...(s.fKinds.length > 0 && { kinds: s.fKinds }),
            ...(s.fLabels.length > 0 && { labels: s.fLabels }),
            ...(item && { checklistItem: { itemId: item.id, result: 'differs' as const } }),
          },
          clips.map((c) => ({ name: c.name, audio: c.audio })),
          photos.map((p) => ({ name: p.name, image: p.image, region: p.region })),
          pages.map((p) => ({ name: p.name, image: p.image })),
        )
      } catch (error: unknown) {
        // The gateway no longer has the draft (the form stayed open past its clean-up). Forget it,
        // so the next Save goes without it: without this every Save re-sends the dead id and the
        // note and photos could never be saved from this form.
        if (
          media.draftId &&
          error instanceof GatewayError &&
          error.status === 404 &&
          /draft/i.test(error.message)
        ) {
          media.draftId = null
          setState({ fSaving: false, fSaveError: null, fDraft: null, fLengths: {} })
          return toast('Recordings expired. Record them again, then save.', 'warning')
        }
        const problems = error instanceof GatewayError ? Object.values(error.fields) : []
        const cause = problems.length
          ? problems.join(' ')
          : error instanceof GatewayError && error.status !== null
            ? error.message
            : 'Can’t reach the server.'
        setState({
          fSaving: false,
          fSaveError: {
            title: 'Observation not saved',
            message: cause + ' Everything is still listed, so press Save observation to try again.',
          },
        })
        return
      }
      captured.add(observation)
      observationSaved(reference) // F-12
      // The draft is the observation now: nothing is left to throw away if the screen is left.
      media.draftId = null
      media.epoch++
      // Re-reading the list keeps it refreshing until the transcriptions finish.
      if (clips.length || pages.length || observation.recordings.length) captured.reload()
      // The gateway now serves them; the previews in this browser are done.
      for (const file of [...clips, ...photos, ...pages]) URL.revokeObjectURL(file.url)
      // Keep anything added or changed while the observation was saving. The
      // tags start again empty, so the next observation's are chosen for it.
      // The engineer stays on the form; the Observations tab is to mark this one New.
      updateState((previous) => ({
        ...previous,
        obsReturn: {
          locationId: location.id,
          ids: [...(previous.obsReturn?.ids ?? []), observation.id],
        },
        obsFolded: { ...previous.obsFolded, [groupKey(location)]: false },
        fSaving: false,
        fNote: previous.fNote === note ? '' : previous.fNote,
        fKinds: previous.fNote === note ? [] : previous.fKinds,
        fLabels: previous.fNote === note ? [] : previous.fLabels,
        fClips: previous.fClips.filter((c) => !clips.includes(c)),
        fPhotos: previous.fPhotos.filter((p) => !photos.includes(p)),
        fPages: previous.fPages.filter((p) => !pages.includes(p)),
        fDraft: null,
        fLengths: {},
        fLocRefused: 0,
        fCats: sameCategories(previous.fCats, cats) ? [] : previous.fCats,
        fSev: previous.fSev === severity ? '' : previous.fSev,
        fChecklistItem: previous.fChecklistItem === item ? null : previous.fChecklistItem,
      }))
      // A toast with View, so the engineer stays on the form for the next one.
      toast(
        'Observation saved' + (item ? ', and the checklist item answered as Differs' : ''),
        'success',
        observation.id,
      )
    }
    // Why the gateway refused a change to an observation, to show the engineer.
    function refusal(error: unknown) {
      const problems = error instanceof GatewayError ? Object.values(error.fields) : []
      return problems.length
        ? problems.join(' ')
        : error instanceof GatewayError && error.status !== null
          ? error.message
          : 'Can’t reach the server.'
    }
    // Saves a change made in place on the observation page: its tags (CP-06)
    // or its note (CP-08 AC8) on the gateway, sending only what changed. The note
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
      // A location no longer listed is left as it is.
      const location = change.locationId
        ? places.locations.find((l) => l.id === change.locationId)
        : undefined
      if (!o.id) return
      // A tag or note the change names is always sent: `o` can be older than a queued save,
      // so comparing with it could drop an undo as "no change".
      const changes = {
        ...(change.cats && { copeDimensions: copeDimensionsOf(cats) }),
        ...(change.sev && { severity: sev }),
        ...(location && { locationId: location.id }),
        ...(change.note !== undefined && { note: note.trim() ? note : null }),
        ...(change.kinds !== undefined && { kinds: change.kinds }),
        ...(change.labels !== undefined && { labels: change.labels }),
        ...(change.confirm && { confirm: change.confirm }),
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
    // what the model wrote beside it, and drafting uses the correction.
    async function savePageText(text: string) {
      const page = dialogRow?.o.pages?.find((p) => p.id === s.obsDialog?.pageId)
      if (!dialogRow?.o.id || !page) return
      if (text === (page.transcript ?? '')) return setState({ obsDialog: null })
      const { o } = dialogRow
      let saved
      try {
        saved = await correctPageText(o.id!, page.id, text)
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
      const o = dialogRow?.o
      if (!o?.id) return
      let saved
      try {
        saved = await deleteObservation(o.id)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      setState({ obsDialog: null, obsOpen: null })
      toast('Observation deleted. Restore it from Deleted Observations.')
    }
    // Restores a deleted observation to the list and drafting (AC14).
    async function restoreRow(o: Observation) {
      if (!o.id) return
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
    // media dialog (CP-08, CP-20) through the gateway, which stores and
    // transcribes them. Throws the reason a save failed, so the dialog keeps
    // the list for another try.
    async function addMedia(clips: VoiceClip[], photos: PhotoFile[], pages: PhotoFile[] = []) {
      const o = dialogRow?.o
      if (!o?.id) return
      const what = [
        clips.length ? plural(clips.length, 'recording') : '',
        photos.length ? plural(photos.length, 'photo') : '',
        pages.length ? plural(pages.length, 'page') : '',
      ]
        .filter(Boolean)
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1')
      let saved
      try {
        saved = await addObservationMedia(
          o.id,
          clips.map((c) => ({ name: c.name, audio: c.audio })),
          photos.map((p) => ({ name: p.name, image: p.image, region: p.region })),
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
    // Removes the recording, photo or page in the Remove dialog (CP-08,
    // CP-20), a soft removal: the gateway keeps it to restore, and drafting
    // stops using it.
    async function confirmRemoveMedia() {
      const item = s.obsDialog?.media
      const o = dialogRow?.o
      if (!o?.id || !item) return
      const noun = MEDIA_NOUN[item.kind]
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
    // Marks the area of a saved photo that matters, or clears the mark (CP-10).
    // The photo itself is never changed. Throws with the reason, for the photo
    // popup to show.
    async function markPhoto(id: string, photoId: string, region: PhotoRegion | null) {
      let saved
      try {
        saved = await savePhotoRegion(id, photoId, region)
      } catch (error: unknown) {
        throw new Error(refusal(error), { cause: error })
      }
      captured.replace(saved)
      toast(region ? 'Area marked.' : 'Mark cleared.')
    }
    // Restores a removed recording, photo or page to the observation (CP-08, CP-20).
    async function restoreItem(
      o: Observation,
      item: { kind: MediaKind; id: string; name: string },
    ) {
      const noun = MEDIA_NOUN[item.kind]
      if (!o.id) return
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
      // Every observation saved there follows it: the gateway's are listed again.
      if (places.live) captured.reload()
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
    // Tries a failed suggestion, or a failed photo description, once more (CP-24); the gateway
    // queues it, and the page is pushed the new state.
    async function retrySuggestionOf(id: string) {
      try {
        captured.replace(await retrySuggestion(id))
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
    // A place (F-11's activity rows) opens a tab, and an observation on it.
    async function openFromOutside(reference: string, place?: AssessmentPlace) {
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
        ...(place && { tab: place.tab, obsOpen: place.obs ?? null }),
      }))
    }

    /* dashboard rows: the gateway's, none until it answers */
    // The gateway scopes persisted rows to the signed-in engineer.
    const serverIds = new Set(serverRows?.map((r) => r.id))
    const visibleCreated = s.createdRows.filter(
      (r) =>
        !r.persisted || session.user.role === 'knowledge_admin' || r.engineerId === session.user.id,
    )
    const rows = [...visibleCreated.filter((r) => !serverIds.has(r.id)), ...(serverRows ?? [])]
    // F-12: the owner's practice assessment is pinned above the list by Dashboard. Every
    // count, filter, total and client built from rows below uses `counted`, which leaves it out.
    const practice = rows.find((r) => r.record?.practice)
    const counted = rows.filter((r) => !r.record?.practice)
    // The open assessment's row on the work list. Its workspace shows only once it is there.
    const openRow = rows.find((r) => r.id === s.captureTarget.reference)
    // What the server holds, as the Overview and MarshBot count it.
    const savedCount = captured.observations.length
    // Where an assessment opened by URL stands while it is not (yet) on the work list: the list
    // is loading, could not be read, or was read again and still does not hold it.
    const workspaceGate: 'loading' | 'failed' | 'missing' | null =
      sc !== 'assessment' && sc !== 'field'
        ? null
        : openRow
          ? null
          : listFailed && !serverRows
            ? 'failed'
            : !serverRows || rechecked !== s.captureTarget.reference
              ? 'loading'
              : 'missing'

    /* nav */
    // The route guard (F-05): screens the role cannot open are left out of
    // the navigation, and opening one by URL shows why it is blocked.
    const canEdit = can('assessments:edit', session)
    const tabBlocked = isAssessment && !canOpenTab(s.tab, session)
    const routeBlocked = !canOpen(sc, session) || tabBlocked
    // The saved assessment being worked on. Capture is offered only for an
    // assessment on the work list, which the gateway limits to the engineer's
    // own. An archived one takes no captures.
    const targetRow = rows.find((r) => r.id === s.captureTarget.reference)
    const isMine = !!targetRow?.persisted && targetRow.engineerId === session.user.id
    // An admin's list holds everyone's assessments (RV-11), and they change only their own:
    // someone else's saved assessment is read-only here, as the gateway makes it.
    const readOnlyHere = !isMine
    const canCapture = !!targetRow && targetRow.status !== STATUS_LABEL.archived && !readOnlyHere
    // Changing an observation takes the assessment's assigned engineer, and
    // not once it is archived (CP-08 AC17). The gateway decides; the browser
    // hides the actions once the work list shows they'd be refused.
    const canChangeObs = canEdit && isMine && canCapture
    // An observation's handwritten pages as shown (CP-19): where each stands
    // when there is no text, Retry after a failure (only for the assigned
    // engineer, as a recording's), and Transcribe again once one is finished (only
    // for whoever may change the observation, as it replaces evidence; CP-20).
    // Whoever may change it can also correct a finished page's text, and
    // remove a page while something else stays (CP-20).
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
          changing && !!o.id && p.status === 'transcribed'
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
          // For the view's filters (CP-13).
          observation: o,
          states: pageStates(page),
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
    // The assessment's recordings (CP-12), gathered as the photo collection
    // gathers its photos: every recording kept on an observation not deleted,
    // newest first. A failed one can be retried here, except in someone else's
    // assessment (RV-11).
    const recordingCollection = allRows
      .filter(({ o }) => !o.deleted)
      .flatMap(({ o, key }) =>
        (o.recordings ?? []).map((r) => ({
          key: key + '/' + r.id,
          name: r.name,
          // For the view's filters (CP-13).
          observation: o,
          states: recordingStates(r.status),
          audioUrl: r.audioUrl,
          clip: r.clip ?? null,
          status: r.status,
          // Its transcript as corrected, once there is one.
          transcript: r.status === 'transcribed' ? r.text : null,
          retry:
            r.status === 'failed' && !readOnlyHere && o.id
              ? () => void retryVoice(o.id!, r.id)
              : null,
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
              obsFrom: 'recordings',
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
          // The same assessments by date (CP-60).
          { value: 'calendar', label: 'Calendar', icon: 'calendar' },
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
          { value: 'settings', label: 'Settings', icon: 'settings' },
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
    const decorate = (r: AssessmentRow) => ({
      ...r,
      overdue: isOverdue(r),
      sevIcon: SEV[r.sev].icon,
      sevColor: SEV[r.sev].color,
      dueDate: r.reportDueDate ? formatDay(r.reportDueDate) : 'Not set',
      countdown: dueCountdown(r),
    })
    const filtered = counted
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
      .map(decorate)
    // The work list by client, then site, in name order, each site's visits in
    // the order chosen (CP-17 AC9), grouped by the gateway's ids (by name for a
    // row without them). A search opens every client.
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
    // Opened afresh, it starts on its first tab (or the one a MarshBot link names, AS-06):
    // only Back returns to another.
    const openClient = (id: string, tab: WorkflowState['clientTab'] = null) =>
      setState({
        screen: 'client',
        clientPage: id,
        clientDialog: null,
        clientTab: tab,
        clientReturn: null,
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
      for (const r of counted) {
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
      // Only a client on the gateway has a page.
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
    // What the capture draft holds, shown on the mode switcher: the Voice tab's rows are the
    // draft's recordings, or, for a site walk proposal, the clips held here.
    const noteWritten = !!s.fNote.trim()
    const captureRows: CaptureRecording[] = [
      ...(s.fDraft?.recordings ?? []).map((r) => ({
        key: r.id,
        item: draftItem(r, s.fLengths),
        onRetry: () => void retryDraftRecording(r.id),
        onRemove: () => void removeDraftRecording(r.id),
      })),
      ...s.fClips.map((c) => ({
        key: 'clip-' + c.id,
        item: {
          durationSec: clipSeconds(c.length),
          status: 'device' as const,
          transcript: null,
          audioUrl: null,
        },
        onRetry: () => {},
        onRemove: () => dropClip(c),
      })),
    ]
    // A recording still being sent counts too: leaving would lose it.
    const voiceCount = captureRows.length + s.fSending
    // What Done would discard, a recording still running included: "a note,
    // 2 recordings, 1 photo and 1 page".
    const recordings = voiceCount + (s.fRec ? 1 : 0)
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
    // The Observations tab's search, as words to find and mark (CP-13).
    const obsSearchWords = searchWords(s.of.q ?? '')
    const obsList = shownRows.map(({ o, key }) => {
      const open = s.obsOpen === key
      // '' while it has no severity yet (CP-24).
      const sev = o.sev
      const status = statusOf(o)
      // The row's tint and reason line (CP-24), from the same rule as its status.
      const { tint, reason } = rowStateOf(o)
      // A deleted observation changes only by being restored.
      const canChange = canChangeObs
      const described =
        o.interpretation?.photos?.status === 'interpreted' ? o.interpretation.photos : null
      // Recordings and photos can be added by whoever may change it, and
      // removed while something else stays captured (CP-08).
      const changing = canChange && !o.deleted
      const removing = (kind: MediaKind, id: string, name: string) =>
        changing && capturedCount(o) > 1
          ? () => setState({ obsDialog: { kind: 'removeMedia', key, media: { kind, id, name } } })
          : null
      // Saved on the visit to capture just left (CP-16).
      const isNew = !!s.obsReturn?.ids.includes(key)
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
        // Where a search found its words, beyond the row's own text (CP-13).
        matchedIn: matchedIn(o, obsSearchWords),
        status,
        statusTone:
          status === 'Transcribing' || status === 'Reading'
            ? 'info'
            : status.endsWith('failed')
              ? 'high'
              : null,
        canChange: canChange && !o.deleted,
        canRestore: canChange && !!o.deleted,
        editedLabel: o.edited ? 'Edited by ' + stampLabel(o.edited) : null,
        deletedLabel: o.deleted ? 'Deleted by ' + stampLabel(o.deleted) : null,
        deleteObs: () => setState({ obsDialog: { kind: 'delete', key } }),
        restoreObs: () => void restoreRow(o),
        addMedia: changing ? () => setState({ obsDialog: { kind: 'addMedia', key } }) : null,
        // Its photos, each opening the original, with who added any later.
        media: o.media.map((m) => ({
          ...m,
          addedLabel: m.added ? m.name + ' added by ' + stampLabel(m.added) : null,
          remove: removing('photos', m.id ?? m.name, m.name),
          // Only a saved photo can be marked (CP-10).
          mark:
            changing && o.id && m.id
              ? (region: PhotoRegion | null) => markPhoto(o.id!, m.id!, region)
              : null,
        })),
        removedMedia: (o.removedMedia ?? []).map((m) => ({
          ...m,
          removedLabel: 'Removed by ' + stampLabel(m.removed),
          restore: changing ? () => void restoreItem(o, m) : null,
        })),
        // The photo description (CP-05, CP-24): written without being asked, with Copy into
        // note as its one action. Copying is a change, not an action: the page saves it in its
        // queue (ObservationPage.tsx), after any save already on its way, so one never builds
        // on an older note. Null while no photo has been described.
        photoDescription: o.interpretation?.photos
          ? {
              status: o.interpretation.photos.status,
              description: o.interpretation.photos.description,
              error: o.interpretation.photos.error,
              // Offered until the note holds it, so it is never added twice.
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
            }
          : null,
        // The row's tint ('unsure' amber, 'failed' red, 'reading' blue) and reason line (CP-24).
        tint,
        reason,
        // Try again after a failed suggestion; null for anyone who may not change it (CP-24).
        retrySuggestion:
          canChange && !o.deleted && !!o.id && o.suggestion?.status === 'failed'
            ? () => void retrySuggestionOf(o.id!)
            : null,
        // Try again after a failed photo description: the same gateway retry. Null while the
        // suggestion itself failed, so there is one retry control per problem (the Details one).
        retryDescription:
          canChange &&
          !o.deleted &&
          !!o.id &&
          o.suggestion?.status !== 'failed' &&
          o.interpretation?.photos?.status === 'failed'
            ? () => void retrySuggestionOf(o.id!)
            : null,
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
    // building; else the details it was saved with.
    const placeKey = (o: Pick<ObsItem, 'locationId' | 'locationName' | 'floor' | 'building'>) =>
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
            locations: level.locations.filter(
              (l) => !(filtersActive(s.of) || obsTag) || l.items.length,
            ),
          }))
          .filter((level) => level.locations.length),
      }))
      .filter((g) => g.levels.length)
    // The building stack (CP-61) draws every location whatever the filters, so
    // a building keeps its shape: those listed, then any an observation that
    // is not deleted was saved at, shown by the filters or not.
    const stackPlaces: SiteLocation[] = [...places.locations]
    for (const { o } of obsRows)
      if (o.locationName && !stackPlaces.some((l) => l.id === placeKey(o)))
        stackPlaces.push({
          id: placeKey(o),
          building: o.building ?? null,
          floor: o.floor ?? null,
          name: o.locationName,
        })
    // Capture opens at a listed location, with no need to choose where, and
    // returns there.
    const addObservationAt = (id: string) =>
      listed(id) && canEdit && canCapture
        ? () =>
            setState({
              screen: 'field',
              fLocationId: id,
              locOpen: false,
              locDismissed: false,
              obsReturn: { locationId: id, ids: [] },
            })
        : undefined
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
      // The open assessment's reference once it is on the work list; every workspace tab reads
      // it. Null while the workspace shows its loading, failed or missing state instead.
      liveReference: openRow?.persisted ? openRow.id : null,
      workspaceGate,
      // Back to the Assessments list from the missing state.
      leaveMissing: () => setState({ screen: 'dashboard' }),
      // Its saved record, read again with the work list, so a corrected
      // client, site or detail shows on the document's cover (RV-12 AC3).
      liveRecord: openRow?.persisted ? (openRow.record ?? null) : null,
      // Back to the client page this assessment was opened from (CP-29), on the
      // tab it was opened from, or to the calendar (CP-60). None when it was
      // opened from anywhere else.
      backTo:
        isAssessment &&
        s.clientReturn?.reference === s.captureTarget.reference &&
        canOpen('client', session)
          ? {
              label: 'Back to ' + (openRow?.record?.client || 'client'),
              onClick: () =>
                setState({
                  screen: 'client',
                  clientPage: s.clientReturn!.clientId,
                  clientDialog: null,
                }),
            }
          : isAssessment &&
              s.calendarReturn === s.captureTarget.reference &&
              canOpen('calendar', session)
            ? {
                label: 'Back to calendar',
                onClick: () => setState({ screen: 'calendar' }),
              }
            : null,
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
      // Anyone who can open the assessment asks about it (AS-01 AC7): its assigned
      // engineer or a knowledge admin, archived or not, since asking changes nothing.
      canAsk:
        !!targetRow?.persisted &&
        (isMine || session.user.role === 'knowledge_admin') &&
        can('reports:ask', session),
      roleName: roleLabel(session.user.role),
      userId: session.user.id,
      isAdmin: session.user.role === 'knowledge_admin',
      // Leaves a blocked screen for the role's home, or a blocked tab for the
      // workspace overview.
      leaveBlocked: () =>
        setState(tabBlocked ? { tab: 'overview' } : { screen: homeScreen(session) }),
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
        })
      },
      // New assessment's two starts (CP-23 screen 2A); the screen opens blank.
      goCreate: (mode: 'form' | 'documents') =>
        setState({ screen: 'create', createStart: { mode } }),
      // Cancel returns to the Assessments list, or the calendar it was started from (CP-60).
      cancelForm: () => setState({ screen: s.createStart.returnTo ?? 'dashboard' }),
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
      // A practice assessment stays open (F-12), so its Archive is not offered.
      // F-12: the open assessment is archived, so no walkthrough is offered on it.
      archivedOpen: !!targetRow && targetRow.status === STATUS_LABEL.archived,
      canArchive: isMine && canCapture && !targetRow?.record?.practice,
      // The practice assessment shows Archive greyed out, with this reason, so the header's 3 buttons are all there.
      archiveBlocked:
        isMine && canCapture && targetRow?.record?.practice
          ? {
              title: 'Practice assessment',
              text: "You can't archive the practice assessment. You can remove it in Settings → Walkthroughs.",
            }
          : undefined,
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
        !!r.persisted &&
        r.engineerId === session.user.id &&
        r.status !== STATUS_LABEL.archived &&
        !r.record?.practice,
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
          // nothing is open any more and its draft is dropped, as it takes no
          // more; another row's archive must not touch the open draft.
          if (isOpen) dropDraftFiles()
          setState({
            ...navigate('dashboard'),
            ...(isOpen
              ? { ...BLANK_DRAFT, fLocationId: null, captureTarget: { reference: '', site: '' } }
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
      isSettings: sc === 'settings',
      isChat: sc === 'chat',
      // The engineer's clients (CP-18), from the work list: loading until it
      // loads, and unavailable when the gateway can't be reached.
      // The Calendar (CP-60): the work list's saved assessments by date. It
      // opens one, starts a new one (on a day, when one was picked) and reads
      // the list again after new dates are saved.
      isCalendar: sc === 'calendar',
      calendar: {
        assessments: counted.flatMap((r) => (r.persisted && r.record ? [r.record] : [])),
        loading: !serverRows && !listFailed,
        failed: !serverRows && listFailed,
        me: { id: session.user.id, name: session.user.name },
        team: session.user.role === 'knowledge_admin',
        onOpen: (reference: string, site: string) => {
          releaseDraft(reference)
          setState({
            ...openAssessment({ reference, site }, s),
            calendarReturn: reference,
            clientReturn: null,
          })
        },
        onStart: (mode: 'form' | 'documents', siteVisitDate?: string) =>
          setState({
            screen: 'create',
            createStart: { mode, returnTo: 'calendar', ...(siteVisitDate && { siteVisitDate }) },
          }),
        onChanged: () => void reloadRows(),
      },
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
        onClients: () => setState({ screen: 'clients', clientDialog: null }),
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
        // `tab` is the client page's tab it was opened from, kept for its Back (CP-29).
        onOpen: (reference: string, site: string, tab = 'open') => {
          releaseDraft(reference)
          setState({
            ...openAssessment({ reference, site }, s),
            clientReturn: s.clientPage ? { clientId: s.clientPage, tab, reference } : null,
            calendarReturn: null,
          })
        },
        // The tab to open on: the one an assessment was opened from, when the
        // engineer comes back from it (the Back button or the browser's).
        returnTab: s.clientReturn?.clientId === s.clientPage ? s.clientReturn.tab : null,
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
      // Every recording (CP-12), a view of the Observations tab like the two above.
      isRecordings: isAssessment && s.tab === 'recordings',
      // Capture is part of the Observations tab, which stays highlighted.
      tabValue:
        sc === 'field' || s.tab === 'photos' || s.tab === 'scans' || s.tab === 'recordings'
          ? 'observations'
          : s.tab,
      // Each opens with its search and filters empty (CP-13).
      goPhotos: () => setState({ tab: 'photos', ...NO_EVIDENCE_SEARCH }),
      goScans: () => setState({ tab: 'scans', ...NO_EVIDENCE_SEARCH }),
      goRecordings: () => setState({ tab: 'recordings', ...NO_EVIDENCE_SEARCH }),
      evidenceQuery: s.evidenceQuery ?? '',
      setEvidenceQuery: (query: string) => setState({ evidenceQuery: query }),
      evidenceFilters: s.evidenceFilters ?? NO_EVIDENCE_FILTERS,
      setEvidenceFilter: (key: keyof EvidenceFilters, value: string) =>
        setState({
          evidenceFilters: { ...(s.evidenceFilters ?? NO_EVIDENCE_FILTERS), [key]: value },
        }),
      // Clear all: the filters and the search.
      clearEvidenceFilters: () => setState(NO_EVIDENCE_SEARCH),
      goObservations: () => setState({ tab: 'observations' }),
      photoCollection,
      scanCollection,
      recordingCollection,
      goGenerate: () =>
        setState({
          tab: 'generate',
        }),
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
                addObservation: addObservationAt(l.id),
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
      /* the building stack (CP-61): the list, or every location as a cell of its
         building's level, with the observations the filters show there and
         how many it holds in all */
      obsView: s.obsView,
      setObsView: (view: 'list' | 'stack') => setState({ obsView: view }),
      obsStack: stackPlaces.map((l) => ({
        ...l,
        label: locationLabel(l),
        items: obsList.filter((o) => placeKey(o) === l.id),
        total: obsRows.filter(({ o }) => placeKey(o) === l.id).length,
        addObservation: addObservationAt(l.id),
        landing: s.obsReturn?.locationId === l.id,
      })),
      // Observations the filters show that have no location, so no cell.
      obsUnplacedCount: obsList.filter((o) => !o.locationName).length,
      // Adds a location without capturing, e.g. before the visit (CP-16).
      obsAddLocation: canEdit && canCapture ? () => openLocationForm() : undefined,
      obsLocFormOpen: s.obsLocForm,
      // After a site walk's Create all (CP-22): its locations and observations.
      reloadAfterWalk: () => {
        captured.reload()
        places.reload()
      },
      // Opens an assessment on its Observations tab, e.g. from the bell (CP-22).
      openObservationsOf: (reference: string) =>
        void openFromOutside(reference, { tab: 'observations' }),
      openPlaceOf: (reference: string, place: AssessmentPlace) =>
        void openFromOutside(reference, place),
      // Opens an assessment on its Overview, e.g. from an assigned Inbox row (F-10).
      openOverviewOf: (reference: string) => void openFromOutside(reference),
      // Opens an observation on its own page, or back to the list with null.
      // `step` is the page's arrows, which stay on the same way in; from the list it starts afresh.
      openObs: (key: string, step = false) =>
        setState({ obsOpen: key, ...(!step && { obsFrom: null }) }),
      // Back from an observation's page: to All Photos, All Handwritten Pages
      // or All Recordings (CP-12) if it came from there.
      closeObs: () =>
        obsViaOverview && s.obsOpen === obsViaOverview
          ? // Opened from an Overview link: back to the Overview, as the browser's Back does.
            window.history.back()
          : setState(
              s.obsFrom ? { obsOpen: null, tab: s.obsFrom, obsFrom: null } : { obsOpen: null },
            ),
      obsViaOverview,
      obsFrom: s.obsFrom ?? null,
      obsCountLabel: obsRows.length
        ? filtersActive(s.of) || obsTag
          ? 'Showing ' + shownRows.length + ' of ' + plural(obsRows.length, obsNoun)
          : 'Showing 1–' + obsRows.length + ' of ' + plural(obsRows.length, obsNoun)
        : plural(0, obsNoun),
      // The footer's numbers (CP-24): every listed observation, those the filters show, and
      // how many need checking (the To check filter's own rule).
      obsTotal: obsRows.length,
      // F-12: the gateway has listed this assessment's observations.
      obsSynced: captured.synced,
      obsShownCount: shownRows.length,
      obsToCheckCount: toCheckCount(obsRows.map((r) => r.o)),
      /* observation filters (CP-06 AC2, CP-08 AC3): any one label returns what carries it */
      obsFilters: s.of,
      obsSearchWords,
      obsFiltering: filtersActive(s.of) || !!obsTag,
      obsNoMatch: (filtersActive(s.of) || !!obsTag) && obsRows.length > 0 && shownRows.length === 0,
      // Nothing captured yet, and no locations to list by: the list offers
      // Add observation instead.
      obsNone: !s.obsShowDeleted && obsRows.length === 0 && !(obsByLocation && obsGroups.length),
      setObsFilter: (key: keyof ObservationFilters, value: string) =>
        setState({ of: { ...s.of, [key]: value } }),
      clearObsFilters: () => setState({ of: NO_FILTERS, obsTag: '' }),
      obsTagChips: tagChips,
      obsTag,
      setObsTag: (obsTag: string) => setState({ obsTag }),
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
      // Compared with the previous report for the same site (RV-13).
      isComparison: isAssessment && s.tab === 'comparison',
      isExport: isAssessment && s.tab === 'export',
      // Capture is part of the workspace, so it keeps the workspace's header,
      // named from the capture session when one is live. New Assessment has
      // none: its Back button already says where it sits (CP-23).
      eyebrow:
        sc === 'dashboard' || sc === 'clients' || sc === 'calendar'
          ? 'Risk engineering'
          : sc === 'create'
            ? ''
            : sc === 'users' || sc === 'knowledge'
              ? 'Administration'
              : sc === 'usage'
                ? 'Reporting'
                : sc === 'settings'
                  ? 'Account'
                  : sc === 'chat'
                    ? 'Knowledge'
                    : sc === 'client'
                      ? 'Client'
                      : 'Assessment',
      title:
        sc === 'dashboard'
          ? 'Assessments'
          : sc === 'clients'
            ? 'Clients'
            : sc === 'calendar'
              ? 'Calendar'
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
                        : sc === 'settings'
                          ? 'Settings'
                          : sc === 'chat'
                            ? 'MarshBot'
                            : sc === 'client'
                              ? 'Client'
                              : s.captureTarget.site,
      meta:
        sc === 'dashboard'
          ? plural(counted.length, 'assessment') + ' · ' + session.user.name
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
                    : sc === 'settings'
                      ? 'Your password and preferences, and how the system is set.'
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
          // F-12: the first and last tabs frame the tab row; Generation is pointed at alone.
          walk: 'assessment.tab.overview',
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
          walk: 'assessment.tab.observations',
          // Same count as the Overview and MarshBot: what the server holds.
          count: savedCount,
        },
        {
          value: 'generate',
          label: 'Generation',
          icon: 'sparkles',
          walk: 'assessment.tab.generation',
        },
        {
          value: 'review',
          label: 'Review',
          icon: 'user-round-search',
        },
        {
          // What changed since the site's previous finalised report (RV-13). Read by anyone who
          // can open the assessment; only its engineer runs it and decides (the gateway checks).
          value: 'comparison',
          label: 'Comparison',
          icon: 'git-compare',
        },
        {
          value: 'export',
          label: 'Export',
          icon: 'stamp',
          walk: 'assessment.tab.export',
        },
      ].filter((item) => canOpenTab(item.value, session)),
      // Lets a screen outside this hook confirm an action, e.g. KB-01's saves.
      notify: (message: string, tone?: 'danger') => toast(message, tone),
      // The ⋯ menu's Version history (RV-06): opens in the Review tab.
      reviewHistory: s.reviewHistory,
      // From capture it leaves the way a tab does, asking first when something
      // would be lost ('history' is that leave's destination, see discardAndLeave).
      showVersionHistory: () =>
        sc === 'field'
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
      // Focus (AS-07): the rows the gateway gave a priority (only the engineer's own),
      // in its rank order. Built from the list itself, so it never lags or pops in after it.
      focus: counted
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
      visitTypeOptions: [...new Set(counted.map((r) => r.type))].sort(
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
      // The owner's practice assessment, shown first whatever the sort and filters (F-12).
      practiceRow: practice ? decorate(practice) : null,
      noResults: filtered.length === 0,
      // None at all, archived or not: the list says so, not that filters hid them.
      noAssessments: counted.length === 0,
      // The Due pill (CP-23), which replaced the date boxes above the list.
      dateFilter: s.fDate,
      setDateFilter: (filter: DateFilter | null) => setState({ fDate: filter }),
      listOffline: listFailed && !serverRows,
      // Try again after the list could not be read: back to loading, then the list or the error.
      retryList: () => {
        setListFailed(false)
        readRows().catch(() => setListFailed(true))
      },
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
      // Save waits for the session, and stays off when it could not start.
      captureStarting: capture.state?.status === 'starting',
      captureFailed,
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
      // The tags chosen for the observation being captured, sent with Save (CP-36).
      fKinds: s.fKinds,
      setFKinds: (fKinds: Kind[]) => setState({ fKinds }),
      fLabels: s.fLabels,
      setFLabels: (fLabels: string[]) => setState({ fLabels }),
      fSaving: s.fSaving,
      fSaveError: s.fSaveError,
      setFNote: (fNote: string) => setState({ fNote }),
      waveBars,
      fClock: mm + ':' + ss,
      liveVoice,
      recLabel: s.fRec
        ? 'Stop recording'
        : captureRows.length
          ? 'Record another'
          : 'Start recording',
      fVoiceError: s.fVoiceError,
      recBusy: s.fRec || s.fSaving || s.fSending > 0 || !canRecord,
      uploadRecording: (e: React.ChangeEvent<HTMLInputElement>) => {
        for (const file of e.target.files ?? []) addClip(file, file.name, null)
        e.target.value = ''
        setState({ fVoiceError: null })
      },
      captureRows,
      toggleRec: () => {
        if (s.fSaving || s.fSending > 0 || !canRecord) return
        if (media.recorder) {
          // The clock goes back to 00:00; the clip waits in the list for Save observation.
          setState({ fRec: false, fSecs: 0 })
          media.recorder.stop()
        } else void startRecording()
      },
      fPhotos: s.fPhotos,
      fPhotoError: s.fPhotoError,
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
      // Marks the area of a photo waiting to be saved, or clears it (CP-10):
      // kept here, and sent with the photo when the observation is saved.
      markDraftPhoto: async (id: number, region: PhotoRegion | null) =>
        updateState((previous) => ({
          ...previous,
          fPhotos: previous.fPhotos.map((p) => (p.id === id ? { ...p, region } : p)),
        })),
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
      // Location's red field after a Save with none chosen (AC4): the count says whether it is
      // the first time (mark it) or a later one (shake it).
      locationRefused: currentLocation ? 0 : s.fLocRefused,
      saveObservation: () => {
        if (s.fSaving || s.fRec || s.fSending > 0 || capture.state?.status === 'starting') return
        // Saved only to the gateway (or a site walk proposal), never kept on this device.
        if (captureFailed) return
        // Nothing is saved without a location. Category and severity are never required.
        if (!currentLocation) {
          setState({ fLocRefused: s.fLocRefused + 1 })
          return
        }
        const note = s.fNote.trim() ? s.fNote : undefined
        const anything =
          note ||
          s.fClips.length ||
          s.fDraft?.recordings.length ||
          s.fPhotos.length ||
          s.fPages.length
        if (!anything) {
          toast('Add a note, recording, photograph or page first.', 'info')
          return
        }
        if (proposalTarget) {
          void saveToProposal(proposalTarget, currentLocation, note)
          return
        }
        void saveToGateway(currentLocation, note, s.fClips, s.fPhotos, s.fPages)
      },
    }
  }
  return renderVals()
}

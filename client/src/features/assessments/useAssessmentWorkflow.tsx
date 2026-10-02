import { useState, useEffect, useRef } from 'react'
import type * as React from 'react'
import { Icon, Button } from '../../design-system'
import {
  archiveAssessment as requestArchive,
  restoreAssessment as requestRestore,
  createAssessment as requestCreateAssessment,
  updateAssessment as requestUpdateAssessment,
  GatewayError,
  listAssessments,
  listAssignableEngineers,
  type AssignableEngineer,
  retryTranscription,
  saveObservation,
  updateObservationTags,
  type Assessment,
  type AssessmentStatus,
  type SavedObservation,
  type SiteLocation,
} from './api'
import { formatDayTime } from './format'
import { filtersActive, labelValues, matchesFilters, NO_FILTERS } from './observationFilters'
import type {
  AssessmentRow,
  Observation,
  ObservationFilters,
  VoiceClip,
  WorkflowState,
} from './types'
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
  COPE_DIMENSION,
  UNCATEGORISED,
  DEMO_LOCATIONS,
  STANDARD_REFERENCES,
  SEV,
  STANDARDS,
  TITLES,
  PLAIN,
  EVIDENCE,
  OBS,
} from './demo-data'
import { roleLabel } from '../accounts/api'
import type { Session } from '../auth/api'
import {
  can,
  canOpen,
  canOpenTab,
  homeScreen,
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
// Past its report due date (local calendar day) and not finalised. Due today is not overdue.
function isOverdue(r: AssessmentRow) {
  const today = new Date().toLocaleDateString('en-CA')
  return !!r.reportDueDate && r.reportDueDate < today && r.status !== STATUS_LABEL.finalised
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
    standards: a.standards,
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
// Shown under the category the engineer picked when capturing.
function categoryLabel(copeDimension: string | null) {
  if (copeDimension === null) return UNCATEGORISED
  return Object.keys(COPE_DIMENSION).find((c) => COPE_DIMENSION[c] === copeDimension)
}
// The categories an observation can be filed under: the shared COPE vocabulary
// (CP-06 AC3), or not categorised yet.
const CATEGORY_OPTIONS = [...Object.keys(CAT_ICON), UNCATEGORISED]
const SEVERITY_OPTIONS = ['critical', 'high', 'moderate', 'low'].map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))
const NO_LOCATIONS: SiteLocation[] = []
// "Stairwell B · Level 2"
const locationLabel = (l: { name: string; floor?: string | null }) =>
  [l.name, l.floor].filter(Boolean).join(' \u00b7 ')
const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')
function toEntry(o: SavedObservation, photos: string[] = []): Observation {
  const recordings = o.recordings.map((r) => {
    const { status, transcript, error } = r.transcription
    return {
      id: r.id,
      name: r.name,
      status,
      text:
        status === 'transcribed'
          ? transcript || '(No speech was detected.)'
          : TRANSCRIPTION_TEXT[status],
      error,
      audioUrl: r.url,
    }
  })
  const statuses = recordings.map((r) => r.status)
  // The row reads as the note, or the first recording when there is no note.
  const text = o.note ?? recordings[0]?.text ?? ''
  return {
    id: o.id,
    icon: o.note ? 'sticky-note' : 'mic',
    color: o.note ? '#f9ac10' : '#8f7dff',
    cat: categoryLabel(o.copeDimension) ?? 'Observation',
    time: formatDayTime(new Date(o.recordedAt)),
    text,
    area: o.location?.name ?? '',
    locationId: o.location?.id,
    floor: o.location?.floor ?? null,
    sev: o.severity,
    std: o.standard ?? '',
    media: photos,
    detail: o.note ?? '',
    attached: [
      o.note ? 'Note' : '',
      recordings.length ? plural(recordings.length, 'recording') : '',
      photos.length ? plural(photos.length, 'photo') : '',
    ]
      .filter(Boolean)
      .join(' · '),
    // Only a recording still in progress or needing attention is badged; a
    // transcribed one is the norm.
    badge: statuses.includes('transcribing')
      ? { tone: 'info', label: 'Transcribing' }
      : statuses.includes('failed')
        ? { tone: 'high', label: 'Transcription failed' }
        : null,
    recordings,
  }
}

// Why the microphone could not start (CP-03 AC8), then what to do instead.
function microphoneProblem(error: unknown) {
  // A DOMException, which is not an Error instance in every browser.
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return "Microphone access is blocked. Allow it in your browser's site settings, or upload a recording instead."
  if (name === 'NotFoundError')
    return 'No microphone was found. Connect one, or upload a recording instead.'
  return 'The microphone could not be started. Upload a recording instead.'
}

export function useAssessmentWorkflow(onSignOut: () => void, session: Session) {
  // The create form as it first opens, assigned to the signed-in engineer.
  const blankCreateForm = () => ({ ...structuredClone(initialState.cf), eng: session.user.id })
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
    if (path && window.location.pathname !== path) {
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
  const captured = useObservations(state.captureTarget.reference, onField || onWorkspace)
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
  const [media] = useState(() => ({ recorder: null as MediaRecorder | null, clips: 0, photos: 0 }))
  useEffect(() => () => media.recorder?.stream.getTracks().forEach((t) => t.stop()), [media])
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
    const recorder = setInterval(
      () =>
        updateState((previous) =>
          previous.fRec
            ? {
                ...previous,
                fSecs: previous.fSecs + 1,
              }
            : previous,
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
    return { cfEdit: null, cf: { ...structuredClone(initialState.cf), eng: session.user.id } }
  }
  function navigate(screen: string): Partial<WorkflowState> {
    return { screen }
  }
  // A created assessment clears the form, so the next one starts blank. A form
  // left without creating keeps its draft.
  function addCreatedRow(row: AssessmentRow) {
    updateState((previous) => ({
      ...previous,
      createdRows: [row, ...previous.createdRows],
      screen: 'dashboard',
      cf: blankCreateForm(),
      cfBusy: false,
      cfErr: false,
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
  function chipStyle(on: boolean, tone: string) {
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '44px',
      padding: '0 4px',
      borderRadius: '5px',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background 120ms cubic-bezier(.2,0,.2,1)',
      border: '1px solid ' + (on ? 'var(--status-' + tone + '-fg)' : 'var(--border-default)'),
      background: on ? 'var(--status-' + tone + '-bg)' : 'var(--surface-card)',
      color: on ? 'var(--status-' + tone + '-fg)' : 'var(--text-secondary)',
    } as React.CSSProperties
  }
  function modeStyle(on: boolean) {
    return {
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
          onClick={onSignOut}
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
    const serverEntries = captured.observations.map((o) => toEntry(o, s.savedPhotos[o.id]))
    const fieldRecent = [...serverEntries, ...localRecent]
    const fieldSaved = fieldRecent.length
    // Observations tab rows keep one key whatever the filters: a saved
    // observation's id, or local-<n> for the nth kept in this browser.
    const obsRows = fieldRecent.map((o, i) => ({
      o,
      key: o.id ?? 'local-' + (i - serverEntries.length),
    }))
    const shownRows = obsRows.filter(({ o }) => matchesFilters(o, s.of))
    const tagRow = s.tagEdit && obsRows.find((r) => r.key === s.tagEdit!.key)
    // Real recording needs a capture session on the server; without one, voice stays simulated.
    const liveVoice = !!liveCapture
    // Capture starts from a location; the sheet stays open until one is chosen.
    const currentLocation = places.locations.find((l) => l.id === s.fLocationId) ?? null
    const locSheetOpen =
      sc === 'field' && capture.state?.status !== 'starting' && (s.locOpen || !currentLocation)
    const query = s.locQuery.trim().toLowerCase()
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
    // Everything in the Ready to save list becomes one observation, filed under
    // what the form shows: the note exactly as typed (CP-02) and each recording
    // with its one transcription (CP-03 AC3). If it fails, everything stays
    // listed for another try.
    async function saveToGateway(
      location: SiteLocation,
      note: string | undefined,
      clips: VoiceClip[],
      photos: { name: string }[],
    ) {
      const reference = s.captureTarget.reference
      setState({ fSaving: true, fSaveError: null })
      let observation
      try {
        observation = await saveObservation(
          reference,
          {
            note,
            copeDimension: s.fCat === UNCATEGORISED ? null : COPE_DIMENSION[s.fCat],
            severity: s.fSev,
            locationId: location.id,
            standard: s.fStd,
          },
          clips.map((c) => ({ name: c.name, audio: c.audio })),
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
      if (clips.length) captured.reload()
      clips.forEach((c) => URL.revokeObjectURL(c.url))
      const saved = observation
      // Keep anything added while the observation was saving.
      updateState((previous) => ({
        ...previous,
        fSaving: false,
        fNote: previous.fNote === note ? '' : previous.fNote,
        fNoteListed: previous.fNote === note ? false : previous.fNoteListed,
        fClips: previous.fClips.filter((c) => !clips.includes(c)),
        fPhotos: previous.fPhotos.filter((p) => !photos.includes(p)),
        savedPhotos: photos.length
          ? { ...previous.savedPhotos, [saved.id]: photos.map((p) => p.name) }
          : previous.savedPhotos,
        fToast: {
          text:
            'Observation saved to ' +
            reference +
            '.' +
            (clips.length ? ' Transcribing ' + plural(clips.length, 'recording') + ' now.' : ''),
        },
      }))
      later(() => setState({ fToast: null }), 3200)
    }
    // Saves the tags in the Edit tags dialog (CP-06): on the gateway for a
    // saved observation, sending only what changed, or in this browser for one
    // kept in the demo. On failure the dialog stays open with the changes.
    async function saveTags() {
      const edit = s.tagEdit
      if (!edit || !tagRow || s.tagBusy) return
      const { o } = tagRow
      // Unlisted (e.g. a sample observation on a live assessment): left as it is.
      const location = places.locations.find((l) => l.id === edit.locationId)
      if (!o.id) {
        const n = Number(edit.key.slice('local-'.length))
        const retagged: Observation = {
          ...o,
          cat: edit.cat,
          sev: edit.sev,
          std: edit.std,
          ...(location && { area: location.name, floor: location.floor, locationId: location.id }),
        }
        const list = localRecent.map((x, i) => (i === n ? retagged : x))
        setState({
          ...(isDemoCapture
            ? { fRecent: list }
            : { captureObs: { ...s.captureObs, [s.captureTarget.reference]: list } }),
          tagEdit: null,
        })
        toast('Tags updated. They are kept in this demo only.')
        return
      }
      const tags = {
        ...(edit.cat !== o.cat && {
          copeDimension: edit.cat === UNCATEGORISED ? null : COPE_DIMENSION[edit.cat],
        }),
        ...(edit.sev !== o.sev && { severity: edit.sev }),
        ...(location && location.id !== o.locationId && { locationId: location.id }),
        ...(edit.std !== o.std && { standard: edit.std || null }),
      }
      if (!Object.keys(tags).length) return setState({ tagEdit: null })
      setState({ tagBusy: true, tagError: null })
      let saved
      try {
        saved = await updateObservationTags(o.id, tags)
      } catch (error: unknown) {
        const problems = error instanceof GatewayError ? Object.values(error.fields) : []
        const cause = problems.length
          ? problems.join(' ')
          : error instanceof GatewayError && error.status !== null
            ? error.message
            : 'The gateway could not be reached.'
        return setState({
          tagBusy: false,
          tagError: cause + ' Your changes are still here; press Save tags to try again.',
        })
      }
      captured.replace(saved)
      setState({ tagBusy: false, tagEdit: null })
      toast('Tags updated.')
    }
    // Adds the location typed into the sheet and captures in it straight away.
    async function submitLocation() {
      const name = s.lf.name.trim()
      if (!name) return setState({ lfError: 'Name the location.' })
      const floor = s.lf.floor.trim()
      setState({ lfBusy: true, lfError: null })
      let location
      try {
        location = await places.add({ name, floor })
      } catch (error: unknown) {
        const reason =
          error instanceof GatewayError
            ? (Object.values(error.fields)[0] ?? error.message)
            : 'The location could not be added.'
        return setState({ lfBusy: false, lfError: reason })
      }
      setState({
        lfBusy: false,
        lf: { name: '', floor: '' },
        locAdding: false,
        locQuery: '',
        locOpen: false,
        fLocationId: location.id,
      })
    }
    // Removing the location in use leaves none chosen, so the sheet stays open.
    async function removeLocation(id: string) {
      try {
        await places.remove(id)
        setState({ locError: null })
      } catch (error: unknown) {
        setState({
          locError: error instanceof Error ? error.message : 'The location could not be removed.',
        })
      }
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
    async function startRecording() {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (error: unknown) {
        setState({
          fVoiceError: { title: 'Microphone unavailable', message: microphoneProblem(error) },
        })
        return
      }
      const chunks: Blob[] = []
      const next = new MediaRecorder(stream)
      const startedAt = Date.now()
      next.ondataavailable = (event) => chunks.push(event.data)
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        media.recorder = null
        const secs = Math.round((Date.now() - startedAt) / 1000)
        addClip(
          new Blob(chunks, { type: next.mimeType || 'audio/webm' }),
          null,
          String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0'),
        )
      }
      next.start()
      media.recorder = next
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
    // Only the demo assessment has sample workspace content; others show their own details.
    const openRow = isDemoCapture ? null : rows.find((r) => r.id === s.captureTarget.reference)

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
    // The dashboard's way back into capture, named on its button: the
    // engineer's own capture in progress, the most recently started if there
    // are several, or the demo assessment when the gateway cannot be reached.
    const [latestCapture] = (serverRows ?? [])
      .filter((r) => r.status === STATUS_LABEL.capturing && r.engineerId === session.user.id)
      .sort((a, b) => (b.captureStartedAt ?? '').localeCompare(a.captureStartedAt ?? ''))
    const continueTarget = latestCapture
      ? { reference: latestCapture.id, site: latestCapture.site }
      : listFailed && !serverRows
        ? CAPTURE_ASSESSMENT
        : null
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
          {
            value: 'create',
            label: 'New assessment',
            icon: 'plus',
          },
          {
            value: 'field',
            label: 'Site observation',
            icon: 'camera',
            count: fieldSaved,
            live: !!liveCapture,
          },
        ].filter((item) => item.value !== 'field' || canCapture),
      },
      {
        label: 'Open assessment',
        // Only one on the work list, as for capture above.
        items: targetRow
          ? [
              {
                value: 'assessment',
                label: s.captureTarget.site,
                icon: 'file-pen',
              },
            ]
          : [],
      },
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
    ]
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => canOpen(item.value, session)),
      }))
      .filter((section) => section.items.length > 0)

    const q = s.q.trim().toLowerCase()
    const openCount = (r: AssessmentRow) => (r.live ? open.length : r.open || 0)
    const filtered = rows
      .filter((r) => {
        if (q && !(r.site + ' ' + r.client + ' ' + r.id).toLowerCase().includes(q)) return false
        // All statuses leaves archived assessments out; the Archived filter shows them.
        if (
          s.fStatus === 'All statuses' ? r.status === STATUS_LABEL.archived : r.status !== s.fStatus
        )
          return false
        return true
      })
      .sort((a, b) =>
        s.workSort === 'Report due: earliest first'
          ? (a.reportDueDate || '9999-12-31').localeCompare(b.reportDueDate || '9999-12-31')
          : (b.siteVisitDate || '').localeCompare(a.siteVisitDate || ''),
      )
      .map((r) => {
        const n = openCount(r)
        return {
          ...r,
          overdue: isOverdue(r),
          sevIcon: SEV[r.sev].icon,
          sevColor: SEV[r.sev].color,
          stackMeta: r.client + ' · ' + r.type + ' · ' + r.eng,
          hasOpen: n > 0,
          noOpen: n === 0,
          openLabel: n + (n === 1 ? ' open' : ' open'),
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
      {
        label: 'Applicable standards recorded',
        value: '3 documents',
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
    const standards = STANDARDS.map((t) => ({
      ...t,
      on: s.cf.stds.includes(t.name),
    }))
    const engineers = directory.map((e) => ({
      ...e,
      initials: e.name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join(''),
      role: [e.staffId, e.jobTitle].filter(Boolean).join(' · '),
      on: s.cf.eng === e.id,
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
    return {
      /* access (F-05) */
      routeBlocked,
      canEdit,
      canDraft: can('reports:generate', session),
      roleName: roleLabel(session.user.role),
      userId: session.user.id,
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
      navValue: isAssessment ? 'assessment' : sc,
      navFooter: userFooter(),
      showSideNav: !phone && !s.navCollapsed,
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
          ...navigate(v),
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
          ...navigate(v),
          toast: null,
        })
      },
      goDash: () =>
        setState({
          screen: 'dashboard',
        }),
      goCreate: () =>
        setState({
          screen: 'create',
          cfErr: false,
          cfServerError: null,
          // Coming from an edit, start a new assessment from a blank form.
          ...(s.cfEdit && blankForm()),
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
            ref: a.policyReference ?? '',
            survey: a.surveyType,
            date: a.siteVisitDate ?? '',
            due: a.reportDueDate ?? '',
            stds: [...a.standards],
            eng: a.engineer?.id ?? '',
          },
        })
      },
      isEditing: !!s.cfEdit,
      goField: () =>
        setState({
          screen: 'field',
        }),
      continueCaptureLabel: continueTarget && 'Continue capture · ' + continueTarget.site,
      continueCapture: () => {
        if (continueTarget)
          setState({
            screen: 'field',
            captureTarget: continueTarget,
            // Filters name the previous assessment's locations and floors.
            of: NO_FILTERS,
            obsOpen: null,
          })
      },
      canCapture,
      canArchive: isMine && canCapture,
      canRestore: isMine && !canCapture,
      restoreAssessment: async () => {
        if (s.archiveBusy) return
        const reference = s.captureTarget.reference
        setState({ archiveBusy: true })
        try {
          await requestRestore(reference)
          // Back to the work list, which reloads with the status it had.
          setState({ ...navigate('dashboard'), archiveBusy: false })
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
          // Back to the work list, which reloads; capture falls back to the demo.
          setState({
            ...navigate('dashboard'),
            archiveOpen: false,
            archiveBusy: false,
            captureTarget: CAPTURE_ASSESSMENT,
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
      goAssessment: () => setState(navigate('assessment')),
      goReview: () =>
        setState({
          tab: 'review',
        }),
      isDashboard: sc === 'dashboard',
      isCreate: sc === 'create',
      isField: sc === 'field',
      isUsers: sc === 'users',
      isKnowledge: sc === 'knowledge',
      isAssessment,
      isOverview: isAssessment && s.tab === 'overview',
      isObservations: isAssessment && s.tab === 'observations',
      goGenerate: () =>
        setState({
          tab: 'generate',
        }),
      // A real assessment shows its own record; only the demo one shows samples.
      ovMetrics: openRow
        ? [
            { label: 'Status', value: openRow.status },
            { label: 'Observations on file', value: fieldSaved },
            { label: 'Standards', value: openRow.standards?.length ?? 0 },
            {
              label: 'Report due',
              value: openRow.reportDueDate ? formatDay(openRow.reportDueDate) : 'Not set',
              note: isOverdue(openRow) ? 'Overdue' : undefined,
            },
          ]
        : [
            {
              label: 'Sections drafted',
              value: s.gsecs.filter((x) => x.st === 'done').length + ' of ' + s.gsecs.length,
            },
            { label: 'Open review items', value: open.length + 3 },
            { label: 'Observations on file', value: fieldSaved },
            { label: 'Evidence sources', value: 24 },
          ],
      showReviewProgress: !openRow,
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
            {
              label: 'Report',
              value: 'RPT-2026-0411',
            },
            {
              label: 'Site',
              value: 'Tilbury Distribution Centre, Ferry Lane, Tilbury RM18 7HR',
            },
            {
              label: 'Client',
              value: 'Northgate Logistics',
            },
            {
              label: 'Assessment type',
              value: 'Property risk survey',
            },
            {
              label: 'Site visit',
              value: '11 Apr 2026',
            },
            {
              label: 'Report due',
              value: '25 Apr 2026',
            },
            {
              label: 'Engineer',
              value: 'A. Rowe',
            },
          ],
      obsWide: !narrow,
      obsStack: narrow,
      obsList: shownRows.map(({ o, key }) => {
        const open = s.obsOpen === key
        const sev = o.sev || 'low'
        const cols = narrow
          ? '36px minmax(0,1fr) 72px'
          : '40px minmax(0,1.4fr) minmax(0,1.1fr) minmax(0,2fr) 120px 84px'
        return {
          ...o,
          key,
          open,
          // The zone and floor, e.g. "Bay 3 — north aisle · Ground".
          where: locationLabel({ name: o.area, floor: o.floor }),
          editTags: () =>
            setState({
              tagEdit: {
                key,
                cat: o.cat,
                sev,
                locationId: o.locationId ?? '',
                std: o.std,
              },
              tagError: null,
            }),
          icon: CAT_ICON[o.cat] || 'circle-dot',
          color: 'var(--text-secondary)',
          chevron: open ? 'chevron-down' : 'chevron-right',
          clock: (o.time || '').split(' ').slice(-1)[0],
          sev,
          sevLabel: sev.charAt(0).toUpperCase() + sev.slice(1),
          // Each recording shows its transcript, or where its transcription stands.
          recordings: (o.recordings ?? []).map((r) => ({
            ...r,
            retry: () => void retryVoice(o.id!, r.id),
          })),
          // A saved observation's recordings carry their own text below its note.
          detail: o.recordings ? o.detail : o.detail || o.text,
          media: (o.media || []).map((n) => ({
            name: n,
          })),
          hasAudio: !!o.audio,
          audioLabel: 'Audio note (' + (o.audio || '') + ')',
          hasStd: !!o.std,
          rowStyle: {
            display: 'grid',
            gridTemplateColumns: cols,
            alignItems: narrow ? 'flex-start' : 'center',
            gap: '12px',
            padding: '12px 16px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border-subtle)',
            transition: 'background 80ms cubic-bezier(.2,0,.2,1)',
            background: open ? 'var(--surface-selected)' : 'var(--surface-card)',
          } as React.CSSProperties,
        }
      }),
      toggleObs: (e: React.MouseEvent<HTMLElement>) => {
        const k = e.currentTarget.dataset.i ?? null
        setState({
          obsOpen: s.obsOpen === k ? null : k,
        })
      },
      obsCountLabel: filtersActive(s.of)
        ? 'Showing ' + shownRows.length + ' of ' + plural(fieldRecent.length, 'observation')
        : 'Showing 1–' + fieldRecent.length + ' of ' + fieldSaved + ' observations',
      obsNext: () => toast('Later observations are not loaded in this prototype.', 'info'),
      /* observation filters (CP-06 AC2): any one label returns what carries it */
      obsFilters: s.of,
      obsFiltering: filtersActive(s.of),
      obsNoMatch: filtersActive(s.of) && shownRows.length === 0,
      setObsFilter: (key: keyof ObservationFilters) => (e: React.ChangeEvent<HTMLSelectElement>) =>
        setState({ of: { ...s.of, [key]: e.target.value } }),
      clearObsFilters: () => setState({ of: NO_FILTERS }),
      obsCatFilterOptions: [{ value: '', label: 'All categories' }, ...CATEGORY_OPTIONS],
      obsSevFilterOptions: [{ value: '', label: 'All severities' }, ...SEVERITY_OPTIONS],
      obsLocFilterOptions: [
        { value: '', label: 'All locations' },
        ...labelValues(
          fieldRecent.map((o) => o.area),
          s.of.loc,
        ),
      ],
      obsFloorFilterOptions: [
        { value: '', label: 'All floors' },
        ...labelValues(
          fieldRecent.map((o) => o.floor),
          s.of.floor,
        ),
      ],
      /* tag editing (CP-06) */
      tagOpen: !!tagRow,
      tagEdit: s.tagEdit,
      tagBusy: s.tagBusy,
      tagError: s.tagError,
      tagCatOptions: CATEGORY_OPTIONS,
      tagCatHint:
        s.tagEdit?.cat === UNCATEGORISED
          ? 'Report drafting leaves this observation out until it is categorised.'
          : undefined,
      tagSevOptions: SEVERITY_OPTIONS,
      tagLocOptions: [
        // A location not on the assessment's list can be kept, not chosen again.
        ...(tagRow && !places.locations.some((l) => l.id === s.tagEdit?.locationId)
          ? [
              {
                value: s.tagEdit!.locationId,
                label: locationLabel({ name: tagRow.o.area, floor: tagRow.o.floor }),
              },
            ]
          : []),
        ...places.locations.map((l) => ({ value: l.id, label: locationLabel(l) })),
      ],
      tagStdOptions: [
        { value: '', label: 'None, let the draft find it' },
        ...labelValues(STANDARD_REFERENCES, s.tagEdit?.std ?? '').map((name) => ({
          value: name,
          label: name,
        })),
      ],
      setTag:
        (field: 'cat' | 'sev' | 'locationId' | 'std') =>
        (e: React.ChangeEvent<HTMLSelectElement>) =>
          s.tagEdit && setState({ tagEdit: { ...s.tagEdit, [field]: e.target.value } }),
      closeTags: () => !s.tagBusy && setState({ tagEdit: null, tagError: null }),
      saveTags: () => void saveTags(),
      ovStandards: openRow
        ? (openRow.standards ?? []).map((name) => ({
            icon: 'book-marked',
            name,
            detail: STANDARDS.find((t) => t.name === name)?.desc ?? '',
          }))
        : [
            {
              icon: 'book-marked',
              name: 'FM Global 2-0',
              detail: 'Installation of sprinkler systems',
            },
            {
              icon: 'book-marked',
              name: 'NFPA 13',
              detail: 'Standard for the installation of sprinkler systems',
            },
            {
              icon: 'file-text',
              name: 'Tilbury survey 2023',
              detail: 'Previous Marsh report, issued 14 Mar 2023',
            },
          ],
      isGenerate: isAssessment && s.tab === 'generate',
      isReview: isAssessment && s.tab === 'review',
      isExport: isAssessment && s.tab === 'export',
      eyebrow:
        sc === 'dashboard'
          ? 'Risk engineering'
          : sc === 'create'
            ? s.cfEdit
              ? 'Assessment workspace'
              : 'New assessment'
            : sc === 'field'
              ? 'On site'
              : sc === 'users' || sc === 'knowledge'
                ? 'Administration'
                : 'Assessment workspace',
      title:
        sc === 'dashboard'
          ? 'Your assessments'
          : sc === 'create'
            ? s.cfEdit
              ? 'Edit assessment details'
              : 'Create assessment'
            : sc === 'field'
              ? 'Site observation'
              : sc === 'users'
                ? 'User accounts'
                : sc === 'knowledge'
                  ? 'Knowledge base'
                  : s.captureTarget.site,
      meta:
        sc === 'dashboard'
          ? rows.length + ' assessments · ' + session.user.name
          : sc === 'create'
            ? 'Opening an assessment creates the report record and its drafting set.'
            : sc === 'field'
              ? captureSite +
                ' · ' +
                captureRef +
                ' · ' +
                fieldSaved +
                (fieldSaved === 1 ? ' observation captured' : ' observations captured')
              : sc === 'users'
                ? 'View and update your team’s account details and roles.'
                : sc === 'knowledge'
                  ? 'The standards and past reports used to draft new reports. Correct, withdraw or add them.'
                  : openRow
                    ? [
                        openRow.id,
                        openRow.type,
                        'Assessed ' + openRow.date,
                        'Report due ' +
                          (openRow.reportDueDate ? formatDay(openRow.reportDueDate) : 'Not set'),
                        'Engineer ' + openRow.eng,
                      ].join(' · ')
                    : 'RPT-2026-0411 · Property risk survey · Assessed 11 Apr 2026 · Lead engineer A. Rowe',
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
          label: 'Report generation',
          icon: 'sparkles',
        },
        {
          value: 'review',
          label: 'Review',
          icon: 'user-round-search',
          // Drafting and review counts exist only for the demo assessment so far.
          count: openRow ? undefined : live.length,
        },
        {
          value: 'export',
          label: 'Validation and export',
          icon: 'stamp',
          count: openRow ? undefined : open.length,
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
      showVersionHistory: () => toast('Version history is not connected in this demo.', 'info'),
      /* annotations */

      /* dashboard */
      q: s.q,
      setQ: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          q: e.target.value,
        }),
      fStatus: s.fStatus,
      setStatus: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          fStatus: e.target.value,
        }),
      statusOptions: ['All statuses', ...Object.values(STATUS_LABEL)],
      workSort: s.workSort,
      sortOptions: ['Latest site visit', 'Report due: earliest first'],
      setWorkSort: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) => setState({ workSort: e.target.value }),
      filteredRows: filtered,
      noResults: filtered.length === 0,
      resultLabel: filtered.length + ' of ' + rows.length + ' assessments',
      // The same open items the table's Items column shows, across your assessments.
      openItemCount: rows.reduce((sum, r) => sum + openCount(r), 0),
      // Observations captured in this browser that the gateway does not store yet.
      unfiledCount: rows.reduce((sum, r) => sum + (s.captureObs[r.id]?.length ?? 0), 0),
      reviewCount: rows.filter((row) => row.status === STATUS_LABEL.under_review).length,
      listOffline: listFailed && !serverRows,
      onRow: (e: React.MouseEvent<HTMLElement>) => {
        const id = e.currentTarget.dataset.id
        const row = rows.find((r) => r.id === id)
        if (row)
          setState({
            screen: 'assessment',
            tab: 'overview',
            toast: null,
            captureTarget: { reference: row.id, site: row.site },
            // Filters name this assessment's locations and floors.
            of: NO_FILTERS,
            obsOpen: null,
          })
      },
      /* create */
      cfSite: s.cf.site,
      cfClient: s.cf.client,
      cfAddr: s.cf.addr,
      cfRef: s.cf.ref,
      cfType: s.cf.type,
      cfSurvey: s.cf.survey,
      cfDate: s.cf.date,
      cfDue: s.cf.due,
      errSite: s.cfErr && !s.cf.site.trim() ? 'Site name is required' : '',
      errClient: s.cfErr && !s.cf.client.trim() ? 'Client is required' : '',
      hasCfError: s.cfErr && (!s.cf.site.trim() || !s.cf.client.trim()),
      setCfSite: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            site: e.target.value,
          },
        }),
      setCfClient: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            client: e.target.value,
          },
        }),
      setCfAddr: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            addr: e.target.value,
          },
        }),
      setCfRef: (
        e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>,
      ) =>
        setState({
          cf: {
            ...s.cf,
            ref: e.target.value,
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
      standards,
      engineers,
      directoryError: directoryStatus === 'error',
      directoryLoading: directoryStatus === 'loading',
      stdCountLabel: s.cf.stds.length + ' of 6 selected',
      toggleStd: (v: string) => {
        const has = s.cf.stds.includes(v)
        setState({
          cf: {
            ...s.cf,
            stds: has ? s.cf.stds.filter((x) => x !== v) : s.cf.stds.concat([v]),
          },
        })
      },
      selectEng: (id: string) => setState({ cf: { ...s.cf, eng: id } }),
      createAssessment: async () => {
        if (s.cfBusy) return
        if (!s.cf.site.trim() || !s.cf.client.trim()) {
          setState({
            cfErr: true,
          })
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
              client: s.cf.client,
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
            site: {
              name: s.cf.site,
              address: s.cf.addr,
              jurisdiction: s.cf.jurisdiction,
              facilityType: s.cf.type,
            },
            client: s.cf.client,
            policyReference: s.cf.ref,
            surveyType: s.cf.survey,
            siteVisitDate: s.cf.date,
            reportDueDate: s.cf.due,
            standards: s.cf.stds,
            engineerId: s.cf.eng,
          })
          addCreatedRow(toRow(created))
          toast(
            created.reference +
              ' created for ' +
              created.site.name +
              (created.engineer?.id === session.user.id
                ? '. Open it from the list to capture observations on site.'
                : '. It will appear in the assigned engineer’s work list.'),
          )
        } catch (error: unknown) {
          if (error instanceof GatewayError && error.status === null) {
            // Keep the demo usable without the gateway, and say nothing was saved.
            const id = `RPT-2026-${String(416 + s.createdRows.length).padStart(4, '0')}`
            addCreatedRow({
              id,
              site: s.cf.site,
              client: s.cf.client,
              type: s.cf.survey,
              date: formatDay(s.cf.date || null),
              siteVisitDate: s.cf.date || null,
              reportDueDate: s.cf.due || null,
              engineerId: s.cf.eng || null,
              standards: s.cf.stds,
              eng: s.cf.eng
                ? (directory.find((e) => e.id === s.cf.eng)?.name ??
                  (s.cf.eng === session.user.id ? session.user.name : 'Unassigned'))
                : 'Unassigned',
              status: STATUS_LABEL.not_started,
              sev: 'low',
              open: 0,
            })
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
      captureRef,
      fSavedLabel: fieldSaved + ' saved',
      fieldEmptyLabel: 'No observations captured for ' + captureRef + ' yet.',
      isNoteMode: s.fMode === 'note',
      isVoiceMode: s.fMode === 'voice',
      isPhotoMode: s.fMode === 'photo',
      tabNoteStyle: modeStyle(s.fMode === 'note'),
      tabVoiceStyle: modeStyle(s.fMode === 'voice'),
      tabPhotoStyle: modeStyle(s.fMode === 'photo'),
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
      fNote: s.fNote,
      fNoteListed: s.fNoteListed,
      fSaving: s.fSaving,
      fSaveError: s.fSaveError,
      // One note per observation: adding it moves it into the Ready to save list.
      addNote: () =>
        s.fNote.trim()
          ? setState({ fNoteListed: true })
          : setState({ fToast: { text: 'Write a note first.', warn: true } }),
      editNote: () => setState({ fNoteListed: false, fMode: 'note' }),
      removeNote: () => setState({ fNote: '', fNoteListed: false }),
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
          ? 'Recording. Stop when you are done; it is added to the list below.'
          : 'Record or upload as many as you need. Each one is transcribed when the observation is saved.'
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
          later(
            () =>
              setState({
                fTransBusy: false,
                fTrans: true,
              }),
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
      fTranscriptText:
        'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.',
      transcriptToNote: () =>
        setState({
          fMode: 'note',
          fTrans: false,
          fNoteListed: false,
          fNote:
            'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.',
        }),
      fPhotos: s.fPhotos,
      photoHint:
        'Photographs are simulated in this prototype and captioned with the location below.',
      removePhoto: (photo: { name: string }) =>
        updateState((previous) => ({
          ...previous,
          fPhotos: previous.fPhotos.filter((p) => p !== photo),
        })),
      readyCount: (s.fNoteListed ? 1 : 0) + s.fClips.length + s.fPhotos.length,
      takePhoto: () =>
        setState({
          fPhotos: s.fPhotos.concat([
            {
              name: 'IMG_0' + (459 + ++media.photos) + '.jpg',
            },
          ]),
        }),
      /* location */
      locationLabel: currentLocation ? locationLabel(currentLocation) : null,
      locSheetOpen,
      // Closing needs a location to go back to; otherwise the engineer leaves capture.
      canCloseLocations: !!currentLocation,
      openLocations: () => setState({ locOpen: true }),
      closeLocations: () =>
        setState({ locOpen: false, locQuery: '', lfError: null, locError: null }),
      locQuery: s.locQuery,
      setLocQuery: (e: React.ChangeEvent<HTMLInputElement>) =>
        setState({ locQuery: e.target.value }),
      locations: places.locations
        .filter((l) => !query || locationLabel(l).toLowerCase().includes(query))
        .map((l) => {
          const count = fieldRecent.filter((o) =>
            o.locationId ? o.locationId === l.id : o.area === l.name,
          ).length
          return {
            id: l.id,
            label: locationLabel(l),
            detail: count ? plural(count, 'observation') : '',
            selected: l.id === s.fLocationId,
            // Only a location with nothing saved in it can be removed.
            remove: count
              ? undefined
              : () => {
                  if (window.confirm('Remove ' + locationLabel(l) + ' from the list?'))
                    void removeLocation(l.id)
                },
          }
        }),
      noLocations: places.locations.length === 0,
      chooseLocation: (id: string) =>
        setState({ fLocationId: id, locOpen: false, locQuery: '', lfError: null }),
      locAdding: s.locAdding || places.locations.length === 0,
      startAddLocation: () =>
        setState({
          locAdding: true,
          lf: { ...s.lf, name: s.lf.name || s.locQuery.trim() },
          lfError: null,
        }),
      lf: s.lf,
      setLf: (field: 'name' | 'floor') => (e: React.ChangeEvent<HTMLInputElement>) =>
        setState({ lf: { ...s.lf, [field]: e.target.value }, lfError: null }),
      lfBusy: s.lfBusy,
      lfError: s.lfError,
      locError: s.locError,
      submitLocation: () => void submitLocation(),
      fCat: s.fCat,
      setFCat: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          fCat: e.target.value,
        }),
      catOptions: CATEGORY_OPTIONS,
      catHint:
        s.fCat === UNCATEGORISED
          ? 'Report drafting leaves this observation out until it is categorised.'
          : undefined,
      sevCriticalStyle: chipStyle(s.fSev === 'critical', 'critical'),
      sevHighStyle: chipStyle(s.fSev === 'high', 'high'),
      sevModerateStyle: chipStyle(s.fSev === 'moderate', 'moderate'),
      sevLowStyle: chipStyle(s.fSev === 'low', 'low'),
      setFSev: (e: React.MouseEvent<HTMLElement>) =>
        setState({
          fSev: e.currentTarget.dataset.v || 'low',
        }),
      fStd: s.fStd,
      stdOptions: [
        { value: '', label: 'None, let the draft find it' },
        ...STANDARD_REFERENCES.map((name) => ({ value: name, label: name })),
      ],
      setFStd: (e: React.ChangeEvent<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>) =>
        setState({
          fStd: e.target.value,
        }),
      fToast: s.fToast,
      fRecent: fieldRecent,
      saveObservation: () => {
        if (s.fSaving || s.fRec) return
        if (!currentLocation) {
          setState({ fToast: { text: 'Choose a location first.', warn: true }, locOpen: true })
          return
        }
        // With a capture session live, the note and recordings are saved on the
        // server as one observation. Photos alone stay in the demo until CP-04.
        const note = s.fNote.trim() ? s.fNote : undefined
        if (liveCapture && (note || s.fClips.length)) {
          void saveToGateway(currentLocation, note, s.fClips, s.fPhotos)
          return
        }
        const text =
          s.fNote.trim() ||
          (s.fTrans
            ? 'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads in the north aisle of Bay 3.'
            : '') ||
          (s.fPhotos.length
            ? s.fPhotos.length + ' photograph(s) captured at ' + currentLocation.name + '.'
            : '')
        if (!text) {
          setState({
            fToast: { text: 'Add a note, recording or photograph first.', warn: true },
          })
          return
        }
        const entry: Observation = {
          icon: s.fMode === 'photo' ? 'camera' : s.fMode === 'voice' ? 'mic' : 'sticky-note',
          color: s.fMode === 'photo' ? '#4f9aee' : s.fMode === 'voice' ? '#8f7dff' : '#f9ac10',
          cat: s.fCat,
          time: formatDayTime(new Date()),
          text,
          area: currentLocation.name,
          locationId: currentLocation.id,
          floor: currentLocation.floor,
          sev: s.fSev,
          std: s.fStd,
          media: s.fPhotos.map((p) => p.name),
          detail: text,
        }
        const reference = s.captureTarget.reference
        setState({
          ...(isDemoCapture
            ? { fRecent: [entry].concat(s.fRecent) }
            : { captureObs: { ...s.captureObs, [reference]: [entry].concat(localRecent) } }),
          fNote: '',
          fNoteListed: false,
          fPhotos: [],
          fTrans: false,
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

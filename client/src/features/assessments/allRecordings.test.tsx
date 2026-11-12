import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { Assessment, SavedObservation, SavedRecording } from './api'

// All Recordings (CP-12): every recording of the assessment's observations,
// as All Photos and All Handwritten Pages list theirs, each played in place
// with a seek bar and a speed.

const REF = 'RPT-2026-0411'
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', building: 'Warehouse', name: 'Bay 3 — north aisle', floor: 'Ground' }
const PUMP_HOUSE = { id: 'l3', building: null, name: 'Pump house', floor: null }
const ME = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const OTHER = { id: '6ab39017e45cf009e4507799', name: 'Jide Okafor' }
const AT = '2026-10-07T06:30:00.000Z'

function recording(
  id: string,
  name: string,
  transcription: Partial<SavedRecording['transcription']> = {},
  fields: Partial<SavedRecording> = {},
): SavedRecording {
  return {
    id,
    name,
    contentType: 'audio/webm',
    size: 1200,
    url: `/api/observations/o/recordings/${id}/audio`,
    transcription: {
      status: 'transcribed',
      transcript: 'Valve V-12 chained open.',
      correction: null,
      error: null,
      attempts: 1,
      ...transcription,
    },
    added: null,
    ...fields,
  }
}
function observation(fields: Partial<SavedObservation>): SavedObservation {
  return {
    id: 'o1',
    engineer: 'Alex Rowe',
    copeDimensions: ['Protection'],
    standard: null,
    severity: 'high',
    location: BAY_3,
    note: null,
    recordings: [],
    photos: [],
    removedRecordings: [],
    removedPhotos: [],
    interpretation: null,
    recordedAt: '2026-09-29T08:10:00.000Z',
    edited: null,
    deleted: null,
    ...fields,
  }
}
function assessment(engineer: { id: string; name: string }): Assessment {
  return {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    clientId: null,
    surveyType: 'Property risk survey',
    siteVisitDate: '2026-04-11',
    reportDueDate: null,
    engineer,
    status: 'capturing',
    captureStartedAt: '2026-04-11T08:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
    site: {
      id: 'site1',
      code: 'SITE-0001',
      name: 'Tilbury Distribution Centre',
      address: null,
      jurisdiction: 'GB',
      facilityType: 'Warehouse',
      removed: false,
      change: { allowed: true, reason: null, assessments: 1 },
    },
  }
}

const VALVE = 'Sprinkler valve chained shut.'
const PERMIT = 'Hot work permit board out of date.'
const RISER = 'Riser room door wedged open.'
const GONE = 'Deleted observation.'
const VALVE_OBS = observation({
  id: 'o1',
  note: VALVE,
  recordings: [recording('r1', 'Recording 1'), recording('r2', 'Recording 2')],
  // A removed recording stays off the list; it is restored on its observation.
  removedRecordings: [{ ...recording('r0', 'Recording 0'), removed: { at: AT, by: ME } }],
})
const PERMIT_OBS = observation({
  id: 'o2',
  note: PERMIT,
  location: PUMP_HOUSE,
  copeDimensions: ['Occupancy'],
  recordings: [recording('r3', 'Recording 3', { status: 'transcribing', transcript: null })],
})
const RISER_OBS = observation({
  id: 'o3',
  note: RISER,
  recordings: [
    recording('r4', 'Recording 4', { status: 'failed', transcript: null, error: 'Timed out.' }),
  ],
})
const DELETED_OBS = observation({
  id: 'o9',
  note: GONE,
  recordings: [recording('r9', 'Recording 9')],
  deleted: { at: AT, by: ME },
})

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A small stand-in for the gateway. The work list is unreachable unless given,
// so the dashboard shows its sample rows, which the engineer may change.
let listed: SavedObservation[] = []
let workList: Assessment[] | null = null
const retries: string[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === '/api/assessments')
      return workList ? json(200, workList) : Promise.reject(new TypeError('Failed to fetch'))
    if (url === OBS_URL)
      return json(
        200,
        listed.filter((o) => !o.deleted),
      )
    if (url === OBS_URL + '?include=deleted') return json(200, listed)
    if (url === LOCATIONS_URL) return json(200, [BAY_3, PUMP_HOUSE])
    const retry = /^\/api\/observations\/(\w+)\/recordings\/(\w+)\/transcription\/retry$/.exec(url)
    if (retry && init.method === 'POST') {
      retries.push(retry[1] + '/' + retry[2])
      listed = listed.map((o) => ({
        ...o,
        recordings: o.recordings.map((r) =>
          r.id === retry[2]
            ? { ...r, transcription: { ...r.transcription, status: 'transcribing', error: null } }
            : r,
        ),
      }))
      return Promise.resolve(new Response(null, { status: 202 }))
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

async function openObservations() {
  window.history.replaceState(null, '', '/')
  render(<App />)
  await signIn()
  if (workList) await screen.findByText('1 assessment')
  else await screen.findByText('Showing sample assessments')
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  if (listed.length)
    await screen.findByRole('button', { name: new RegExp(listed[0].note!.slice(0, 20)) })
}
async function openRecordings() {
  await openObservations()
  fireEvent.click(screen.getByRole('button', { name: 'All recordings' }))
  return screen.getByRole('group', { name: 'Recordings' })
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const rowOf = (view: HTMLElement, name: string) =>
  within(view)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(name))!
const player = () => document.querySelector('audio')!
// The browser has read the file's header: its length is known.
async function loaded(duration: number) {
  Object.defineProperty(player(), 'duration', { value: duration, configurable: true })
  await act(async () => {
    player().dispatchEvent(new Event('loadedmetadata'))
  })
}
// The audio plays on to a time, as the browser reports it.
function reach(seconds: number) {
  act(() => {
    player().currentTime = seconds
    player().dispatchEvent(new Event('timeupdate'))
  })
}

// jsdom has no media playback: play and pause only flip `paused` and say so.
let play: ReturnType<typeof vi.fn>
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  listed = []
  workList = null
  retries.length = 0
  mockGateway()
  play = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (this.paused) return
    Object.defineProperty(this, 'paused', { value: true, configurable: true })
    this.dispatchEvent(new Event('pause'))
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('All Recordings (CP-12)', () => {
  it('lists every recording kept on an observation not deleted, with where it stands', async () => {
    listed = [VALVE_OBS, PERMIT_OBS, RISER_OBS, DELETED_OBS]
    const view = await openRecordings()

    expect(screen.getByRole('heading', { name: 'All Recordings' })).toBeInTheDocument()
    // The Observations tab stays selected while it shows.
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('4 recordings across 2 locations')).toBeInTheDocument()
    expect(within(view).getAllByRole('listitem')).toHaveLength(4)
    for (const name of ['Recording 1', 'Recording 2', 'Recording 3', 'Recording 4'])
      expect(within(view).getByRole('button', { name: 'Play ' + name })).toBeInTheDocument()
    // Not a removed recording, nor a deleted observation's.
    expect(within(view).queryByText('Recording 0')).not.toBeInTheDocument()
    expect(within(view).queryByText('Recording 9')).not.toBeInTheDocument()
    expect(within(view).queryByText(GONE)).not.toBeInTheDocument()

    // Each row names its observation, location and category.
    const permit = rowOf(view, 'Recording 3')
    expect(within(permit).getByRole('button', { name: PERMIT })).toBeInTheDocument()
    expect(permit).toHaveTextContent('Pump house')
    expect(permit).toHaveTextContent('Occupancy')
    expect(permit).toHaveTextContent('Transcribing')
    // A finished one says nothing more; a failed one says so, with Retry.
    expect(rowOf(view, 'Recording 1')).not.toHaveTextContent(/Transcribing|Couldn’t/)
    expect(within(rowOf(view, 'Recording 4')).getByText('Couldn’t transcribe')).toBeInTheDocument()
    expect(within(view).getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('retries a failed transcription in place', async () => {
    listed = [RISER_OBS]
    const view = await openRecordings()

    fireEvent.click(within(rowOf(view, 'Recording 4')).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(retries).toEqual(['o3/r4']))
    expect(await within(view).findByText('Transcribing')).toBeInTheDocument()
    expect(within(view).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('offers no Retry in someone else’s assessment, though it still plays', async () => {
    workList = [assessment(OTHER)]
    listed = [RISER_OBS]
    const view = await openRecordings()

    expect(within(view).getByText('Couldn’t transcribe')).toBeInTheDocument()
    expect(within(view).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(within(view).getByRole('button', { name: 'Play Recording 4' })).toBeInTheDocument()
  })

  it('opens a row’s observation, and Back returns to All Recordings', async () => {
    listed = [VALVE_OBS, PERMIT_OBS]
    const view = await openRecordings()

    fireEvent.click(within(rowOf(view, 'Recording 3')).getByRole('button', { name: PERMIT }))

    expect(screen.queryByRole('group', { name: 'Recordings' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recording 3' })).toBeInTheDocument()
    click('Back to All Recordings')
    expect(screen.getByRole('group', { name: 'Recordings' })).toBeInTheDocument()
  })

  it('plays one recording at a time, with a seek bar, its time and the speed', async () => {
    listed = [VALVE_OBS]
    const view = await openRecordings()

    // Nothing plays yet, so no row has a seek bar.
    expect(within(view).queryByRole('slider')).not.toBeInTheDocument()
    click('Play Recording 1')
    await loaded(75)

    expect(play).toHaveBeenCalledTimes(1)
    expect(player()).toHaveAttribute('src', '/api/observations/o/recordings/r1/audio')
    const first = rowOf(view, 'Recording 1')
    const bar = within(first).getByRole('slider', { name: 'Position in Recording 1' })
    expect(bar).toHaveAttribute('max', '75')
    expect(within(first).getByRole('button', { name: 'Pause Recording 1' })).toBeInTheDocument()

    reach(42)
    expect(first).toHaveTextContent('0:42 / 1:15')
    expect(bar).toHaveAttribute('aria-valuetext', '0:42 of 1:15')

    // Dragging, and the arrow keys five seconds at a time.
    fireEvent.change(bar, { target: { value: '10' } })
    expect(player().currentTime).toBe(10)
    expect(first).toHaveTextContent('0:10 / 1:15')
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(player().currentTime).toBe(15)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(player().currentTime).toBe(0)

    // The speed goes 1×, 1.5×, 2× and round again.
    click('Playback speed 1×')
    expect(player().playbackRate).toBe(1.5)
    click('Playback speed 1.5×')
    expect(player().playbackRate).toBe(2)

    // Paused, the bar stays to move about in.
    click('Pause Recording 1')
    expect(within(first).getByRole('button', { name: 'Play Recording 1' })).toBeInTheDocument()
    expect(within(first).getByRole('slider')).toBeInTheDocument()

    // Another recording takes over the player, at the speed chosen.
    click('Play Recording 2')
    await loaded(30)
    expect(within(first).queryByRole('slider')).not.toBeInTheDocument()
    const second = rowOf(view, 'Recording 2')
    expect(within(second).getByRole('slider', { name: 'Position in Recording 2' })).toHaveAttribute(
      'max',
      '30',
    )
    expect(player().playbackRate).toBe(2)
    expect(within(second).getByRole('button', { name: 'Playback speed 2×' })).toBeInTheDocument()

    // Played to the end, it puts its bar away.
    act(() => {
      player().dispatchEvent(new Event('ended'))
    })
    expect(within(view).queryByRole('slider')).not.toBeInTheDocument()
  })

  it('plays only a site walk clip’s own part of the walk', async () => {
    listed = [
      observation({
        note: VALVE,
        recordings: [recording('r5', 'Walk clip', {}, { clip: { start: 120, end: 150 } })],
      }),
    ]
    const view = await openRecordings()

    click('Play Walk clip')
    await loaded(900)

    // The bar runs from the clip's start to its end, not the walk's.
    const bar = within(view).getByRole('slider', { name: 'Position in Walk clip' })
    expect(bar).toHaveAttribute('max', '30')
    expect(player().currentTime).toBe(120)
    reach(130)
    expect(view).toHaveTextContent('0:10 / 0:30')
    fireEvent.change(bar, { target: { value: '25' } })
    expect(player().currentTime).toBe(145)

    // At the clip's end it stops, as the walk goes on past it.
    reach(150)
    expect(player().paused).toBe(true)
    expect(within(view).queryByRole('slider')).not.toBeInTheDocument()
  })

  it('opens a transcript, as corrected, and opens it by itself when the recording plays', async () => {
    listed = [
      observation({
        note: VALVE,
        recordings: [
          recording('r1', 'Recording 1', { transcript: 'Valve V-12 chained open.' }),
          recording('r2', 'Recording 2', {
            transcript: 'Valve V-21 chaned shut.',
            correction: { text: 'Valve V-21 chained shut.', at: AT, by: ME },
          }),
        ],
      }),
      PERMIT_OBS,
    ]
    const view = await openRecordings()

    // Closed to start with; nothing to open while it is still transcribing.
    expect(within(view).queryByText('Valve V-12 chained open.')).not.toBeInTheDocument()
    expect(
      within(rowOf(view, 'Recording 3')).queryByRole('button', { name: /^Transcript/ }),
    ).toBeNull()

    const first = rowOf(view, 'Recording 1')
    const toggle = within(first).getByRole('button', { name: 'Transcript of Recording 1' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(first).getByText('Valve V-12 chained open.')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(within(first).queryByText('Valve V-12 chained open.')).not.toBeInTheDocument()

    // Playing it opens its transcript to read along: the engineer's correction.
    const second = rowOf(view, 'Recording 2')
    click('Play Recording 2')
    await loaded(20)
    expect(within(second).getByText('Valve V-21 chained shut.')).toBeInTheDocument()
    expect(second).not.toHaveTextContent('chaned')
    expect(
      within(second).getByRole('button', { name: 'Transcript of Recording 2' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('says when there are no recordings yet', async () => {
    listed = [observation({ note: 'Typed note only.' })]
    await openObservations()

    click('All recordings')

    expect(screen.getByText('No recordings yet')).toBeInTheDocument()
    click('Back to Observations')
    expect(screen.getByRole('button', { name: /Typed note only\./ })).toBeInTheDocument()
  })
})

// Searching All Recordings (CP-13): by transcript as corrected, name or the
// observation's text, every word in any order.
describe('Searching All Recordings (CP-13)', () => {
  const searchBox = () => screen.getByRole('searchbox', { name: 'Search recordings' })
  const search = (text: string) => fireEvent.change(searchBox(), { target: { value: text } })
  const marks = (el: HTMLElement) =>
    [...el.querySelectorAll('mark.ob-hit')].map((m) => m.textContent)
  const SILENT_OBS = observation({
    id: 'o5',
    note: 'Silent clip.',
    location: PUMP_HOUSE,
    recordings: [recording('r5', 'Recording 5', { transcript: '' })],
  })
  const FORKLIFT_OBS = observation({
    id: 'o6',
    note: 'Sprinkler riser checked.',
    recordings: [recording('r6', 'Recording 6', { transcript: 'Forklift parked in the aisle.' })],
  })

  it('lists only the recordings holding every word, and marks them in the open transcript', async () => {
    listed = [VALVE_OBS, PERMIT_OBS, RISER_OBS, SILENT_OBS, FORKLIFT_OBS]
    const view = await openRecordings()
    expect(screen.getByText('6 recordings across 2 locations')).toBeInTheDocument()

    // In the transcript, in any order and any case: its text opens, marked.
    search('OPEN v-12')
    expect(within(view).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('2 of 6 recordings')).toBeInTheDocument()
    const first = rowOf(view, 'Recording 1')
    expect(
      within(first).getByRole('button', { name: 'Transcript of Recording 1' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(marks(first)).toEqual(['V-12', 'open'])

    // One word in the transcript, the other in the observation's text.
    search('forklift sprinkler')
    expect(within(view).getAllByRole('listitem')).toHaveLength(1)
    const forklift = rowOf(view, 'Recording 6')
    expect(marks(forklift)).toEqual(['Sprinkler', 'Forklift'])

    // One still transcribing, or failed, is found by its observation's text or name.
    search('permit')
    expect(within(view).getAllByRole('listitem')).toHaveLength(1)
    expect(rowOf(view, 'Recording 3')).toHaveTextContent('Transcribing')
    search('recording 4')
    const [failed] = within(view).getAllByRole('listitem')
    expect(within(view).getAllByRole('listitem')).toHaveLength(1)
    expect(failed).toHaveTextContent('Recording 4')
    expect(failed).toHaveTextContent('Couldn’t transcribe')
    // Its name's words are marked, each on its own.
    expect(marks(failed)).toEqual(['Recording', '4'])
  })

  it('says when none match, never finding words in a recording with no speech', async () => {
    listed = [VALVE_OBS, SILENT_OBS]
    const view = await openRecordings()

    search('speech')

    expect(screen.getByText('No recordings match “speech”')).toBeInTheDocument()
    expect(screen.getByText('0 of 3 recordings')).toBeInTheDocument()
    expect(within(view).queryAllByRole('listitem')).toHaveLength(0)
    click('Clear search')
    expect(searchBox()).toHaveValue('')
    expect(within(view).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('3 recordings across 2 locations')).toBeInTheDocument()
  })

  it('keeps the search through an observation and Back, and starts empty when opened again', async () => {
    listed = [VALVE_OBS, PERMIT_OBS]
    let view = await openRecordings()
    search('v-12')
    expect(screen.getByText('2 of 3 recordings')).toBeInTheDocument()

    fireEvent.click(within(rowOf(view, 'Recording 1')).getByRole('button', { name: VALVE }))
    click('Back to All Recordings')

    view = screen.getByRole('group', { name: 'Recordings' })
    expect(searchBox()).toHaveValue('v-12')
    expect(screen.getByText('2 of 3 recordings')).toBeInTheDocument()
    // The transcripts it found are open again.
    expect(marks(rowOf(view, 'Recording 1'))).toEqual(['V-12'])
    expect(marks(rowOf(view, 'Recording 2'))).toEqual(['V-12'])

    click('Back to Observations')
    click('All recordings')
    expect(searchBox()).toHaveValue('')
    expect(screen.getByText('3 recordings across 2 locations')).toBeInTheDocument()
  })

  it('stops the recording playing when a search leaves it out', async () => {
    listed = [VALVE_OBS, PERMIT_OBS]
    const view = await openRecordings()
    click('Play Recording 1')
    await loaded(75)

    // Still listed, it plays on.
    search('valve')
    expect(player().paused).toBe(false)
    expect(
      within(view).getByRole('slider', { name: 'Position in Recording 1' }),
    ).toBeInTheDocument()

    search('permit')
    expect(player().paused).toBe(true)
    expect(within(view).queryByRole('slider')).not.toBeInTheDocument()
    search('')
    expect(within(view).getByRole('button', { name: 'Play Recording 1' })).toBeInTheDocument()
  })
})

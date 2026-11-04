import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { ObservationNote } from './components/ObservationNote'
import { useObservationSave } from './useObservationSave'
import type {
  Assessment,
  SavedInterpretation,
  SavedPhotoReading,
  SavedObservation,
  SavedRecording,
  Stamp,
} from './api'
import { formatDayYearTime } from './format'

// Managing captured observations (CP-08, CP-22): status on each row, filters
// on type and status, note and transcript corrections, and deleting and
// restoring, all on the sample assessment's Observations tab. An observation
// is opened on its own page and edited in place.
const REF = 'RPT-2026-0411'
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', building: 'Warehouse', name: 'Bay 3 — north aisle', floor: 'Ground' }
const PUMP_HOUSE = { id: 'l3', building: null, name: 'Pump house', floor: null }
// The signed-in risk engineer (test/session.ts), and someone else.
const ME = { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' }
const OTHER = { id: '6ab39017e45cf009e4507799', name: 'Jide Okafor' }
const AT = '2026-10-07T06:30:00.000Z'
const STAMP: Stamp = { at: AT, by: ME }
const CAPTURED = '2026-09-29T08:10:00.000Z'

function recording(id: string, transcription: Partial<SavedRecording['transcription']>) {
  return {
    id,
    name: 'Recording 1',
    contentType: 'audio/webm',
    size: 1200,
    url: `/api/observations/o/recordings/${id}/audio`,
    transcription: {
      status: 'transcribed',
      transcript: null,
      correction: null,
      error: null,
      attempts: 1,
      ...transcription,
    },
    added: null,
  } satisfies SavedRecording
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
    recordedAt: CAPTURED,
    edited: null,
    deleted: null,
    ...fields,
  }
}
const NOTE = 'Hose reel H3 blocked by pallets.'
const VOICE = 'Valve V-12 chained open.'
const RISER = 'Sprinkler riser tagged out.'
const FAILED = 'The recording could not be transcribed.'
const NOTE_ONLY = observation({ id: 'o1', note: NOTE })
const VOICE_ONLY = observation({
  id: 'o2',
  location: PUMP_HOUSE,
  recordings: [recording('r2', { transcript: VOICE })],
})
const TRANSCRIBING = observation({
  id: 'o3',
  note: RISER,
  recordings: [recording('r3', { status: 'transcribing' })],
})
const FAILED_VOICE = observation({
  id: 'o4',
  recordings: [recording('r4', { status: 'failed', error: 'Whisper timed out.' })],
})
// Observations with photos, and what the vision model proposes from them (CP-05).
const PHOTO = {
  id: 'p1',
  name: 'IMG_0460.jpg',
  contentType: 'image/jpeg' as const,
  size: 2000,
  url: '/api/observations/o6/photos/p1/image',
  added: null,
}
const PROPOSED =
  'During the site visit to Bay 3, it was observed that the new racking sits under two sprinkler heads.'
// The photos' part of a proposal (CP-21), described and up to date.
function described(fields: Partial<SavedPhotoReading> = {}): SavedPhotoReading {
  return {
    status: 'interpreted',
    description: PROPOSED,
    hazardType: 'Sprinkler Installation',
    error: null,
    attempts: 1,
    model: 'gemini-3.8-flash',
    photoIds: ['p1'],
    outOfDate: false,
    ...fields,
  }
}
function photographed(id: string, note: string, interpretation: Partial<SavedInterpretation>) {
  return observation({
    id,
    note,
    copeDimensions: ['Occupancy'],
    photos: [{ ...PHOTO, url: `/api/observations/${id}/photos/p1/image` }],
    interpretation: {
      status: 'interpreted',
      photos: null,
      categories: [],
      error: null,
      attempts: 1,
      model: null,
      photoIds: ['p1'],
      items: [
        { label: 'Note', kind: 'note', id: null, leftOut: false },
        { label: 'IMG_0460.jpg', kind: 'photo', id: 'p1', leftOut: false },
      ],
      outOfDate: false,
      ...interpretation,
    },
  })
}
const READING = 'Racking photographed in the north aisle.'
const PROPOSAL = 'Bay 3 racking, two photos.'
const UNREAD = 'Riser room photographed.'
const INTERPRETING = photographed('o5', READING, { status: 'interpreting' })
const SHOWN = 'IMG_0460.jpg shows racking under two sprinkler heads.'
const INTERPRETED = photographed('o6', PROPOSAL, {
  photos: described(),
  // One category to add, and one the observation already has (CP-21).
  categories: [
    {
      category: 'Protection',
      reason: SHOWN,
      evidence: [{ item: 'IMG_0460.jpg', quote: null, verified: null }],
    },
    {
      category: 'Occupancy',
      reason: 'The note says racking was put up in Bay 3.',
      evidence: [{ item: 'Note', quote: 'Bay 3 racking', verified: true }],
    },
  ],
  model: 'gemini-3.8-flash',
})
const UNREAD_PHOTOS = photographed('o7', UNREAD, {
  status: 'failed',
  error: 'The photo service could not interpret the photos.',
})
// The sample assessment's own observations, kept in the browser.
const RACKING =
  'Pallet racking installed against north wall since last visit. Two ESFR heads obstructed.'
const PUMP_TEST =
  'Pump test certificate not produced on request. Site engineer believes it is held by the contractor.'
const SORTATION =
  'Sortation line controller is a single point of failure. Client quotes 14 weeks to replace.'

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

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A stand-in for the gateway, answering by route and applying each change to
// the listed observations as the gateway does. The work list is unreachable
// unless given, so the dashboard shows its sample rows. `refuse` answers a
// change instead, e.g. with a 400.
let listed: SavedObservation[] = []
let workList: Assessment[] | null = null
let offline = false
let refuse: ((method: string) => Promise<Response> | null) | null = null
const calls: { method: string; url: string; body?: unknown }[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (offline) return Promise.reject(new TypeError('Failed to fetch'))
    const method = init.method ?? 'GET'
    // Added recordings and photos arrive as a form (CP-08); calls name its files.
    const form = init.body instanceof FormData ? init.body : null
    const names = (part: string) => (form?.getAll(part) as File[]).map((file) => file.name)
    const body = form
      ? { recordings: names('recording'), photos: names('photo') }
      : init.body
        ? JSON.parse(String(init.body))
        : undefined
    if (method !== 'GET') calls.push({ method, url, body })
    const refused = refuse?.(method)
    if (refused) return refused
    if (url === '/api/assessments')
      return workList ? json(200, workList) : Promise.reject(new TypeError('Failed to fetch'))
    if (url === OBS_URL)
      return json(
        200,
        listed.filter((o) => !o.deleted),
      )
    if (url === OBS_URL + '?include=deleted') return json(200, listed)
    if (url === LOCATIONS_URL) return json(200, [BAY_3, PUMP_HOUSE])
    const match = url.match(/^\/api\/observations\/(\w+)(\/.*)?$/)
    if (match) {
      const [, id, rest = ''] = match
      const change = (fields: (o: SavedObservation) => Partial<SavedObservation>) => {
        listed = listed.map((o) => (o.id === id ? { ...o, ...fields(o) } : o))
        return json(
          200,
          listed.find((o) => o.id === id),
        )
      }
      // Both parts the first time, or the one part asked for (CP-21).
      if (method === 'POST' && rest === '/interpretation') {
        const part = (body as { part?: string } | undefined)?.part
        change((o) => ({
          interpretation: {
            photos: null,
            categories: [],
            attempts: 0,
            model: null,
            status: 'interpreted' as const,
            error: null,
            photoIds: [],
            items: [],
            outOfDate: false,
            ...o.interpretation,
            ...(part !== 'categories' &&
              o.photos.length > 0 && {
                photos: described({
                  status: 'interpreting',
                  description: null,
                  hazardType: null,
                  photoIds: o.photos.map((p) => p.id),
                }),
              }),
            ...(part !== 'description' && {
              status: 'interpreting' as const,
              error: null,
              photoIds: o.photos.map((p) => p.id),
              items: [
                ...(o.note
                  ? [{ label: 'Note', kind: 'note' as const, id: null, leftOut: false }]
                  : []),
                ...o.photos.map((p) => ({
                  label: p.name,
                  kind: 'photo' as const,
                  id: p.id,
                  leftOut: false,
                })),
              ],
              outOfDate: false,
            }),
          },
        }))
        return Promise.resolve(new Response(null, { status: 202 }))
      }
      if (method === 'PATCH') return change(() => ({ ...body, edited: STAMP }))
      if (method === 'DELETE' && rest === '') return change(() => ({ deleted: STAMP }))
      if (method === 'POST' && rest === '/restore') return change(() => ({ deleted: null }))
      if (method === 'POST' && rest === '/media')
        return change((o) => ({
          recordings: [
            ...o.recordings,
            ...names('recording').map((name, i) => ({
              ...recording('n' + i, { status: 'transcribing' }),
              name,
              added: STAMP,
            })),
          ],
          photos: [
            ...o.photos,
            ...names('photo').map((name, i) => ({
              ...PHOTO,
              id: 'np' + i,
              name,
              url: `/api/observations/${id}/photos/np${i}/image`,
              added: STAMP,
            })),
          ],
          interpretation: o.interpretation && { ...o.interpretation, outOfDate: true },
          edited: STAMP,
        }))
      // Removing and restoring a recording or photo (CP-08).
      const item = rest.match(/^\/(recordings|photos)\/(\w+)(\/restore)?$/)
      if (item && (method === 'DELETE' || item[3]))
        return change((o) => {
          const [, kind, itemId, restore] = item
          const recordings = kind === 'recordings'
          const kept = recordings ? o.recordings : o.photos
          const removed = recordings ? o.removedRecordings : o.removedPhotos
          const next = restore
            ? {
                kept: [...kept, ...removed.filter((i) => i.id === itemId)],
                removed: removed.filter((i) => i.id !== itemId),
              }
            : {
                kept: kept.filter((i) => i.id !== itemId),
                removed: [
                  ...removed,
                  ...kept.filter((i) => i.id === itemId).map((i) => ({ ...i, removed: STAMP })),
                ],
              }
          return {
            edited: STAMP,
            ...(recordings
              ? { recordings: next.kept, removedRecordings: next.removed }
              : { photos: next.kept, removedPhotos: next.removed }),
          } as Partial<SavedObservation>
        })
      const transcript = rest.match(/^\/recordings\/(\w+)\/transcript$/)
      if (method === 'PUT' && transcript)
        return change((o) => ({
          edited: STAMP,
          recordings: o.recordings.map((r) =>
            r.id === transcript[1]
              ? {
                  ...r,
                  transcription: { ...r.transcription, correction: { text: body.text, ...STAMP } },
                }
              : r,
          ),
        }))
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

async function openObservations() {
  // A second render in one test starts on the work list, as a new test does.
  window.history.replaceState(null, '', '/')
  render(<App />)
  await signIn()
  // Grouped by client (CP-23), the list's rows are replaced when the gateway answers,
  // so wait for that answer, then click the row once.
  if (workList)
    await screen.findByText(`${workList.length} assessment${workList.length === 1 ? '' : 's'}`)
  else await screen.findByText('Showing sample assessments')
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  // The sample observations show straight away; wait for the gateway's.
  if (!offline && listed.length)
    await screen.findByRole('button', { name: new RegExp(listed[0].note ?? FAILED) })
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// An observation's row, by the start of its summary.
const row = (summary: string) =>
  screen.getByRole('button', { name: new RegExp(summary.slice(0, 20)) })
// Opens a filter's menu by its name ("Type", or "Type: Voice" once set) and
// picks an item by what it says.
function filter(name: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name + '(:|$)') }))
  fireEvent.click(
    within(screen.getByRole('menu', { name })).getByRole('menuitemradio', { name: option }),
  )
}
const menuLabels = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
  const menu = screen.getByRole('menu', { name })
  return [...menu.querySelectorAll('[role^=menuitem]')].map((o) => o.textContent)
}
// Which of these observations the list shows, by their summary.
const shown = (...summaries: string[]) => summaries.filter((text) => screen.queryByText(text))
const showDeleted = () => click(/^Deleted observations \(\d+\)$/)
const hideDeleted = () => click('Back to Observations')
// Back from an observation's page to the list.
const backToList = () => click('Back to Observations')
// Types into the note on the page; it saves when the engineer leaves the box.
function typeNote(text: string) {
  const box = screen.getByRole('textbox', { name: 'Note' })
  fireEvent.change(box, { target: { value: text } })
  fireEvent.blur(box)
  return box
}
// The status line on an observation's page.
const saved = () => screen.findByText('Saved')

beforeAll(() => {
  // jsdom cannot preview files; the lists only need a URL to hand over.
  URL.createObjectURL = () => 'blob:media'
  URL.revokeObjectURL = () => {}
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  listed = [NOTE_ONLY]
  workList = null
  offline = false
  refuse = null
  calls.length = 0
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Listing and filtering observations (CP-08 AC1-AC3)', () => {
  it('shows each observation’s status', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY, TRANSCRIBING, FAILED_VOICE]
    await openObservations()
    // The capture time carries its year, in local time.
    expect(formatDayYearTime(new Date(2026, 8, 29, 8, 10))).toBe('29 Sep 2026 08:10')

    const expected = [
      [NOTE, 'Complete'],
      [VOICE, 'Complete'],
      [RISER, 'Transcribing'],
      [FAILED, 'Transcription failed'],
    ] as const
    for (const [summary, status] of expected)
      expect(within(row(summary)).getByText(status)).toBeInTheDocument()
  })

  it('filters by type and status, alone or with other filters', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY, TRANSCRIBING, FAILED_VOICE]
    await openObservations()
    const ALL = [NOTE, VOICE, RISER, FAILED, RACKING, PUMP_TEST, SORTATION]
    expect(menuLabels('Type')).toEqual(['All types', 'Note', 'Voice', 'Photo', 'Scan'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(menuLabels('Status')).toEqual([
      'All statuses',
      'Transcribing',
      'Interpreting',
      'Transcription failed',
      'Interpretation failed',
      'Complete',
    ])
    fireEvent.keyDown(document.body, { key: 'Escape' })

    // One with a note and a recording is both types; the sample pump test has a voice clip.
    filter('Type', 'Voice')
    expect(shown(...ALL)).toEqual([VOICE, RISER, FAILED, PUMP_TEST])
    filter('Type', 'Note')
    expect(shown(...ALL)).toEqual([NOTE, RISER, RACKING, PUMP_TEST, SORTATION])
    fireEvent.click(screen.getByRole('button', { name: 'Clear type filter' }))
    expect(shown(...ALL)).toEqual(ALL)

    filter('Status', 'Transcription failed')
    expect(shown(...ALL)).toEqual([FAILED])
    filter('Type', 'Note')
    expect(shown(...ALL)).toEqual([])
    expect(screen.getByText('No observations match those filters')).toBeInTheDocument()
  })
}, 15000)

describe('Proposals from an observation (CP-05, CP-21)', () => {
  it('shows where interpretation stands, and filters on it (AC2)', async () => {
    listed = [INTERPRETING, INTERPRETED, UNREAD_PHOTOS]
    await openObservations()

    expect(within(row(READING)).getByText('Interpreting')).toBeInTheDocument()
    expect(within(row(PROPOSAL)).getByText('Complete')).toBeInTheDocument()
    expect(within(row(UNREAD)).getByText('Interpretation failed')).toBeInTheDocument()
    const ALL = [READING, PROPOSAL, UNREAD, RACKING]
    filter('Status', 'Interpreting')
    expect(shown(...ALL)).toEqual([READING])
    filter('Status', 'Interpretation failed')
    expect(shown(...ALL)).toEqual([UNREAD])
  })

  it('shows each suggested category with its reason, and the photo description', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    const proposal = screen.getByRole('region', { name: 'AI suggestions' })
    const categories = within(proposal).getByRole('list', { name: 'Suggested categories' })
    // Each category's row, found by its action (rows also hold a list of evidence).
    const protection = within(categories)
      .getByRole('button', { name: 'Add Protection' })
      .closest('li')!
    const occupancy = within(categories).getByText('Added').closest('li')!
    expect(within(protection).getByText(SHOWN)).toBeInTheDocument()
    expect(within(protection).getByRole('button', { name: 'Add Protection' })).toBeInTheDocument()
    // Already one of its own: marked, not offered.
    expect(within(occupancy).getByText('Added')).toBeInTheDocument()
    expect(within(occupancy).queryByRole('button')).not.toBeInTheDocument()
    // The photos' description sits under the photos themselves (round 6).
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByText(PROPOSED)).toBeInTheDocument()
    // Up to date, so no warning, but another reading can still be asked for.
    expect(screen.queryByText('Its evidence changed since.')).not.toBeInTheDocument()
    // Each part is asked for again on its own (CP-21).
    expect(within(proposal).getAllByRole('button', { name: 'Suggest again' })).toHaveLength(1)
    expect(within(photos).getAllByRole('button', { name: 'Describe again' })).toHaveLength(1)
  })

  it('copies the description into the note only when the engineer asks (Copy into note)', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))
    expect(calls).toEqual([])

    click('Copy into note')

    // Added below what the engineer wrote, never in place of it, and saved at once.
    const note = PROPOSAL + '\n\n' + PROPOSED
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls).toEqual([{ method: 'PATCH', url: '/api/observations/o6', body: { note } }])
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(note))
    // The note holds it now, so it is no longer offered.
    expect(screen.queryByRole('button', { name: 'Copy into note' })).not.toBeInTheDocument()
  })

  it('copies into the note only after a note save on its way, below what was typed', async () => {
    listed = [INTERPRETED]
    // The first PATCH (the typed note) waits until the test lets it through.
    let release: () => void = () => {}
    let held = false
    refuse = (method) => {
      if (method !== 'PATCH' || held) return null
      held = true
      return new Promise<Response>(
        (r) => (release = () => r(json(200, { ...INTERPRETED, note: 'Typed on site.' }))),
      )
    }
    await openObservations()
    fireEvent.click(row(PROPOSAL))
    typeNote('Typed on site.')
    // Without this, copying used the note from before and wrote over the typed text.
    expect(screen.getByRole('button', { name: 'Copy into note' })).toBeDisabled()
    await vi.waitFor(() => expect(held).toBe(true))
    await act(async () => release())
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy into note' })).toBeEnabled(),
    )
    click('Copy into note')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({ note: 'Typed on site.\n\n' + PROPOSED })
  })

  it('adds a suggested category only when the engineer asks, to those it has', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))
    expect(calls).toEqual([])

    click('Add Protection')

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    // Added to the category it has, not in place of it.
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: '/api/observations/o6',
        body: { copeDimensions: ['Occupancy', 'Protection'] },
      },
    ])
    // Now it is filed under it, so it is no longer offered.
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add Protection' })).not.toBeInTheDocument(),
    )
    expect(screen.getAllByText('Added')).toHaveLength(2)
  })

  it('suggests the categories again alone, keeping the description (CP-21)', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    click('Suggest again')

    await vi.waitFor(() =>
      expect(calls).toEqual([
        {
          method: 'POST',
          url: '/api/observations/o6/interpretation',
          body: { part: 'categories' },
        },
      ]),
    )
    expect(await screen.findByText('Reading…')).toBeInTheDocument()
    expect(screen.getByText(PROPOSED)).toBeInTheDocument()
  })

  it('describes the photos again alone, keeping the categories (CP-21)', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    click('Describe again')

    await vi.waitFor(() =>
      expect(calls).toEqual([
        {
          method: 'POST',
          url: '/api/observations/o6/interpretation',
          body: { part: 'description' },
        },
      ]),
    )
    expect(await screen.findByText('Reading…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Protection' })).toBeInTheDocument()
  })

  it('suggests categories only for an observation without photos', async () => {
    const SPOKEN = 'Sprinkler valve found shut.'
    listed = [
      observation({
        id: 'o9',
        note: SPOKEN,
        copeDimensions: null,
        recordings: [
          recording('r1', { transcript: VOICE }),
          recording('r2', { status: 'failed', error: FAILED }),
        ],
        interpretation: {
          status: 'interpreted',
          photos: null,
          categories: [
            {
              category: 'Protection',
              reason: 'The note says the sprinkler valve was found shut.',
              evidence: [{ item: 'Note', quote: 'valve found shut', verified: true }],
            },
          ],
          error: null,
          attempts: 1,
          model: 'gemini-3.8-flash',
          photoIds: [],
          items: [
            { label: 'Note', kind: 'note', id: null, leftOut: false },
            { label: 'Recording r1', kind: 'recording', id: 'r1', leftOut: false },
            { label: 'Recording r2', kind: 'recording', id: 'r2', leftOut: true },
          ],
          outOfDate: false,
        },
      }),
    ]
    await openObservations()
    fireEvent.click(row(SPOKEN))

    const proposal = screen.getByRole('region', { name: 'AI suggestions' })
    expect(within(proposal).getByRole('button', { name: 'Add Protection' })).toBeInTheDocument()
    // Only photos are described.
    expect(within(proposal).queryByText('From the photos')).not.toBeInTheDocument()
    expect(
      within(proposal).queryByRole('button', { name: 'Copy into note' }),
    ).not.toBeInTheDocument()
  })

  it('shows why reading failed and retries it', async () => {
    listed = [UNREAD_PHOTOS]
    await openObservations()
    fireEvent.click(row(UNREAD))

    expect(
      screen.getByText('The photo service could not interpret the photos.'),
    ).toBeInTheDocument()
    click('Retry')

    await vi.waitFor(() =>
      expect(calls).toEqual([
        {
          method: 'POST',
          url: '/api/observations/o7/interpretation',
          body: { part: 'categories' },
        },
      ]),
    )
    expect(await screen.findByText('Reading…')).toBeInTheDocument()
  })

  // Suggest categories is the first item of the observation page's category menu.
  const suggestCategories = () => {
    click(/^Category:/)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Suggest categories' }))
  }

  it('says once when to try again, when the gateway already says so', async () => {
    const waiting =
      'Its recordings and pages are still being transcribed. Try again once they finish.'
    refuse = (method) => (method === 'POST' ? json(409, { error: waiting }) : null)
    listed = [NOTE_ONLY]
    await openObservations()
    fireEvent.click(row(NOTE))

    suggestCategories()

    // Not "…once they finish. Try again."
    expect(await screen.findByText(waiting)).toBeInTheDocument()
  })

  it('reads any observation, photos or not, only when the engineer asks (AC7)', async () => {
    listed = [NOTE_ONLY]
    await openObservations()
    // Nothing is running.
    expect(within(row(NOTE)).getByText('Complete')).toBeInTheDocument()
    fireEvent.click(row(NOTE))

    // The card is there but unread: nothing is sent until Get AI proposal is pressed.
    const card = screen.getByRole('region', { name: 'AI suggestions' })
    expect(calls).toEqual([])
    fireEvent.click(within(card).getByRole('button', { name: 'Get AI proposal' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([
        { method: 'POST', url: '/api/observations/o1/interpretation', body: undefined },
      ]),
    )
    expect(await screen.findByText('Reading…')).toBeInTheDocument()
  })

  it('labels the sample assessment’s suggestion as a sample, not a reading', async () => {
    listed = []
    await openObservations()
    fireEvent.click(row(RACKING))

    const proposal = screen.getByRole('region', { name: 'AI suggestions' })
    expect(
      within(proposal).getByText('A sample suggestion: this demo has no capture session.'),
    ).toBeInTheDocument()
  })
}, 15000)

describe('Moving between observations (CP-22)', () => {
  it('steps through every observation in list order, whatever its location', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY, TRANSCRIBING]
    await openObservations()
    fireEvent.click(row(NOTE))

    // The line under the path says where this one sits among all of them.
    expect(screen.getByText(/^\d of \d+$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }))

    // The next one in the list opens, even at another location.
    expect(await screen.findByText(/^\d of \d+$/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue(NOTE)).not.toBeInTheDocument()
  })

  it('runs from the first observation to the last, each end switching its arrow off', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY]
    await openObservations()
    fireEvent.click(row(NOTE))

    const arrow = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
    while (!arrow('Next observation').disabled) fireEvent.click(arrow('Next observation'))
    // The sample observations are in the list too, so the end is the whole list's.
    expect(await screen.findByText(/^(\d+) of \1$/)).toBeInTheDocument()
    while (!arrow('Previous observation').disabled) fireEvent.click(arrow('Previous observation'))
    expect(screen.getByText(/^1 of \d+$/)).toBeInTheDocument()
  })
}, 15000)

describe('Correcting an observation (CP-08 AC8-AC11, AC18)', () => {
  it('saves an edited note exactly as typed when the engineer leaves it, and says who edited it', async () => {
    await openObservations()
    fireEvent.click(row(NOTE))
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(NOTE)

    const text = '  Hose reel H3 cleared after the visit.\nRecheck at close.'
    typeNote(text)

    await saved()
    expect(calls).toEqual([{ method: 'PATCH', url: '/api/observations/o1', body: { note: text } }])
    expect(
      screen.getByText('Edited by Alex Rowe · ' + formatDayYearTime(new Date(AT))),
    ).toBeInTheDocument()
    backToList()
    expect(row('Hose reel H3 cleared')).toBeInTheDocument()
  })

  it('keeps the typed note when the gateway refuses to remove it', async () => {
    const reason = 'An observation needs a note or a recording, so this note can’t be removed.'
    refuse = (method) =>
      method === 'PATCH'
        ? json(400, { error: 'The observation details are invalid.', fields: { note: reason } })
        : null
    await openObservations()
    fireEvent.click(row(NOTE))

    const box = typeNote('  ')

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: ' + reason)
    // A blank note is sent as removing it, and stays in the box.
    expect(calls.map((c) => c.body)).toEqual([{ note: null }])
    expect(box).toHaveValue('  ')
  })

  it('stays on the observation when leaving cannot save the note', async () => {
    refuse = (method) => (method === 'PATCH' ? json(503, { error: 'Unavailable' }) : null)
    await openObservations()
    fireEvent.click(row(NOTE))
    const box = typeNote('Edited while offline.')
    backToList()
    // Without this, the page closed and the only copy of the edit was lost.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(box).toBeInTheDocument()
    expect(box).toHaveValue('Edited while offline.')
  })

  it('corrects only a finished transcript', async () => {
    listed = [VOICE_ONLY, TRANSCRIBING, FAILED_VOICE]
    await openObservations()
    for (const summary of [RISER, FAILED]) {
      fireEvent.click(row(summary))
      expect(screen.queryByRole('button', { name: 'Edit text' })).not.toBeInTheDocument()
      backToList()
    }

    fireEvent.click(row(VOICE))
    click('Edit text')
    const dialog = await screen.findByRole('dialog', { name: 'Edit transcript' })
    const box = within(dialog).getByLabelText('Transcript')
    expect(box).toHaveValue(VOICE)
    const corrected = 'Valve V-12 chained open, its tag missing.'
    fireEvent.change(box, { target: { value: corrected } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('Transcript corrected. Report drafting uses your wording.'),
    ).toBeInTheDocument()
    expect(calls).toEqual([
      {
        method: 'PUT',
        url: '/api/observations/o2/recordings/r2/transcript',
        body: { text: corrected },
      },
    ])
    // The observation now reads as the correction, and says who made it.
    expect(screen.getByText(corrected)).toBeInTheDocument()
    expect(
      screen.getByText('Corrected by Alex Rowe · ' + formatDayYearTime(new Date(AT))),
    ).toBeInTheDocument()
    backToList()
    expect(row(corrected)).toBeInTheDocument()
  })
}, 15000)

describe('Deleting and restoring an observation (CP-08 AC12-AC14)', () => {
  it('deletes one once confirmed, counts it, and restores it from Deleted observations', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY]
    await openObservations()
    fireEvent.click(row(NOTE))
    // The page's bin (icon only since round 6).
    click('Delete observation')
    const dialog = await screen.findByRole('dialog', { name: 'Delete this observation?' })
    expect(dialog).toHaveTextContent('It moves to Deleted observations, where you can restore it.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/^Observation deleted\./)).toBeInTheDocument()
    expect(calls).toEqual([{ method: 'DELETE', url: '/api/observations/o1', body: undefined }])
    expect(shown(NOTE, VOICE)).toEqual([VOICE])

    // The button counts the deleted ones, and lists only them.
    expect(screen.getByRole('button', { name: 'Deleted observations (1)' })).toBeInTheDocument()
    showDeleted()
    const deleted = await screen.findByRole('button', { name: /^Hose reel/ })
    expect(shown(VOICE, RACKING)).toEqual([])
    expect(screen.getByRole('button', { name: /^Restore Hose reel/ })).toBeInTheDocument()
    fireEvent.click(deleted)
    expect(
      screen.getByText('Deleted by Alex Rowe · ' + formatDayYearTime(new Date(AT))),
    ).toBeInTheDocument()
    // A deleted one changes only by being restored.
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
    click('Restore')

    expect(
      await screen.findByText('Observation restored. Report drafting uses it again.'),
    ).toBeInTheDocument()
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/observations/o1/restore' })
    expect(screen.getByText('No deleted observations')).toBeInTheDocument()
    hideDeleted()
    expect(shown(NOTE, VOICE)).toEqual([NOTE, VOICE])
    // The button is back to showing them, with none left deleted.
    expect(screen.getByRole('button', { name: 'Deleted observations (0)' })).toBeInTheDocument()
  })

  it('keeps the dialog open with the reason when a delete is refused', async () => {
    refuse = (method) =>
      method === 'DELETE' ? json(409, { error: 'Assessment RPT-2026-0411 is archived.' }) : null
    await openObservations()
    fireEvent.click(row(NOTE))
    click('Delete observation')
    const dialog = await screen.findByRole('dialog', { name: 'Delete this observation?' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Assessment RPT-2026-0411 is archived.',
    )
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(NOTE)
  })

  it('edits, deletes and restores a sample observation in this demo only', async () => {
    offline = true
    await openObservations()

    fireEvent.click(row(SORTATION))
    typeNote('Sortation controller has no standby unit.')
    await saved()

    click('Delete observation')
    const confirm = await screen.findByRole('dialog', { name: 'Delete this observation?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText(
        'Observation deleted in this demo only. Choose Deleted to restore it.',
      ),
    ).toBeInTheDocument()
    expect(shown(RACKING, PUMP_TEST)).toEqual([RACKING, PUMP_TEST])

    showDeleted()
    fireEvent.click(screen.getByRole('button', { name: /^Sortation controller has no standby/ }))
    click('Restore')
    expect(await screen.findByText('Observation restored in this demo only.')).toBeInTheDocument()
    expect(calls).toEqual([])
  })
}, 15000)

describe('Who can change an observation (CP-08 AC17)', () => {
  it('offers changes only to the engineer assigned to the assessment', async () => {
    for (const [engineer, offered] of [
      [OTHER, false],
      [ME, true],
    ] as const) {
      workList = [assessment(engineer)]
      await openObservations()
      // A saved observation, and a sample one kept in the browser.
      for (const summary of [NOTE, SORTATION]) {
        fireEvent.click(row(summary))
        const changes = [
          screen.queryByRole('textbox', { name: 'Note' }),
          screen.queryByRole('button', { name: 'Delete observation' }),
          screen.queryByRole('button', { name: /^Severity: .*\. Change$/ }),
        ]
        for (const control of changes)
          if (offered) expect(control).toBeInTheDocument()
          else expect(control).not.toBeInTheDocument()
        backToList()
      }
      cleanup()
    }
  })
}, 15000)

describe('Adding and removing recordings and photos (CP-08)', () => {
  const photo = (name: string, type = 'image/jpeg') => new File(['jpeg'], name, { type })
  const at = formatDayYearTime(new Date(AT))
  // The action beside Edit.
  const addMedia = () => fireEvent.click(screen.getAllByRole('button', { name: 'Add media' })[0])
  const addDialog = () => screen.findByRole('dialog', { name: 'Add to observation' })
  const choose = (dialog: HTMLElement, ...files: File[]) =>
    fireEvent.change(within(dialog).getByLabelText('Choose photographs'), { target: { files } })
  const RISER_ROOM = 'Riser room door wedged open.'
  const WITH_BOTH = observation({
    id: 'o9',
    note: RISER_ROOM,
    recordings: [recording('r9', { transcript: VOICE })],
    photos: [{ ...PHOTO, url: '/api/observations/o9/photos/p1/image' }],
  })

  it('adds recordings and photos to a saved observation, from a list it builds first', async () => {
    await openObservations()
    fireEvent.click(row(NOTE))
    addMedia()
    const dialog = await addDialog()

    fireEvent.change(within(dialog).getByLabelText('Upload audio files'), {
      target: { files: [new File(['audio'], 'valve.m4a', { type: 'audio/mp4' })] },
    })
    choose(dialog, photo('IMG_0510.jpg'), photo('IMG_0511.HEIC', 'image/heic'))
    // Refused here, as on the capture screen.
    expect(within(dialog).getByRole('alert')).toHaveTextContent('IMG_0511.HEIC isn’t a JPG or PNG.')
    const ready = within(dialog).getByRole('region', { name: 'Ready to add' })
    expect(within(ready).getByText('valve.m4a')).toBeInTheDocument()
    expect(within(ready).getByText('IMG_0510.jpg')).toBeInTheDocument()
    expect(calls).toEqual([])
    click('Add to observation')

    expect(
      await screen.findByText('Added 1 recording and 1 photo. Transcribing 1 recording now.'),
    ).toBeInTheDocument()
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/observations/o1/media',
        body: { recordings: ['valve.m4a'], photos: ['IMG_0510.jpg'] },
      },
    ])
    // On the observation, with who added them and when.
    const clip = screen.getByRole('region', { name: 'valve.m4a' })
    expect(within(clip).getByText('Added by Alex Rowe · ' + at)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open IMG_0510.jpg' })).toBeInTheDocument()
    expect(screen.getByText('IMG_0510.jpg added by Alex Rowe · ' + at)).toBeInTheDocument()
  })

  it('keeps the list and says why when the gateway refuses it', async () => {
    refuse = (method) =>
      method === 'POST'
        ? json(415, {
            error:
              'IMG_0510.jpg is not a JPG or PNG image. Save it as JPG or PNG and add it again.',
          })
        : null
    await openObservations()
    fireEvent.click(row(NOTE))
    addMedia()
    const dialog = await addDialog()
    choose(dialog, photo('IMG_0510.jpg'))

    click('Add to observation')

    expect(
      await within(dialog).findByText(/^IMG_0510\.jpg is not a JPG or PNG image\..*still listed/),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('region', { name: 'Ready to add' })).toHaveTextContent(
      'IMG_0510.jpg',
    )
  })

  it('removes a recording once confirmed, and restores it from Removed media', async () => {
    listed = [WITH_BOTH]
    await openObservations()
    fireEvent.click(row(RISER_ROOM))

    // Each section's Remove is named after what it removes.
    click('Remove Recording 1')
    const dialog = await screen.findByRole('dialog', { name: 'Remove this recording?' })
    expect(dialog).toHaveTextContent('The report stops using its transcript')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove recording' }))

    expect(await screen.findByText(/^Recording removed\./)).toBeInTheDocument()
    expect(calls).toEqual([
      { method: 'DELETE', url: '/api/observations/o9/recordings/r9', body: undefined },
    ])
    expect(screen.queryByRole('region', { name: 'Recording 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Removed media (1)'))
    const removed = screen.getByRole('list', { name: 'Removed media' })
    expect(within(removed).getByText('Removed by Alex Rowe · ' + at)).toBeInTheDocument()

    fireEvent.click(within(removed).getByRole('button', { name: 'Restore Recording 1' }))

    expect(await screen.findByText(/^Recording restored\./)).toBeInTheDocument()
    expect(calls[1]).toEqual({
      method: 'POST',
      url: '/api/observations/o9/recordings/r9/restore',
      body: undefined,
    })
    expect(screen.getByRole('region', { name: 'Recording 1' })).toBeInTheDocument()
  })

  it('removes a photo, and keeps the dialog with the reason when it is refused', async () => {
    listed = [WITH_BOTH]
    refuse = (method) =>
      method === 'DELETE'
        ? json(409, {
            error:
              'An observation needs a note, a recording, a photo or a page, so this photo can’t be removed. Add what replaces it first.',
          })
        : null
    await openObservations()
    fireEvent.click(row(RISER_ROOM))

    click('Remove IMG_0460.jpg')
    const dialog = await screen.findByRole('dialog', { name: 'Remove this photo?' })
    expect(dialog).toHaveTextContent('where you can restore it')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove photo' }))

    expect(await within(dialog).findByText(/so this photo can’t be removed/)).toBeInTheDocument()
    refuse = null
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove photo' }))
    expect(
      await screen.findByText(/^Photo removed\. It leaves the Photos tab\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open IMG_0460.jpg' })).not.toBeInTheDocument()
  })

  it('offers Remove only while something else stays captured', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY]
    await openObservations()
    fireEvent.click(row(VOICE))

    expect(screen.queryByRole('button', { name: 'Remove Recording 1' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add media' }).length).toBeGreaterThan(0)
  })

  it('offers adding and removing only to the assigned engineer', async () => {
    workList = [assessment(OTHER)]
    listed = [WITH_BOTH]
    await openObservations()
    fireEvent.click(row(RISER_ROOM))

    expect(screen.queryAllByRole('button', { name: 'Add media' })).toEqual([])
    expect(screen.queryByRole('button', { name: 'Remove Recording 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove IMG_0460.jpg' })).not.toBeInTheDocument()
  })

  it('marks a description of photos since changed as out of date, and describes them again', async () => {
    listed = [
      {
        ...photographed('o6', PROPOSAL, {
          photos: described({ photoIds: ['p0'], outOfDate: true }),
          model: 'gemini-3.8-flash',
          photoIds: ['p0'],
          items: [{ label: 'IMG_0400.jpg', kind: 'photo', id: 'p0', leftOut: false }],
        }),
        removedPhotos: [
          {
            ...PHOTO,
            id: 'p0',
            name: 'IMG_0400.jpg',
            url: '/api/observations/o6/photos/p0/image',
            removed: STAMP,
          },
        ],
      },
    ]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    // The photos' description, under the photos (round 6).
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByText('Its evidence changed since.')).toBeInTheDocument()
    click('Describe again')

    await vi.waitFor(() =>
      expect(calls).toEqual([
        {
          method: 'POST',
          url: '/api/observations/o6/interpretation',
          body: { part: 'description' },
        },
      ]),
    )
    expect(await screen.findByText('Reading…')).toBeInTheDocument()
  })

  it('adds, removes and restores media of a sample observation in this demo only', async () => {
    offline = true
    await openObservations()
    fireEvent.click(row(SORTATION))
    addMedia()
    const dialog = await addDialog()
    expect(dialog).toHaveTextContent('No capture session, so these stay in this browser')
    choose(dialog, photo('IMG_0520.jpg'))

    click('Add to observation')
    expect(await screen.findByText('Added 1 photo in this demo only.')).toBeInTheDocument()

    click('Remove IMG_0520.jpg')
    const confirm = await screen.findByRole('dialog', { name: 'Remove this photo?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove photo' }))
    expect(
      await screen.findByText('Photo removed in this demo only. Restore it under Removed media.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Removed media (1)'))
    click('Restore IMG_0520.jpg')
    expect(await screen.findByText('Photo restored in this demo only.')).toBeInTheDocument()
    expect(calls).toEqual([])
  })
}, 15000)

describe('Site photographs (CP-04)', () => {
  const IMAGE_URL = '/api/observations/o9/photos/p1/image'
  const PHOTOGRAPHED = observation({
    id: 'o9',
    note: 'Riser room door wedged open.',
    photos: [
      {
        id: 'p1',
        name: 'IMG_0460.jpg',
        contentType: 'image/jpeg',
        size: 4,
        url: IMAGE_URL,
        added: null,
      },
    ],
  })
  const DELETED = observation({
    id: 'o10',
    note: 'Photo of the wrong building.',
    photos: [
      {
        id: 'p2',
        name: 'IMG_0999.jpg',
        contentType: 'image/jpeg',
        size: 4,
        url: '/x/image',
        added: null,
      },
    ],
    deleted: STAMP,
  })

  it('links each photo to its observation, opening the original in a popup (AC2)', async () => {
    listed = [PHOTOGRAPHED]
    await openObservations()

    fireEvent.click(row('Riser room door wedged open.'))

    fireEvent.click(screen.getByRole('button', { name: 'Open IMG_0460.jpg' }))
    const popup = screen.getByRole('dialog', { name: 'IMG_0460.jpg' })
    expect(within(popup).getByRole('img', { name: 'IMG_0460.jpg' })).toHaveAttribute(
      'src',
      IMAGE_URL,
    )
    // It zooms in to look closer, and back to fit the window.
    const zoomOut = within(popup).getByRole('button', { name: 'Zoom out' })
    expect(zoomOut).toBeDisabled()
    fireEvent.click(within(popup).getByRole('button', { name: 'Zoom in' }))
    expect(popup).toHaveTextContent('150%')
    expect(zoomOut).toBeEnabled()
    fireEvent.click(within(popup).getByRole('button', { name: 'Fit to window' }))
    expect(popup).toHaveTextContent('100%')
    fireEvent.click(within(popup).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists every photo in the collection, leaving deleted ones out (AC3)', async () => {
    listed = [PHOTOGRAPHED, DELETED]
    await openObservations()

    // The navigator's All photos opens the collection; there is no Photos tab (CP-22).
    expect(screen.queryByRole('tab', { name: /Photos/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All photos' }))

    const collection = screen.getByRole('group', { name: 'Site photographs' })
    // The saved photo, and the sample assessment's own two.
    expect(within(collection).getAllByRole('listitem')).toHaveLength(3)
    // The Observations tab stays selected, and leads back.
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(within(collection).getByRole('button', { name: 'Open IMG_0460.jpg' }))
    const popup = screen.getByRole('dialog', { name: 'IMG_0460.jpg' })
    expect(within(popup).getByRole('img', { name: 'IMG_0460.jpg' })).toHaveAttribute(
      'src',
      IMAGE_URL,
    )
    fireEvent.click(within(popup).getByRole('button', { name: 'Close' }))
    expect(within(collection).queryByText(/IMG_0999/)).not.toBeInTheDocument()

    // Each row names its observation, location and category, and the
    // observation's text opens it (CP-22 round 3).
    const saved = within(collection).getAllByRole('listitem')[0]
    expect(saved).toHaveTextContent('Warehouse')
    expect(saved).toHaveTextContent('Protection')
    fireEvent.click(within(saved).getByRole('button', { name: 'Riser room door wedged open.' }))
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Open IMG_0460.jpg' })).toBeInTheDocument()
  })

  it('leads Back from an observation opened in All Photos to All Photos, not the list', async () => {
    listed = [PHOTOGRAPHED]
    await openObservations()
    fireEvent.click(screen.getByRole('button', { name: 'All photos' }))
    const saved = within(screen.getByRole('group', { name: 'Site photographs' })).getAllByRole(
      'listitem',
    )[0]
    fireEvent.click(within(saved).getByRole('button', { name: 'Riser room door wedged open.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to All Photos' }))
    expect(screen.getByRole('group', { name: 'Site photographs' })).toBeInTheDocument()
  })
})

describe('The Observations tab header and selected location (CP-22 round 3)', () => {
  it('heads the list with All Observations and names the location picked above it', async () => {
    listed = [observation({ id: 'o9', note: 'Riser room door wedged open.' })]
    await openObservations()
    expect(screen.getByRole('heading', { name: 'All Observations' })).toBeInTheDocument()
    expect(screen.queryByText('Warehouse › Ground › Bay 3 — north aisle')).toBeNull()

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Locations' })).getAllByRole('button', {
        name: 'Bay 3 — north aisle',
      })[0],
    )
    expect(screen.getByText('Warehouse › Ground › Bay 3 — north aisle')).toBeInTheDocument()
  })

  it('offers a type and a status filter option with its icon, and each category its icon', async () => {
    listed = [observation({ id: 'o9', note: 'Riser room door wedged open.' })]
    await openObservations()
    for (const name of ['Type', 'Status', 'Category']) {
      fireEvent.click(screen.getByRole('button', { name }))
      const items = within(screen.getByRole('menu', { name })).getAllByRole('menuitemradio')
      // The first option is "All …", which has none.
      expect(
        items
          .slice(1)
          .map((i) => [name, i.textContent, !!i.querySelector('[style*=mask-image]')])
          .filter((x) => !x[2]),
      ).toEqual([])
      fireEvent.click(screen.getByRole('button', { name }))
    }
  })
})

describe('observation note', () => {
  it('keeps what was typed after leaving the box while that save was on its way', async () => {
    let finish: (ok: boolean) => void = () => {}
    const save = vi.fn(() => new Promise<boolean>((r) => (finish = r)))
    render(<ObservationNote note="Old" canChange save={save} />)
    const box = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(box, { target: { value: 'Saved text' } })
    fireEvent.blur(box)
    // The engineer types on before the save answers.
    fireEvent.change(box, { target: { value: 'Saved text, and more' } })
    await act(async () => finish(true))
    expect(box).toHaveValue('Saved text, and more')
  })

  it('saves a change back to the saved note while the first save is on its way', async () => {
    const save = vi.fn(() => new Promise<boolean>(() => {}))
    render(<ObservationNote note="A" canChange save={save} />)
    const box = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(box, { target: { value: 'B' } })
    fireEvent.blur(box)
    fireEvent.change(box, { target: { value: 'A' } })
    fireEvent.blur(box)
    // Without this, "A" looked unchanged and the pending "B" was what got saved.
    expect(save.mock.calls).toEqual([[{ note: 'B' }], [{ note: 'A' }]])
  })

  it('does not leave when an earlier save fails, even if a later one goes through', async () => {
    const answers: { ok: () => void; fail: () => void }[] = []
    const saveChanges = () =>
      new Promise<void>((ok, fail) => answers.push({ ok, fail: () => fail(new Error('Offline')) }))
    const { result } = renderHook(() => useObservationSave(saveChanges))
    const go = vi.fn()
    act(() => {
      void result.current.save({ note: 'New' })
      void result.current.save({ sev: 'High' })
      result.current.whenSaved(go)
    })
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    await act(async () => answers[0].fail())
    await vi.waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => answers[1].ok())
    // Without this, the severity's success let Back close the page and lose the note.
    expect(go).not.toHaveBeenCalled()
  })

  it('keeps a note whose save is on its way when the box is left again unchanged', async () => {
    let finish: (ok: boolean) => void = () => {}
    const save = vi.fn(() => new Promise<boolean>((r) => (finish = r)))
    render(<ObservationNote note="Old" canChange save={save} />)
    const box = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(box, { target: { value: 'New' } })
    fireEvent.blur(box)
    fireEvent.blur(box)
    // Without this, the pending text vanished and a failed save lost it.
    expect(box).toHaveValue('New')
    await act(async () => finish(false))
    expect(box).toHaveValue('New')
  })
})

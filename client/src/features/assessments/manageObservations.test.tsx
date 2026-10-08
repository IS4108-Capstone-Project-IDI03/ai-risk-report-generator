import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type {
  Assessment,
  SavedInterpretation,
  SavedObservation,
  SavedRecording,
  Stamp,
} from './api'
import { formatDayYearTime } from './format'

// Managing captured observations (CP-08): type, status and capture time on
// each row, filters on them, note and transcript corrections, and deleting
// and restoring, all on the sample assessment's Observations tab.
const REF = 'RPT-2026-0411'
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', name: 'Bay 3 — north aisle', floor: 'Ground' }
const PUMP_HOUSE = { id: 'l3', name: 'Pump house', floor: null }
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
  } satisfies SavedRecording
}
function observation(fields: Partial<SavedObservation>): SavedObservation {
  return {
    id: 'o1',
    engineer: 'Alex Rowe',
    copeDimension: 'Protection',
    standard: null,
    severity: 'high',
    location: BAY_3,
    note: null,
    recordings: [],
    photos: [],
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
}
const PROPOSED =
  'During the site visit to Bay 3, it was observed that the new racking sits under two sprinkler heads.'
function photographed(id: string, note: string, interpretation: Partial<SavedInterpretation>) {
  return observation({
    id,
    note,
    copeDimension: 'Occupancy',
    photos: [{ ...PHOTO, url: `/api/observations/${id}/photos/p1/image` }],
    interpretation: {
      status: 'interpreted',
      description: null,
      copeDimension: null,
      hazardType: null,
      error: null,
      attempts: 1,
      model: null,
      ...interpretation,
    },
  })
}
const READING = 'Racking photographed in the north aisle.'
const PROPOSAL = 'Bay 3 racking, two photos.'
const UNREAD = 'Riser room photographed.'
const INTERPRETING = photographed('o5', READING, { status: 'interpreting' })
const INTERPRETED = photographed('o6', PROPOSAL, {
  description: PROPOSED,
  copeDimension: 'Protection',
  hazardType: 'Sprinkler Installation',
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
    policyReference: null,
    surveyType: 'Property risk survey',
    siteVisitDate: '2026-04-11',
    reportDueDate: null,
    standards: [],
    engineer,
    status: 'capturing',
    captureStartedAt: '2026-04-11T08:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
    site: {
      code: 'SITE-0001',
      name: 'Tilbury Distribution Centre',
      address: null,
      jurisdiction: 'GB',
      facilityType: 'Warehouse',
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
    const body = init.body ? JSON.parse(String(init.body)) : undefined
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
      if (method === 'POST' && rest === '/interpretation/retry') {
        change((o) => ({
          interpretation: o.interpretation && {
            ...o.interpretation,
            status: 'interpreting',
            error: null,
          },
        }))
        return Promise.resolve(new Response(null, { status: 202 }))
      }
      if (method === 'PATCH') return change(() => ({ ...body, edited: STAMP }))
      if (method === 'DELETE') return change(() => ({ deleted: STAMP }))
      if (method === 'POST' && rest === '/restore') return change(() => ({ deleted: null }))
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
  render(<App />)
  await signIn()
  fireEvent.click(await screen.findByRole('button', { name: 'Tilbury Distribution Centre' }))
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  // The sample observations show straight away; wait for the gateway's.
  if (!offline && listed.length)
    await screen.findByRole('button', { name: new RegExp(listed[0].note ?? FAILED) })
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// An observation's row, by the start of its summary.
const row = (summary: string) =>
  screen.getByRole('button', { name: new RegExp(summary.slice(0, 20)) })
const select = (label: string) => screen.getByLabelText(new RegExp('^' + label))
const choose = (label: string, value: string) =>
  fireEvent.change(select(label), { target: { value } })
// Which of these observations the list shows, by their summary.
const shown = (...summaries: string[]) => summaries.filter((text) => screen.queryByText(text))
const optionLabels = (element: HTMLElement) =>
  within(element)
    .getAllByRole('option')
    .map((o) => o.textContent)
const showDeleted = () => click('Show deleted')
const hideDeleted = () => click('Hide deleted')

beforeAll(() => {
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
  it('shows each observation’s type, status and capture time', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY, TRANSCRIBING, FAILED_VOICE]
    await openObservations()
    // The capture time carries its year, in local time.
    expect(formatDayYearTime(new Date(2026, 8, 29, 8, 10))).toBe('29 Sep 2026 08:10')

    const expected = [
      [NOTE, 'Note', 'Complete'],
      [VOICE, 'Voice', 'Complete'],
      [RISER, 'Note and voice', 'Transcribing'],
      [FAILED, 'Voice', 'Transcription failed'],
    ] as const
    for (const [summary, type, status] of expected) {
      const r = row(summary)
      expect(within(r).getByText(type)).toBeInTheDocument()
      expect(within(r).getByText(status)).toBeInTheDocument()
      expect(within(r).getByText(formatDayYearTime(new Date(CAPTURED)))).toBeInTheDocument()
    }
  })

  it('filters by type and status, alone or with other filters', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY, TRANSCRIBING, FAILED_VOICE]
    await openObservations()
    const ALL = [NOTE, VOICE, RISER, FAILED, RACKING, PUMP_TEST, SORTATION]
    expect(optionLabels(select('Filter by type'))).toEqual(['All types', 'Note', 'Voice', 'Photo'])
    expect(optionLabels(select('Filter by status'))).toEqual([
      'All statuses',
      'Transcribing',
      'Interpreting',
      'Transcription failed',
      'Interpretation failed',
      'Complete',
    ])

    // One with a note and a recording is both types; the sample pump test has a voice clip.
    choose('Filter by type', 'Voice')
    expect(shown(...ALL)).toEqual([VOICE, RISER, FAILED, PUMP_TEST])
    choose('Filter by type', 'Note')
    expect(shown(...ALL)).toEqual([NOTE, RISER, RACKING, PUMP_TEST, SORTATION])
    click('Clear filters')

    choose('Filter by status', 'Transcription failed')
    expect(shown(...ALL)).toEqual([FAILED])
    choose('Filter by type', 'Note')
    expect(shown(...ALL)).toEqual([])
    expect(screen.getByText('No observations match those filters')).toBeInTheDocument()
  })
}, 15000)

describe('Proposals from photos (CP-05)', () => {
  it('shows where interpretation stands, and filters on it (AC2)', async () => {
    listed = [INTERPRETING, INTERPRETED, UNREAD_PHOTOS]
    await openObservations()

    expect(within(row(READING)).getByText('Interpreting')).toBeInTheDocument()
    expect(within(row(PROPOSAL)).getByText('Complete')).toBeInTheDocument()
    expect(within(row(UNREAD)).getByText('Interpretation failed')).toBeInTheDocument()
    const ALL = [READING, PROPOSAL, UNREAD, RACKING]
    choose('Filter by status', 'Interpreting')
    expect(shown(...ALL)).toEqual([READING])
    choose('Filter by status', 'Interpretation failed')
    expect(shown(...ALL)).toEqual([UNREAD])
  })

  it('shows the proposal as AI text, with the photos it was read from (AC3-AC6)', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    const proposal = screen.getByRole('region', { name: 'Proposal from the photos' })
    expect(within(proposal).getByText(PROPOSED)).toBeInTheDocument()
    expect(within(proposal).getByText('AI proposal')).toBeInTheDocument()
    expect(within(proposal).getByText('Protection · Sprinkler Installation')).toBeInTheDocument()
    expect(within(proposal).getByText('Proposed by gemini-3.8-flash')).toBeInTheDocument()
    expect(within(proposal).getByRole('link', { name: 'IMG_0460.jpg' })).toHaveAttribute(
      'href',
      '/api/observations/o6/photos/p1/image',
    )
  })

  it('adds the proposal to the note only when the engineer saves it (Use as note)', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    click('Use as note')
    const dialog = await screen.findByRole('dialog', { name: 'Edit observation' })
    expect(calls).toEqual([])
    // Added below what the engineer wrote, never in place of it.
    const note = PROPOSAL + '\n\n' + PROPOSED
    expect(within(dialog).getByLabelText('Note')).toHaveValue(note)
    click('Save changes')

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(calls).toEqual([{ method: 'PATCH', url: '/api/observations/o6', body: { note } }])
  })

  it('offers the proposed category only when it differs (Change category)', async () => {
    listed = [INTERPRETED]
    await openObservations()
    fireEvent.click(row(PROPOSAL))

    click('Change category to Protection')
    const dialog = await screen.findByRole('dialog', { name: 'Edit observation' })
    expect(within(dialog).getByLabelText('COPE category')).toHaveValue('Protection')
    click('Save changes')

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(calls).toEqual([
      { method: 'PATCH', url: '/api/observations/o6', body: { copeDimension: 'Protection' } },
    ])
    // Now the categories match, so it is no longer offered.
    expect(
      screen.queryByRole('button', { name: 'Change category to Protection' }),
    ).not.toBeInTheDocument()
  })

  it('shows why interpretation failed and retries it', async () => {
    listed = [UNREAD_PHOTOS]
    await openObservations()
    fireEvent.click(row(UNREAD))

    expect(
      screen.getByText('The photo service could not interpret the photos.'),
    ).toBeInTheDocument()
    click('Retry interpretation')

    await vi.waitFor(() =>
      expect(calls).toEqual([
        { method: 'POST', url: '/api/observations/o7/interpretation/retry', body: undefined },
      ]),
    )
    expect(await screen.findByText('Interpreting the photos…')).toBeInTheDocument()
  })

  it('labels the sample assessment’s proposal as a sample, not a reading', async () => {
    listed = []
    await openObservations()
    fireEvent.click(row(RACKING))

    const proposal = screen.getByRole('region', { name: 'Proposal from the photos' })
    expect(within(proposal).getByText('Sample proposal')).toBeInTheDocument()
    expect(
      within(proposal).getByText(
        'No capture session, so this is a sample proposal, not a reading of the photos.',
      ),
    ).toBeInTheDocument()
  })
}, 15000)

describe('Correcting an observation (CP-08 AC8-AC11, AC18)', () => {
  it('saves an edited note exactly as typed, and says who edited it', async () => {
    await openObservations()
    fireEvent.click(row(NOTE))
    click('Edit')
    const dialog = await screen.findByRole('dialog', { name: 'Edit observation' })
    const box = within(dialog).getByLabelText('Note')
    expect(box).toHaveValue(NOTE)

    const text = '  Hose reel H3 cleared after the visit.\nRecheck at close.'
    fireEvent.change(box, { target: { value: text } })
    click('Save changes')

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(calls).toEqual([{ method: 'PATCH', url: '/api/observations/o1', body: { note: text } }])
    expect(screen.queryByRole('dialog', { name: 'Edit observation' })).not.toBeInTheDocument()
    expect(row('Hose reel H3 cleared')).toBeInTheDocument()
    expect(
      screen.getByText('Edited by Alex Rowe · ' + formatDayYearTime(new Date(AT))),
    ).toBeInTheDocument()
  })

  it('keeps the note in its dialog when the gateway refuses to remove it', async () => {
    const reason = 'An observation needs a note or a recording, so this note can’t be removed.'
    refuse = (method) =>
      method === 'PATCH'
        ? json(400, { error: 'The observation details are invalid.', fields: { note: reason } })
        : null
    await openObservations()
    fireEvent.click(row(NOTE))
    click('Edit')
    const dialog = await screen.findByRole('dialog', { name: 'Edit observation' })

    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: '  ' } })
    click('Save changes')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      reason + ' Your changes are still here; press Save changes to try again.',
    )
    // A blank note is sent as removing it, and stays in the box.
    expect(calls.map((c) => c.body)).toEqual([{ note: null }])
    expect(within(dialog).getByLabelText('Note')).toHaveValue('  ')
    expect(row(NOTE)).toBeInTheDocument()
  })

  it('corrects only a finished transcript, keeping what Whisper wrote', async () => {
    listed = [VOICE_ONLY, TRANSCRIBING, FAILED_VOICE]
    await openObservations()
    for (const summary of [RISER, FAILED]) {
      fireEvent.click(row(summary))
      expect(screen.queryByRole('button', { name: 'Correct transcript' })).not.toBeInTheDocument()
    }

    fireEvent.click(row(VOICE))
    click('Correct transcript')
    const dialog = await screen.findByRole('dialog', { name: 'Correct transcript' })
    expect(within(dialog).getByRole('region', { name: 'What Whisper wrote' })).toHaveTextContent(
      VOICE,
    )
    const box = within(dialog).getByLabelText('Corrected transcript')
    expect(box).toHaveValue(VOICE)
    const corrected = 'Valve V-12 chained open, its tag missing.'
    fireEvent.change(box, { target: { value: corrected } })
    click('Save correction')

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
    // The observation now reads as the correction, with Whisper's words beside it.
    expect(row(corrected)).toBeInTheDocument()
    expect(screen.getByText('Corrected')).toBeInTheDocument()
    expect(screen.getByText('What Whisper wrote')).toBeInTheDocument()
    expect(screen.getByText(VOICE)).toBeInTheDocument()
    expect(
      screen.getByText('Corrected by Alex Rowe · ' + formatDayYearTime(new Date(AT))),
    ).toBeInTheDocument()
  })
}, 15000)

describe('Deleting and restoring an observation (CP-08 AC12-AC14)', () => {
  it('deletes one once confirmed, and restores it from Show deleted', async () => {
    listed = [NOTE_ONLY, VOICE_ONLY]
    await openObservations()
    fireEvent.click(row(NOTE))
    click('Delete')
    const dialog = await screen.findByRole('dialog', { name: 'Delete this observation?' })
    expect(dialog).toHaveTextContent(NOTE)
    click('Delete observation')

    expect(await screen.findByText(/^Observation deleted\./)).toBeInTheDocument()
    expect(calls).toEqual([{ method: 'DELETE', url: '/api/observations/o1', body: undefined }])
    expect(shown(NOTE, VOICE)).toEqual([VOICE])

    // Show deleted lists only the deleted ones, with who deleted them.
    showDeleted()
    const deleted = await screen.findByRole('button', { name: /Hose reel/ })
    expect(deleted).toHaveTextContent('Deleted')
    expect(shown(VOICE, RACKING)).toEqual([])
    expect(screen.getByText('Showing 1–1 of 1 deleted observation')).toBeInTheDocument()
    fireEvent.click(deleted)
    expect(
      screen.getByText('Deleted by Alex Rowe · ' + formatDayYearTime(new Date(AT))),
    ).toBeInTheDocument()
    // A deleted one changes only by being restored.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    click('Restore')

    expect(
      await screen.findByText('Observation restored. Report drafting uses it again.'),
    ).toBeInTheDocument()
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/observations/o1/restore' })
    expect(screen.getByText('No deleted observations')).toBeInTheDocument()
    hideDeleted()
    expect(shown(NOTE, VOICE)).toEqual([NOTE, VOICE])
    // The button is back to showing them.
    expect(screen.getByRole('button', { name: 'Show deleted' })).toBeInTheDocument()
  })

  it('keeps the dialog open with the reason when a delete is refused', async () => {
    refuse = (method) =>
      method === 'DELETE' ? json(409, { error: 'Assessment RPT-2026-0411 is archived.' }) : null
    await openObservations()
    fireEvent.click(row(NOTE))
    click('Delete')
    const dialog = await screen.findByRole('dialog', { name: 'Delete this observation?' })

    click('Delete observation')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Assessment RPT-2026-0411 is archived.',
    )
    expect(row(NOTE)).toBeInTheDocument()
  })

  it('edits, deletes and restores a sample observation in this demo only', async () => {
    offline = true
    await openObservations()

    fireEvent.click(row(SORTATION))
    click('Edit')
    const dialog = await screen.findByRole('dialog', { name: 'Edit observation' })
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'Sortation controller has no standby unit.' },
    })
    click('Save changes')
    expect(
      await screen.findByText('Changes saved. They are kept in this demo only.'),
    ).toBeInTheDocument()

    click('Delete')
    click('Delete observation')
    expect(
      await screen.findByText(
        'Observation deleted in this demo only. Choose Show deleted to restore it.',
      ),
    ).toBeInTheDocument()
    expect(shown(RACKING, PUMP_TEST)).toEqual([RACKING, PUMP_TEST])

    showDeleted()
    fireEvent.click(row('Sortation controller has no standby'))
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
        for (const name of ['Edit', 'Delete']) {
          const button = screen.queryByRole('button', { name })
          if (offered) expect(button).toBeInTheDocument()
          else expect(button).not.toBeInTheDocument()
        }
      }
      cleanup()
    }
  })
}, 15000)

describe('Site photographs (CP-04)', () => {
  const IMAGE_URL = '/api/observations/o9/photos/p1/image'
  const PHOTOGRAPHED = observation({
    id: 'o9',
    note: 'Riser room door wedged open.',
    photos: [
      { id: 'p1', name: 'IMG_0460.jpg', contentType: 'image/jpeg', size: 4, url: IMAGE_URL },
    ],
  })
  const DELETED = observation({
    id: 'o10',
    note: 'Photo of the wrong building.',
    photos: [
      { id: 'p2', name: 'IMG_0999.jpg', contentType: 'image/jpeg', size: 4, url: '/x/image' },
    ],
    deleted: STAMP,
  })

  it('links each photo to its observation, opening the original (AC2)', async () => {
    listed = [PHOTOGRAPHED]
    await openObservations()

    fireEvent.click(row('Riser room door wedged open.'))

    expect(screen.getByRole('link', { name: 'Open IMG_0460.jpg' })).toHaveAttribute(
      'href',
      IMAGE_URL,
    )
    expect(screen.getAllByText('Note and photo').length).toBeGreaterThan(0)
  })

  it('lists every photo in the collection, leaving deleted ones out (AC3)', async () => {
    listed = [PHOTOGRAPHED, DELETED]
    await openObservations()

    fireEvent.click(screen.getByRole('tab', { name: /Photos/ }))

    const collection = screen.getByRole('list', { name: 'Site photographs' })
    // The saved photo, and the sample assessment's own two.
    expect(within(collection).getAllByRole('listitem')).toHaveLength(3)
    expect(within(collection).getByRole('link', { name: 'Open IMG_0460.jpg' })).toHaveAttribute(
      'href',
      IMAGE_URL,
    )
    expect(within(collection).getByText('IMG_0442.jpg · 11 Apr 2026 09:22')).toBeInTheDocument()
    expect(within(collection).queryByText(/IMG_0999/)).not.toBeInTheDocument()

    // Each leads back to the observation it belongs to.
    const saved = within(collection).getAllByRole('listitem')[0]
    fireEvent.click(within(saved).getByRole('button', { name: 'Go to observation' }))
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('link', { name: 'Open IMG_0460.jpg' })).toBeInTheDocument()
  })
})

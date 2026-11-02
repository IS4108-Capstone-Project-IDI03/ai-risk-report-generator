// Tests for the Review screen and the walk list's data (CP-22 AC5, AC7, AC9, AC10).
// Covers screens/Review.tsx, screens/ProposalPage.tsx, useProposal.ts and useSiteWalks.ts.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardLeave } from '../assessments/leaveGuard'
import type { Proposal, SiteWalk } from './api'
import { siteWalkReview } from './openReview'
import {
  addCapturedObservation,
  proposalCapture,
  type ProposalCaptureTarget,
} from './proposalCapture'
import { SiteWalkReview } from './screens/Review'
import { AUTOSAVE_MS } from './useProposal'
import { POLL_MS, useSiteWalks } from './useSiteWalks'

const REF = 'RPT-2026-0411'
const BASE = `/api/assessments/${REF}/site-walks`
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const check = { severity: false, category: false, location: false }
const PROPOSAL: Proposal = {
  locations: [
    {
      ref: 'loc-1',
      existingId: 'e1',
      kind: 'building',
      building: 'Block A',
      floor: 'Level 1',
      name: 'Loading bay',
    },
    {
      ref: 'loc-2',
      existingId: null,
      kind: 'building',
      building: 'Block A',
      floor: 'Level 1',
      name: 'Chiller room',
    },
  ],
  observations: [
    {
      ref: 'obs-1',
      note: 'Coils iced over.',
      copeDimension: 'Occupancy',
      severity: 'moderate',
      locationRef: 'loc-2',
      recordingSeq: 1,
      start: 10,
      end: 20,
      photoIds: ['p1'],
      check: { ...check, severity: true },
    },
    {
      ref: 'obs-2',
      note: 'PU panels, no covering.',
      copeDimension: 'Construction',
      severity: 'high',
      locationRef: 'loc-2',
      recordingSeq: 1,
      start: 30,
      end: 40,
      photoIds: [],
      check,
    },
    {
      ref: 'obs-3',
      note: 'Extinguisher missing.',
      copeDimension: 'Protection',
      severity: 'high',
      locationRef: null,
      recordingSeq: 2,
      start: 5,
      end: 9,
      photoIds: [],
      check,
    },
  ],
}
const walkOf = (status: SiteWalk['status'] = 'ready'): SiteWalk => ({
  id: 'w1',
  status,
  name: null,
  createdAt: '2026-10-29T08:00:00.000Z',
  recordings: [
    {
      seq: 1,
      durationSec: 600,
      transcription: 'transcribed',
      transcript: 'Walk transcript.',
      audioUrl: '/audio/w1-1.webm',
    },
  ],
  photos: [{ id: 'p1', url: '/photo/p1.jpg', recordingSeq: 1, offsetSec: 15 }],
  notes: [],
  typedText: null,
  proposal: structuredClone(PROPOSAL),
  error: null,
})

let calls: { method: string; url: string; body?: unknown }[]
let walks: SiteWalk[]
function mockGateway() {
  calls = []
  walks = [walkOf()]
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (url === `/api/assessments/${REF}/locations`)
      return json(200, [
        { id: 'e1', building: 'Block A', floor: 'Level 1', name: 'Loading bay' },
        { id: 'e2', building: 'Block A', floor: 'Level 1', name: 'Cold room' },
      ])
    if (url === BASE) return json(200, walks)
    if (url.endsWith('/create')) return json(200, { locationIds: ['l'], observationIds: ['o'] })
    return json(200, walkOf())
  })
}
const saves = () => calls.filter((c) => c.method === 'PUT' && c.url === `${BASE}/w1/proposal`)
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))
// Opens one of our pickers by its accessible name and picks an option.
function pick(trigger: RegExp, option: string, within_: HTMLElement = document.body) {
  fireEvent.click(within(within_).getByRole('button', { name: trigger }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }))
}

const notify = vi.fn()
async function openReview(onCreated = () => {}, onClose = () => {}) {
  render(
    <SiteWalkReview
      reference={REF}
      walkId="w1"
      onClose={onClose}
      onCreated={onCreated}
      notify={notify}
    />,
  )
  await screen.findByRole('navigation', { name: 'Locations' })
}
const nav = () => screen.getByRole('navigation', { name: 'Locations' })
// A location in the navigator, by its exact name (its actions have longer names).
const place = (name: string) => within(nav()).getByRole('button', { name })
// A row of the list, found by its note.
const row = (note: string) => screen.getByRole('button', { name: new RegExp(note) })
const openObservation = (note: string) => fireEvent.click(row(note))
const noteBox = () => screen.getByRole('textbox', { name: 'Note' })
// The note saves when the engineer leaves the box, so a typed edit ends with a blur.
const typeNote = (value: string) => {
  fireEvent.change(noteBox(), { target: { value } })
  fireEvent.blur(noteBox())
}
// The page's Back, to the proposal it opened over.
const backToProposal = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Back to Loading bay · Chiller room' }))
const createAll = () => screen.getByRole('button', { name: /^(Create all|Creating…)$/ })
// Resolves with what the review hands the Add manually screen when it opens it.
const captureOpened = () =>
  new Promise<ProposalCaptureTarget>((done) =>
    window.addEventListener(
      proposalCapture.event,
      (e) => done((e as CustomEvent<ProposalCaptureTarget>).detail),
      { once: true },
    ),
  )

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  // setImmediate stays real: React's act flushes updates with it.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  mockGateway()
  notify.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('site walk review', () => {
  it('opens on the observations with no place yet, in the tab’s own layout', async () => {
    await openReview()
    // All locations first, No location yet below it.
    const top = within(nav()).getAllByRole('button')
    expect(top[0]).toHaveTextContent('All locations')
    expect(top[1]).toHaveTextContent('No location yet')
    // Named by its first two places, as on the list, with no "Proposal: " in front.
    expect(screen.getByRole('heading', { name: 'Loading bay · Chiller room' })).toBeInTheDocument()
    expect(screen.queryByText(/^Proposal:/)).not.toBeInTheDocument()
    expect(row('Extinguisher missing')).toBeInTheDocument()
    expect(screen.queryByText('Coils iced over.')).not.toBeInTheDocument()
    // The locations sit in the building › level tree, existing and new alike.
    expect(place('Loading bay')).toBeInTheDocument()
    expect(place('Chiller room')).toBeInTheDocument()
  })

  it('names the picked place above the list, beside the Add manually button', async () => {
    await openReview()
    // The toolbar button is the tab's own: "Add" with "manually" hidden on a phone.
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeInTheDocument()
    const where = () => document.querySelector('.ob-where')
    // The screen opens on No location yet.
    expect(where()).toHaveTextContent('No location yet')
    fireEvent.click(place('Chiller room'))
    expect(where()).toHaveTextContent('Block A › Level 1 › Chiller room')
    // All locations needs no line: the list says where each row is.
    fireEvent.click(within(nav()).getByRole('button', { name: /^All locations/ }))
    expect(where()).toBeNull()
  })

  it('names what an observation lacks in its row, and shows an empty field as a plain "Choose a …" on its page', async () => {
    // obs-3 has no place, category or severity.
    const walk = walkOf()
    Object.assign(walk.proposal!.observations[2], { copeDimension: null, severity: null })
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('/locations') ? json(200, []) : json(200, walk),
    )
    await openReview()
    // obs-1 has Jev's severity flag set: the screen ignores it.
    fireEvent.click(place('Chiller room'))
    expect(screen.queryByText(/^Check/)).not.toBeInTheDocument()
    expect(document.querySelector('.sw-picker--check')).toBeNull()
    expect(screen.queryByText(/^Needs/)).not.toBeInTheDocument()
    fireEvent.click(place('Loading bay'))
    expect(screen.getByText('No observations here')).toBeInTheDocument()

    // The row says only what is missing, in this order, and shows a dash for the empty marks.
    // Its navigator row carries a Needs details mark, so match on the start of its name.
    fireEvent.click(within(nav()).getByRole('button', { name: /^No location yet/ }))
    const incomplete = row('Extinguisher missing')
    expect(incomplete).toHaveTextContent('Needs location, category, severity')
    expect(within(incomplete).getAllByText('—')).toHaveLength(2)
    expect(
      within(incomplete).getByText('Needs location, category, severity', { selector: '.ob-sr' }),
    ).toBeInTheDocument()

    // The page keeps the plain "Choose a …" words, and a picked place clears its need.
    openObservation('Extinguisher missing')
    expect(
      screen.getByRole('button', { name: 'Location: Choose a location. Change' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Category: Choose a category. Change' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Severity: Choose a severity. Change' }),
    ).toBeInTheDocument()
    pick(/^Location:/, 'Level 1 › Loading bay')
    expect(screen.queryByText('Choose a location')).not.toBeInTheDocument()
  })

  it('autosaves the whole proposal once, shortly after the last edit', async () => {
    await openReview()
    openObservation('Extinguisher missing')
    // Two keystrokes, still in the box: one save after the last, so a note
    // left by browser Back (no blur) is not lost.
    fireEvent.change(noteBox(), { target: { value: 'Extinguisher' } })
    fireEvent.change(noteBox(), { target: { value: 'Extinguisher missing at exit.' } })

    await wait(AUTOSAVE_MS + 50)
    expect(saves()).toHaveLength(1)
    const sent = saves()[0].body as Proposal
    expect(sent.locations).toHaveLength(2)
    expect(sent.observations.find((o) => o.ref === 'obs-3')?.note).toBe(
      'Extinguisher missing at exit.',
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  // Edits obs-3's note while every proposal save fails.
  async function editOffline(onClose = () => {}) {
    await openReview(() => {}, onClose)
    const gateway = fetch
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
      init.method === 'PUT' ? Promise.reject(new TypeError('Failed to fetch')) : gateway(url, init),
    )
    openObservation('Extinguisher missing')
    typeNote('Edited offline.')
  }

  it('stays on the review when Back cannot save the last edits', async () => {
    const onClose = vi.fn()
    await editOffline(onClose)
    // From the page, Back returns to the list; from the list it leaves the review.
    backToProposal()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Site walk proposals' }))
    // Without this, leaving dropped the only copy of the edit.
    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Not saved. Retry' })).toBeInTheDocument()
    expect(row('Edited offline')).toBeInTheDocument()
  })

  it('keeps the workspace tabs from leaving while the last edits cannot be saved', async () => {
    await editOffline()
    const go = vi.fn()
    // The tabs and sidebar ask the leave guard (assessments/leaveGuard.ts) first.
    act(() => guardLeave(go))
    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument()
    expect(go).not.toHaveBeenCalled()
  })

  it('saves one at a time, so an older save never lands after a newer edit', async () => {
    await openReview()
    // Each proposal save waits until the test lets it finish.
    const gateway = fetch
    const pending: (() => void)[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
      init.method === 'PUT'
        ? new Promise<void>((r) => pending.push(r)).then(() => gateway(url, init))
        : gateway(url, init),
    )
    openObservation('Extinguisher missing')
    typeNote('First')
    await wait(AUTOSAVE_MS + 50)
    typeNote('Second')
    await wait(AUTOSAVE_MS + 50)
    expect(pending).toHaveLength(1)

    await act(async () => pending[0]())
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    await act(async () => pending[1]())
    const notes = saves().map(
      (c) => (c.body as Proposal).observations.find((o) => o.ref === 'obs-3')?.note,
    )
    expect(notes).toEqual(['First', 'Second'])
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('opens an observation as a page with its photos and clip, and steps with the arrows', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    openObservation('Coils iced over')
    expect(
      screen.getByRole('button', { name: 'Back to Loading bay · Chiller room' }),
    ).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Photos' })).getByRole('button', {
        name: 'Open Photo 1',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Site walk recording' })).toBeInTheDocument()
    expect(document.querySelector('audio')).toHaveAttribute('src', '/audio/w1-1.webm#t=10,20')
    expect(screen.getByRole('button', { name: 'Previous observation' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }))
    expect(noteBox()).toHaveValue('PU panels, no covering.')
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next observation' })).toBeDisabled()
  })

  it('"Use an existing location" re-points every observation of a new location', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Use an existing location for Chiller room' }),
    )
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cold room/ }))

    expect(place('Cold room')).toBeInTheDocument()
    expect(notify).toHaveBeenCalledExactlyOnceWith('Now uses Cold room')
    expect(screen.getByText('Coils iced over.')).toBeInTheDocument()
    expect(screen.getByText('PU panels, no covering.')).toBeInTheDocument()
    await wait(AUTOSAVE_MS + 50)
    const sent = saves()[0].body as Proposal
    expect(sent.locations.find((l) => l.ref === 'loc-2')).toMatchObject({
      existingId: 'e2',
      name: 'Cold room',
    })
    expect(sent.observations.filter((o) => o.locationRef === 'loc-2')).toHaveLength(2)
  })

  it('tells the engineer when a proposal or a location is renamed', async () => {
    await openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Rename proposal' }))
    const naming = screen.getByRole('dialog')
    fireEvent.change(within(naming).getByLabelText(/^Name/), { target: { value: 'Podium walk' } })
    await act(async () => fireEvent.click(within(naming).getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Proposal renamed'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename Chiller room' }))
    const renaming = screen.getByRole('dialog')
    fireEvent.change(within(renaming).getByLabelText(/^Location/), {
      target: { value: 'Pump room' },
    })
    fireEvent.click(within(renaming).getByRole('button', { name: 'Save' }))
    expect(notify).toHaveBeenLastCalledWith('Location renamed')
  })

  it('deletes an observation, and Undo puts it back where it was', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    openObservation('Coils iced over')
    fireEvent.click(screen.getByRole('button', { name: 'Delete observation' }))
    expect(screen.queryByText('Coils iced over.')).not.toBeInTheDocument()
    expect(screen.getByText('Observation deleted.')).toBeInTheDocument()
    await wait(AUTOSAVE_MS + 50)
    expect((saves()[0].body as Proposal).observations.map((o) => o.ref)).toEqual(['obs-2', 'obs-3'])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Coils iced over.')).toBeInTheDocument()
    await wait(AUTOSAVE_MS + 50)
    expect((saves().at(-1)!.body as Proposal).observations.map((o) => o.ref)).toEqual([
      'obs-1',
      'obs-2',
      'obs-3',
    ])
  })

  // Round 5: a deleted observation is kept, and can be restored.
  it('lists a deleted observation under Deleted observations, and Restore brings it back', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    openObservation('Coils iced over')
    fireEvent.click(screen.getByRole('button', { name: 'Delete observation' }))
    fireEvent.click(within(nav()).getByRole('button', { name: 'Deleted observations (1)' }))

    expect(screen.getByRole('heading', { name: 'Deleted Observations' })).toBeInTheDocument()
    expect(screen.getByText('1 deleted observation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore Coils iced over.' }))
    expect(notify).toHaveBeenCalledExactlyOnceWith('Observation restored')
    expect(screen.getByText('0 deleted observations')).toBeInTheDocument()
    await wait(AUTOSAVE_MS + 50)
    const sent = saves().at(-1)!.body as Proposal
    expect(sent.observations.map((o) => o.ref)).toEqual(['obs-2', 'obs-3', 'obs-1'])
    expect(sent.removed).toEqual([])
  })

  it('opens a deleted observation read only, with Restore and a Back to the deleted list', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    openObservation('Coils iced over')
    fireEvent.click(screen.getByRole('button', { name: 'Delete observation' }))
    fireEvent.click(within(nav()).getByRole('button', { name: 'Deleted observations (1)' }))
    fireEvent.click(document.querySelector('.ob-deleted .ob-row')!)

    expect(screen.getByRole('button', { name: 'Back to Deleted Observations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete observation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
  })

  it('hides the rows that do not match a filter, and says so when none do', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    expect(row('Coils iced over')).toBeInTheDocument()
    for (const name of ['Category', 'Severity', 'Type', 'Status'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument()

    // Coils is Moderate, PU panels is High.
    fireEvent.click(screen.getByRole('button', { name: 'Severity' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
    expect(screen.queryByRole('button', { name: /Coils iced over/ })).not.toBeInTheDocument()
    expect(row('PU panels')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Category' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Occupancy' }))
    expect(screen.getByText('No observations match those filters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(row('Coils iced over')).toBeInTheDocument()
  })

  it('opens an observation on its own: no Create all, and Back goes to the walk name', async () => {
    await openReview()
    expect(createAll()).toBeInTheDocument()
    openObservation('Extinguisher missing')
    expect(screen.queryByRole('button', { name: /^(Create all|Creating…)$/ })).toBeNull()
    expect(screen.queryByText(/^Ready to add|to fix$/)).not.toBeInTheDocument()

    backToProposal()
    expect(createAll()).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Loading bay · Chiller room' })).toBeInTheDocument()
  })

  it('lists the walk’s photos under All photos, and says so when there are none', async () => {
    await openReview()
    fireEvent.click(within(nav()).getByRole('button', { name: 'All photos' }))
    expect(screen.getByRole('heading', { name: 'All Photos' })).toBeInTheDocument()
    const table = screen.getByRole('group', { name: 'Site photographs' })
    expect(within(table).getByRole('button', { name: 'Open Photo 1' })).toBeInTheDocument()
    expect(within(table).getByText('Coils iced over.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Loading bay · Chiller room' }))
    fireEvent.click(within(nav()).getByRole('button', { name: 'All handwritten pages' }))
    expect(screen.getByRole('heading', { name: 'All Handwritten Pages' })).toBeInTheDocument()
    expect(screen.getByText('No handwritten pages yet')).toBeInTheDocument()
  })

  it('deletes a new location, and its observations move to No location yet', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chiller room' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('2 observations move to “No location yet”')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete location' }))

    expect(within(nav()).queryByRole('button', { name: 'Chiller room' })).not.toBeInTheDocument()
    expect(notify).toHaveBeenCalledExactlyOnceWith('Location deleted')
    for (const note of ['Coils iced over', 'PU panels', 'Extinguisher missing']) row(note)
    await wait(AUTOSAVE_MS + 50)
    const sent = saves()[0].body as Proposal
    expect(sent.locations.map((l) => l.ref)).toEqual(['loc-1'])
    expect(sent.observations.every((o) => o.locationRef === null)).toBe(true)
  })

  it('has no delete for a location already on the assessment', async () => {
    await openReview()
    fireEvent.click(place('Loading bay'))
    expect(screen.queryByRole('button', { name: /^Delete Loading bay/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use an existing location for Loading bay' }),
    ).not.toBeInTheDocument()
  })

  it('keeps Create all off while a field is empty, saying how many need one', async () => {
    const onCreated = vi.fn()
    await openReview(onCreated)
    expect(createAll()).toBeDisabled()
    // The count is a button that opens the first observation still missing something.
    const state = screen.getByRole('button', {
      name: /^Not ready: 1 observation needs details/,
    })
    expect(state).toHaveTextContent('1 to fix')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(createAll())
    expect(calls.some((c) => c.url.endsWith('/create'))).toBe(false)
    expect(onCreated).not.toHaveBeenCalled()

    // A second empty field on another observation makes it two.
    fireEvent.click(place('Chiller room'))
    openObservation('PU panels')
    typeNote('')
    backToProposal()
    expect(
      screen.getByRole('button', { name: /^Not ready: 2 observations need details/ }),
    ).toHaveTextContent('2 to fix')

    // Pressing it opens the first one that needs something: the one with no place.
    fireEvent.click(screen.getByRole('button', { name: /^Not ready: 2 observations/ }))
    expect(noteBox()).toHaveValue('Extinguisher missing.')
  })

  it('saves the latest edits, then creates everything', async () => {
    const onCreated = vi.fn()
    await openReview(onCreated)
    openObservation('Extinguisher missing')
    pick(/^Location:/, 'Level 1 › Loading bay')
    // The page has no Create all; the proposal's header has it.
    expect(screen.queryByRole('button', { name: /^(Create all|Creating…)$/ })).toBeNull()
    backToProposal()
    expect(screen.getByText('Ready to add')).toBeVisible()
    expect(createAll()).toBeEnabled()
    await act(async () => fireEvent.click(createAll()))

    const order = calls
      .filter((c) => c.method !== 'GET')
      .map((c) => c.method + ' ' + c.url.replace(BASE, ''))
    expect(order).toEqual(['PUT /w1/proposal', 'POST /w1/create'])
    expect((saves()[0].body as Proposal).observations[2].locationRef).toBe('loc-1')
    // The shared toast is shown by the Observations tab; it is handed what was created.
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('Created 3 observations and 1 location')
  })

  it('locks the review fields while Create all runs', async () => {
    // Create stays unanswered, so the screen is mid-creation.
    const gateway = fetch
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
      url.endsWith('/create') ? new Promise(() => {}) : gateway(url, init),
    )
    await openReview()
    openObservation('Extinguisher missing')
    pick(/^Location:/, 'Level 1 › Loading bay')
    backToProposal()
    await act(async () => fireEvent.click(createAll()))

    // jsdom does not apply inert, so check the attribute on the container of the screen below the header.
    expect(nav().closest('[inert]')).not.toBeNull()
    expect(createAll()).toBeDisabled()
  })

  // Round 3: Add manually opens the Add manually screen (see the last describe block).
  it('adds a location, then opens Add manually at it, saved first', async () => {
    await openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Building/), { target: { value: 'Block B' } })
    fireEvent.change(within(dialog).getByLabelText(/^Location/), { target: { value: 'Roof' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add location' }))

    expect(place('Roof')).toBeInTheDocument()
    expect(notify).toHaveBeenCalledExactlyOnceWith('Location added')
    expect(screen.getByText('No observations here')).toBeInTheDocument()
    const opened = captureOpened()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add manually' })))

    // The new location is saved before capture opens, and capture starts there.
    expect((saves()[0].body as Proposal).locations.at(-1)).toMatchObject({ ref: 'loc-3' })
    expect((await opened).locationId).toBe('loc-3')
  })
})

describe('site walks for the banner', () => {
  it('polls while a walk is being read, and stops once it is ready', async () => {
    walks = [walkOf('transcribing')]
    const { result } = renderHook(() => useSiteWalks(REF))
    await vi.waitFor(() => expect(result.current.walks[0]?.status).toBe('transcribing'))

    walks = [walkOf('ready')]
    await wait(POLL_MS)
    await vi.waitFor(() => expect(result.current.walks[0]?.status).toBe('ready'))
    const listed = calls.filter((c) => c.url === BASE).length
    await wait(POLL_MS * 3)
    expect(calls.filter((c) => c.url === BASE)).toHaveLength(listed)
  })
})

// Round 3 (2 Nov): the proposal's Add observation reuses the main Add
// observation screen. Its media is stored with the walk and created on Create all.
describe('adding an observation through the Add manually screen', () => {
  it('opens it on the proposal’s locations and the assessment’s others, at the picked place', async () => {
    await openReview()
    fireEvent.click(place('Chiller room'))
    const opened = captureOpened()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add manually' })))

    const target = await opened
    expect(target).toMatchObject({ reference: REF, walkId: 'w1', locationId: 'loc-2' })
    // Loading bay is in the proposal already (linked to e1), so e1 is not offered twice.
    expect(target.locations.map((l) => l.id)).toEqual(['loc-1', 'loc-2', 'e2'])
  })

  it('returns to the observation the capture screen added', async () => {
    siteWalkReview.observationRef = 'obs-2'
    render(
      <SiteWalkReview
        reference={REF}
        walkId="w1"
        onClose={() => {}}
        onCreated={() => {}}
        notify={notify}
      />,
    )

    expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveValue(
      'PU panels, no covering.',
    )
    expect(siteWalkReview.observationRef).toBeNull()
  })

  it('shows media added by hand on its page, with the voice transcript once done', async () => {
    const walk = walkOf()
    walk.media = [
      {
        id: 'm1',
        kind: 'voice',
        url: '/m/m1',
        transcription: 'transcribed',
        transcript: 'Hose reel missing.',
      },
      { id: 'm2', kind: 'photo', url: '/m/m2', transcription: null, transcript: null },
      { id: 'm3', kind: 'page', url: '/m/m3', transcription: null, transcript: null },
    ]
    walk.proposal!.observations[1].mediaIds = ['m1', 'm2', 'm3']
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('/locations') ? json(200, []) : json(200, walk),
    )
    siteWalkReview.observationRef = 'obs-2'
    render(
      <SiteWalkReview
        reference={REF}
        walkId="w1"
        onClose={() => {}}
        onCreated={() => {}}
        notify={notify}
      />,
    )

    expect(await screen.findByText('Hose reel missing.')).toBeInTheDocument()
    expect(document.querySelector('audio[src="/m/m1"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Photo 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Page 1/ })).toBeInTheDocument()
  })

  it('lets an observation of media alone be created, with no note', async () => {
    const walk = walkOf()
    walk.media = [{ id: 'm2', kind: 'photo', url: '/m/m2', transcription: null, transcript: null }]
    walk.proposal!.observations = [
      { ...walk.proposal!.observations[1], note: '', mediaIds: ['m2'] },
    ]
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('/locations') ? json(200, []) : json(200, walk),
    )
    await openReview()

    expect(createAll()).toBeEnabled()
  })

  it('uploads each file under its own id, then adds the observation to the saved proposal', async () => {
    const photo = new Blob(['jpg'], { type: 'image/jpeg' })
    const voice = new Blob(['webm'], { type: 'audio/webm' })
    const target: ProposalCaptureTarget = {
      reference: REF,
      walkId: 'w1',
      locationId: null,
      locations: [{ id: 'e2', building: 'Block A', floor: 'Level 1', name: 'Cold room' }],
    }
    let fail = true
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ method, url, body: init.body })
      if (url.endsWith('/proposal') && fail) return json(503, { error: 'Busy.' })
      return json(200, walkOf())
    })
    const captured = {
      locationId: 'e2',
      note: '',
      copeDimension: 'Protection' as const,
      severity: 'high' as const,
      clips: [voice],
      photos: [photo],
      pages: [],
    }

    await expect(addCapturedObservation(target, captured)).rejects.toThrow()
    fail = false
    const ref = await addCapturedObservation(target, captured)

    const uploads = calls.filter((c) => c.url.includes('/media/'))
    // The retry reuses each file's id, so nothing is stored twice.
    expect(new Set(uploads.map((c) => c.url)).size).toBe(2)
    const form = uploads[0].body as FormData
    expect(form.get('recording')).toBeInstanceOf(Blob)
    const sent = JSON.parse(String(calls.at(-1)!.body)) as Proposal
    const added = sent.observations.at(-1)!
    expect(added).toMatchObject({ ref, note: '', copeDimension: 'Protection', severity: 'high' })
    expect(added.mediaIds).toEqual(uploads.slice(0, 2).map((c) => c.url.split('/').at(-1)))
    // Cold room joins the proposal, linked to the assessment's location.
    expect(sent.locations.find((l) => l.ref === added.locationRef)).toMatchObject({
      existingId: 'e2',
      name: 'Cold room',
    })
  })
})

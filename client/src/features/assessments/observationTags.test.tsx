import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { SavedObservation } from './api'

const REF = 'RPT-2026-0411'
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', building: 'Warehouse', name: 'Bay 3 — north aisle', floor: 'Ground' }
const STAIRWELL = { id: 'l2', building: 'Block A', name: 'Stairwell B', floor: 'Level 2' }
const PUMP_HOUSE = { id: 'l3', building: null, name: 'Pump house', floor: null }

function observation(fields: Partial<SavedObservation> = {}): SavedObservation {
  return {
    id: 'o1',
    engineer: 'Alex Rowe',
    copeDimensions: ['Protection'],
    standard: null,
    severity: 'high',
    location: BAY_3,
    note: 'Hose reel H3 blocked by pallets.',
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
const HOSE_REEL = observation()
const STAIRWELL_DOOR = observation({
  id: 'o2',
  copeDimensions: ['Exposure'],
  severity: 'low',
  location: STAIRWELL,
  note: 'Stairwell door wedged open.',
})
const VALVE = observation({
  id: 'o3',
  copeDimensions: null,
  severity: 'moderate',
  location: PUMP_HOUSE,
  note: 'Unlabelled valve in the pump house.',
})
// The sample assessment's own observations, kept in the browser.
const RACKING =
  'Pallet racking installed against north wall since last visit. Two ESFR heads obstructed.'
const PUMP_TEST =
  'Pump test certificate not produced on request. Site engineer believes it is held by the contractor.'
const SORTATION =
  'Sortation line controller is a single point of failure. Client quotes 14 weeks to replace.'

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A stand-in for the gateway, answering by route. The dashboard list is
// unreachable, so the app falls back to its sample rows. A tag edit applies to
// the listed observations, as the gateway does, unless patchReply says otherwise.
let listed: SavedObservation[] = []
let reachable = true
let patchReply: ((id: string, tags: Record<string, unknown>) => Promise<Response>) | null = null
const patches: { id: string; tags: Record<string, unknown> }[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (!reachable) return Promise.reject(new TypeError('Failed to fetch'))
    // The workspace lists deleted ones too, for the Deleted button's count.
    if (url === OBS_URL || url === OBS_URL + '?include=deleted') return json(200, listed)
    if (url === LOCATIONS_URL) return json(200, [BAY_3, STAIRWELL, PUMP_HOUSE])
    const patch = url.match(/^\/api\/observations\/(\w+)$/)
    if (patch && init.method === 'PATCH') {
      const id = patch[1]
      const tags = JSON.parse(String(init.body))
      patches.push({ id, tags })
      if (patchReply) return patchReply(id, tags)
      const location = [BAY_3, STAIRWELL, PUMP_HOUSE].find((l) => l.id === tags.locationId)
      listed = listed.map((o) =>
        o.id === id
          ? {
              ...o,
              ...('copeDimensions' in tags && { copeDimensions: tags.copeDimensions }),
              ...(tags.severity && { severity: tags.severity }),
              ...(location && { location }),
              ...('standard' in tags && { standard: tags.standard }),
            }
          : o,
      )
      return json(
        200,
        listed.find((o) => o.id === id),
      )
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

async function openObservations() {
  // A second render in one test starts on the work list, as a new test does.
  window.history.replaceState(null, '', '/')
  render(<App />)
  await signIn()
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  // Listed under each location, so a row says where it is (CP-16).
  fireEvent.click(screen.getByRole('button', { name: 'Group by location' }))
  // The sample observations show straight away; wait for the gateway's.
  if (reachable && listed.length) await screen.findByText(listed[0].note!)
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// A select by the start of its label, which also holds any hint below it.
const select = (label: string, container: HTMLElement = document.body) =>
  within(container).getByLabelText(new RegExp('^' + label))
const choose = (label: string, value: string, container?: HTMLElement) =>
  fireEvent.change(select(label, container), { target: { value } })
// The Filters panel, opened from its button; it stays open while filters
// are chosen.
function filters() {
  if (!screen.queryByRole('dialog', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  return screen.getByRole('dialog', { name: 'Filters' })
}
// Chooses a filter's option by what it says, e.g. Location, "Pump house".
function filter(label: string, option: string) {
  const field = select(label, filters())
  const { value } = within(field).getByRole('option', { name: option }) as HTMLOptionElement
  fireEvent.change(field, { target: { value } })
}
// Clear filters, in the panel and beside the filter chips: either clears all.
const clearFilters = () =>
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
// Which of these observations the list shows, by their summary.
const shown = (...summaries: string[]) => summaries.filter((text) => screen.queryByText(text))
const ALL = [HOSE_REEL.note!, STAIRWELL_DOOR.note!, VALVE.note!, RACKING, PUMP_TEST, SORTATION]
// Expands the observation, unless it still is from last time, and edits its tags.
async function editTags(summary: string) {
  if (!screen.queryByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(summary.slice(0, 20)) }))
  click('Edit')
  return screen.findByRole('dialog', { name: 'Edit observation' })
}
// The location an observation's row is listed under (CP-16).
const placeOf = (row: HTMLElement) => row.closest('[role=group]')?.getAttribute('aria-label')
const optionLabels = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((o) => o.textContent)

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  listed = [HOSE_REEL, STAIRWELL_DOOR, VALVE]
  reachable = true
  patchReply = null
  patches.length = 0
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Filtering observations by tag (CP-06 AC2)', () => {
  it('returns every observation carrying any one chosen label', async () => {
    await openObservations()
    expect(shown(...ALL)).toEqual(ALL)

    const cases = [
      ['Category', 'Exposure', [STAIRWELL_DOOR.note]],
      ['Category', 'Uncategorised', [VALVE.note]],
      ['Category', 'Protection', [HOSE_REEL.note, RACKING, PUMP_TEST]],
      ['Severity', 'Moderate', [VALVE.note, SORTATION]],
      // One Location filter takes a building, a level of it or a location (CP-16).
      ['Location', 'All of Warehouse', [HOSE_REEL.note, RACKING, SORTATION]],
      ['Location', 'Ground', [HOSE_REEL.note, RACKING, SORTATION]],
      ['Location', 'Ground · Bay 3 — north aisle', [HOSE_REEL.note, RACKING]],
      ['Location', 'Level 2 · Stairwell B', [STAIRWELL_DOOR.note]],
      ['Location', 'Pump house', [VALVE.note, PUMP_TEST]],
    ] as const
    for (const [label, option, expected] of cases) {
      filter(label, option)
      expect(shown(...ALL)).toEqual(expected)
      expect(screen.getByText(`Showing ${expected.length} of 6 observations`)).toBeInTheDocument()
      clearFilters()
      expect(shown(...ALL)).toEqual(ALL)
    }
  }, 10000)

  it('shows each filter set as a chip that removes it, and counts them on the button', async () => {
    await openObservations()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()

    filter('Category', 'Protection')
    filter('Location', 'Pump house')

    expect(screen.getByRole('button', { name: 'Filters, 2 set' })).toHaveTextContent('Filters · 2')
    expect(shown(...ALL)).toEqual([PUMP_TEST])
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Location: Elsewhere on site · Pump house' }),
    )
    expect(shown(...ALL)).toEqual([HOSE_REEL.note, RACKING, PUMP_TEST])
    expect(screen.getByRole('button', { name: 'Filters, 1 set' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Category: Protection' }))
    expect(shown(...ALL)).toEqual(ALL)
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
  })

  it('opens the filters in a sheet on a phone, closed by Show n observations', async () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      await openObservations()
      fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
      const sheet = screen.getByRole('dialog', { name: 'Filters' })
      expect(sheet).toHaveClass('ds-dialog-sheet')

      choose('Severity', 'moderate', sheet)
      fireEvent.click(within(sheet).getByRole('button', { name: 'Show 2 observations' }))

      expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull()
      expect(shown(...ALL)).toEqual([VALVE.note, SORTATION])
      expect(screen.getByRole('button', { name: 'Remove Severity: Moderate' })).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    }
  })

  it('lists an observation under each of its categories', async () => {
    const SHARED_WALL = observation({
      id: 'o4',
      copeDimensions: ['Construction', 'Exposure'],
      note: 'Shared wall with the paint store next door.',
    })
    listed = [SHARED_WALL, HOSE_REEL]
    await openObservations()
    expect(screen.getByRole('button', { name: /Shared wall/ })).toHaveTextContent(
      'Construction, Exposure',
    )

    for (const category of ['Construction', 'Exposure']) {
      filter('Category', category)
      expect(shown(SHARED_WALL.note!, HOSE_REEL.note!)).toEqual([SHARED_WALL.note])
    }
    filter('Category', 'Uncategorised')
    expect(shown(SHARED_WALL.note!, HOSE_REEL.note!)).toEqual([])
  })

  it('narrows by every label chosen, and says so when none match', async () => {
    await openObservations()

    filter('Category', 'Protection')
    filter('Location', 'Pump house')
    expect(shown(...ALL)).toEqual([PUMP_TEST])

    filter('Severity', 'Low')
    expect(shown(...ALL)).toEqual([])
    expect(screen.getByText('No observations match those filters')).toBeInTheDocument()
  })

  it('offers the shared category vocabulary, and the places on file by building and level', async () => {
    await openObservations()
    const panel = filters()

    expect(optionLabels(select('Category', panel))).toEqual([
      'All categories',
      'Construction',
      'Occupancy',
      'Protection',
      'Exposure',
      'Uncategorised',
    ])
    // Each building, then Elsewhere on site; "All of" and a level only where
    // they hold more than one location.
    const location = select('Location', panel)
    expect(optionLabels(location)).toEqual([
      'All locations',
      'Level 2 · Stairwell B',
      'All of Warehouse',
      'Ground',
      'Ground · Bay 1 — despatch',
      'Ground · Bay 3 — north aisle',
      'Pump house',
    ])
    expect(
      within(location)
        .getAllByRole('group')
        .map((g) => g.getAttribute('label')),
    ).toEqual(['Block A', 'Warehouse', 'Elsewhere on site'])
  })
}, 10000)

describe('Editing an observation’s tags (CP-06 AC1, AC3)', () => {
  // Renders the app twice, so it is given as long as the filtering tests.
  it('categorises an observation and keeps its new tags after reopening', async () => {
    await openObservations()
    const dialog = await editTags(VALVE.note!)
    // The categories come from the shared vocabulary (AC3); an uncategorised
    // observation has none ticked.
    const boxes = within(
      within(dialog).getByRole('group', { name: 'COPE categories' }),
    ).getAllByRole('checkbox')
    expect(boxes.map((c) => c.closest('label')?.textContent)).toEqual([
      'Construction',
      'Occupancy',
      'Protection',
      'Exposure',
    ])
    expect(boxes.filter((c) => (c as HTMLInputElement).checked)).toEqual([])

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Exposure' }))
    // The same four severity chips as capture.
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Critical' }))
    choose('Location', 'l2', dialog)
    choose('Standard reference', 'NFPA 25 – 2026 Edition', dialog)
    click('Save changes')

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    // The label is stored as its COPE dimension.
    expect(patches).toEqual([
      {
        id: 'o3',
        tags: {
          copeDimensions: ['Exposure'],
          severity: 'critical',
          locationId: 'l2',
          standard: 'NFPA 25 – 2026 Edition',
        },
      },
    ])
    expect(screen.queryByRole('dialog', { name: 'Edit observation' })).not.toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Unlabelled valve/ })
    expect(row).toHaveTextContent('Exposure')
    expect(row).toHaveTextContent('Critical')
    expect(placeOf(row)).toBe('Block A · Level 2 · Stairwell B')

    // Reopening reads the observation back from the gateway.
    cleanup()
    await openObservations()
    const reopened = await screen.findByRole('button', { name: /Unlabelled valve/ })
    expect(reopened).toHaveTextContent('Exposure')
    expect(reopened).toHaveTextContent('Critical')
    expect(placeOf(reopened)).toBe('Block A · Level 2 · Stairwell B')
    fireEvent.click(reopened)
    expect(screen.getByRole('button', { name: 'NFPA 25 – 2026 Edition' })).toBeInTheDocument()
  }, 10000)

  it('sends only the tags that changed, and can uncategorise and remove the standard', async () => {
    listed = [observation({ standard: 'NFPA 13 – 2022 Edition' })]
    await openObservations()

    let dialog = await editTags(HOSE_REEL.note!)
    // Opens on the observation's current tags.
    expect(within(dialog).getByRole('radio', { name: 'High' })).toBeChecked()
    expect(select('Location', dialog)).toHaveValue('l1')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Low' }))
    click('Save changes')
    await screen.findByText('Changes saved.')

    dialog = await editTags(HOSE_REEL.note!)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Protection' }))
    choose('Standard reference', '', dialog)
    expect(
      within(dialog).getByText(
        'None chosen: report drafting leaves this observation out until it is categorised.',
      ),
    ).toBeInTheDocument()
    click('Save changes')

    await vi.waitFor(() =>
      expect(patches.map((p) => p.tags)).toEqual([
        { severity: 'low' },
        { copeDimensions: null, standard: null },
      ]),
    )
  })

  it('keeps the dialog and its changes when the gateway refuses them', async () => {
    patchReply = () =>
      json(400, {
        error: 'The observation tags are invalid.',
        fields: { locationId: 'Choose one of the locations listed for this assessment.' },
      })
    await openObservations()
    const dialog = await editTags(HOSE_REEL.note!)

    choose('Location', 'l3', dialog)
    click('Save changes')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Choose one of the locations listed for this assessment. Your changes are still here; press Save changes to try again.',
    )
    expect(select('Location', dialog)).toHaveValue('l3')
    // Nothing changed on screen.
    expect(placeOf(screen.getByRole('button', { name: /Hose reel/ }))).toBe(
      'Warehouse · Ground · Bay 3 — north aisle',
    )
  })

  it('edits a sample observation in this demo only', async () => {
    reachable = false
    await openObservations()
    const dialog = await editTags(PUMP_TEST)

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Exposure' }))
    choose('Location', 'demo-office', dialog)
    click('Save changes')

    expect(
      await screen.findByText('Changes saved. They are kept in this demo only.'),
    ).toBeInTheDocument()
    expect(patches).toEqual([])
    const row = screen.getByRole('button', { name: /Pump test certificate/ })
    expect(row).toHaveTextContent('Exposure')
    expect(placeOf(row)).toBe('Office annexe · Level 1 · Open-plan office')
    filter('Location', 'Level 1 · Open-plan office')
    expect(shown(RACKING, PUMP_TEST, SORTATION)).toEqual([PUMP_TEST])
  })
})

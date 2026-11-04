import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
// Set once the app has read the locations reply (see openObservations).
let locationsRead = false
let patchReply: ((id: string, tags: Record<string, unknown>) => Promise<Response>) | null = null
const patches: { id: string; tags: Record<string, unknown> }[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (!reachable) return Promise.reject(new TypeError('Failed to fetch'))
    // The workspace lists deleted ones too, for the Deleted button's count.
    if (url === OBS_URL || url === OBS_URL + '?include=deleted') return json(200, listed)
    if (url === LOCATIONS_URL)
      return json(200, [BAY_3, STAIRWELL, PUMP_HOUSE]).then((res) => {
        const read = res.text.bind(res)
        res.text = () => read().finally(() => (locationsRead = true))
        return res
      })
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
  // The sample observations show straight away; wait for the gateway's.
  if (reachable && listed.length) {
    await screen.findByText(listed[0].note!)
    // The locations are asked for once the observations land. Until they
    // render, the sample's places sit beside the gateway's (two Pump house
    // rows), so a slow CI runner could click into a half-loaded list.
    await vi.waitFor(() => expect(locationsRead).toBe(true))
    await act(async () => {})
  }
}
// Opens a filter's menu by its name ("Category", or "Category: Exposure" once
// set) and picks an item by what it says.
function filter(name: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name + '(:|$)') }))
  fireEvent.click(
    within(screen.getByRole('menu', { name })).getByRole('menuitemradio', { name: option }),
  )
}
// Picks a place in the location navigator, e.g. "Pump house" (CP-22).
const goTo = (place: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Locations' })).getByRole('button', {
      name: place,
    }),
  )
const clearAll = () => fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
// Which of these observations the list shows, by their summary.
const shown = (...summaries: string[]) => summaries.filter((text) => screen.queryByText(text))
const ALL = [HOSE_REEL.note!, STAIRWELL_DOOR.note!, VALVE.note!, RACKING, PUMP_TEST, SORTATION]
// Opens the observation's page, unless it still is from last time.
function openPage(summary: string) {
  if (!screen.queryByRole('complementary', { name: 'Tags' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(summary.slice(0, 20)) }))
  return screen.getByRole('complementary', { name: 'Tags' })
}
// Opens a tag's menu on the page ("Severity: High. Change") and returns it.
function openTag(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name + ': .*\\. Change$') }))
  return screen.getByRole('menu', { name })
}
// Opens a tag's menu and chooses one item; each choice saves at once.
const chooseTag = (name: string, item: string | RegExp) =>
  fireEvent.click(
    within(openTag(name)).getByRole(/Category/.test(name) ? 'menuitemcheckbox' : 'menuitemradio', {
      name: item,
    }),
  )
// The location an observation's row is listed under (CP-16).
const placeOf = (row: HTMLElement) => row.closest('section')?.getAttribute('aria-label')
const backToList = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Back to Observations' }))
const menuLabels = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[role^=menuitem]')].map((o) => o.textContent)

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
  locationsRead = false
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
    ] as const
    for (const [name, option, expected] of cases) {
      filter(name, option)
      expect(shown(...ALL)).toEqual(expected)
      fireEvent.click(screen.getByRole('button', { name: `Clear ${name.toLowerCase()} filter` }))
      expect(shown(...ALL)).toEqual(ALL)
    }
  }, 10000)

  it('filters by place in the location navigator, a building, a level or a location (CP-16)', async () => {
    await openObservations()
    const places = [
      ['Warehouse', [HOSE_REEL.note, RACKING, SORTATION]],
      ['Ground', [HOSE_REEL.note, RACKING, SORTATION]],
      ['Bay 3 — north aisle', [HOSE_REEL.note, RACKING]],
      ['Stairwell B', [STAIRWELL_DOOR.note]],
      ['Pump house', [VALVE.note, PUMP_TEST]],
      ['All locations', ALL],
    ] as const
    for (const [place, expected] of places) {
      goTo(place)
      expect(shown(...ALL)).toEqual(expected)
    }
  })

  it('shows each filter set in place, with a clear for it and a Clear all for several', async () => {
    await openObservations()
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()

    filter('Category', 'Protection')
    filter('Severity', 'High')
    expect(screen.getByRole('button', { name: 'Category: Protection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Severity: High' })).toBeInTheDocument()
    expect(shown(...ALL)).toEqual([HOSE_REEL.note, PUMP_TEST])

    fireEvent.click(screen.getByRole('button', { name: 'Clear severity filter' }))
    expect(shown(...ALL)).toEqual([HOSE_REEL.note, RACKING, PUMP_TEST])
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()

    filter('Severity', 'High')
    clearAll()
    expect(shown(...ALL)).toEqual(ALL)
    expect(screen.queryByRole('button', { name: /^Clear .* filter$/ })).toBeNull()
  })

  it('opens the location navigator in a sheet on a phone, closed by picking a place', async () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      await openObservations()
      fireEvent.click(screen.getByRole('button', { name: 'Location: All locations. Change' }))
      const sheet = screen.getByRole('dialog', { name: 'Locations' })
      expect(sheet).toHaveClass('ds-dialog-sheet')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Pump house' }))

      expect(screen.queryByRole('dialog', { name: 'Locations' })).toBeNull()
      expect(shown(...ALL)).toEqual([VALVE.note, PUMP_TEST])
      expect(
        screen.getByRole('button', { name: 'Location: Elsewhere on site › Pump house. Change' }),
      ).toBeInTheDocument()
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
      /Construction\s*Exposure/,
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
    goTo('Pump house')
    expect(shown(...ALL)).toEqual([PUMP_TEST])

    filter('Severity', 'Low')
    expect(shown(...ALL)).toEqual([])
    expect(screen.getByText('No observations match those filters')).toBeInTheDocument()
  })

  it('offers the shared category vocabulary, and the places on file by building and level', async () => {
    await openObservations()
    fireEvent.click(screen.getByRole('button', { name: 'Category' }))
    expect(menuLabels(screen.getByRole('menu', { name: 'Category' }))).toEqual([
      'All categories',
      'Construction',
      'Occupancy',
      'Protection',
      'Exposure',
      'Uncategorised',
    ])
    // The navigator lists each building, its levels and its locations, even
    // one holding no observation yet.
    const nav = screen.getByRole('navigation', { name: 'Locations' })
    expect([...nav.querySelectorAll('.ob-nav-pick')].map((b) => b.textContent)).toEqual(
      expect.arrayContaining([
        'All locations',
        'Block A',
        'Level 2',
        'Stairwell B',
        'Warehouse',
        'Ground',
        'Bay 1 — despatch',
        'Bay 3 — north aisle',
        'Pump house',
      ]),
    )
  })
}, 10000)

describe('Editing an observation’s tags (CP-06 AC1, AC3)', () => {
  // Renders the app twice, so it is given as long as the filtering tests.
  it('categorises an observation and keeps its new tags after reopening', async () => {
    await openObservations()
    openPage(VALVE.note!)
    // The categories come from the shared vocabulary (AC3); an uncategorised
    // observation has none ticked.
    const menu = openTag('Category')
    // Suggest categories is the menu's first item, then the four categories.
    expect(menuLabels(menu)).toEqual([
      'Suggest categories',
      'Construction',
      'Occupancy',
      'Protection',
      'Exposure',
    ])
    expect(
      within(menu)
        .getAllByRole('menuitemcheckbox')
        .filter((c) => c.getAttribute('aria-checked') === 'true'),
    ).toEqual([])

    // Each choice is saved as soon as it is made, one PATCH each.
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Exposure' }))
    await vi.waitFor(() => expect(patches).toHaveLength(1))
    // The same four severities as capture.
    chooseTag('Severity', 'Critical')
    await vi.waitFor(() => expect(patches).toHaveLength(2))
    chooseTag('Location', /Stairwell B/)
    await vi.waitFor(() => expect(patches).toHaveLength(3))

    // The label is stored as its COPE dimension.
    expect(patches).toEqual([
      { id: 'o3', tags: { copeDimensions: ['Exposure'] } },
      { id: 'o3', tags: { severity: 'critical' } },
      { id: 'o3', tags: { locationId: 'l2' } },
    ])
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    backToList()
    const row = screen.getByRole('button', { name: /Unlabelled valve/ })
    expect(row).toHaveTextContent('Exposure')
    expect(row).toHaveTextContent('Critical')
    expect(placeOf(row)).toBe('Block A › Level 2 › Stairwell B')

    // Reopening reads the observation back from the gateway.
    cleanup()
    await openObservations()
    const reopened = await screen.findByRole('button', { name: /Unlabelled valve/ })
    expect(reopened).toHaveTextContent('Exposure')
    expect(reopened).toHaveTextContent('Critical')
    expect(placeOf(reopened)).toBe('Block A › Level 2 › Stairwell B')
  }, 10000)

  it('builds each category click on the one before, and saves them in order', async () => {
    // The first save is held, so only the screen knows Construction was ticked.
    let answer: () => void = () => {}
    patchReply = (id) =>
      new Promise(
        (resolve) =>
          (answer = () =>
            resolve(
              json(
                200,
                listed.find((o) => o.id === id),
              ),
            )),
      )
    await openObservations()
    openPage(VALVE.note!)
    const menu = openTag('Category')
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Construction' }))
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Protection' }))

    // The second save waits for the first, so an older one can't land last.
    await vi.waitFor(() => expect(patches).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(patches).toHaveLength(1)
    answer()
    await vi.waitFor(() => expect(patches).toHaveLength(2))
    expect(patches.map((p) => p.tags)).toEqual([
      { copeDimensions: ['Construction'] },
      { copeDimensions: ['Construction', 'Protection'] },
    ])
  })

  it('keeps a queued category when an earlier save answers', async () => {
    // Each save is answered, with what it saved, only when the test says.
    const answers: (() => void)[] = []
    patchReply = (id, tags) =>
      new Promise((resolve) =>
        answers.push(() => {
          listed = listed.map((o) => (o.id === id ? { ...o, ...tags } : o))
          resolve(
            json(
              200,
              listed.find((o) => o.id === id),
            ),
          )
        }),
      )
    await openObservations()
    openPage(VALVE.note!)
    const tick = (name: string) => fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))
    openTag('Category')
    tick('Construction')
    tick('Protection')
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    await act(async () => answers[0]())
    tick('Exposure')
    for (let i = 1; i < 3; i++) {
      await vi.waitFor(() => expect(answers.length).toBeGreaterThan(i))
      await act(async () => answers[i]())
    }
    // Without this, the first answer reset the menu to [Construction] and Protection was dropped.
    expect(patches.at(-1)?.tags).toEqual({
      copeDimensions: ['Construction', 'Protection', 'Exposure'],
    })
  })

  it('saves a category undone before the first save is answered', async () => {
    let answer: () => void = () => {}
    patchReply = (id) =>
      new Promise(
        (resolve) =>
          (answer = () =>
            resolve(
              json(
                200,
                listed.find((o) => o.id === id),
              ),
            )),
      )
    await openObservations()
    openPage(VALVE.note!)
    const menu = openTag('Category')
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Construction' }))
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Construction' }))
    await vi.waitFor(() => expect(patches).toHaveLength(1))
    answer()
    // Without this, the undo looked like "no change" and Construction stayed saved.
    await vi.waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1].tags).toEqual({ copeDimensions: null })
  })

  it('sends only the tag that changed, and can uncategorise', async () => {
    listed = [observation()]
    await openObservations()
    openPage(HOSE_REEL.note!)

    // Opens on the observation's current tags.
    expect(
      within(openTag('Severity')).getByRole('menuitemradio', { name: 'High' }),
    ).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Low' }))
    await vi.waitFor(() => expect(patches).toHaveLength(1))

    const menu = openTag('Category')
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Protection' }))
    expect(
      await screen.findByText(
        'None chosen: report drafting leaves this observation out until it is categorised.',
      ),
    ).toBeInTheDocument()

    await vi.waitFor(() =>
      expect(patches.map((p) => p.tags)).toEqual([{ severity: 'low' }, { copeDimensions: null }]),
    )
  })

  it('keeps the typed choice off the page and says why when the gateway refuses it', async () => {
    patchReply = () =>
      json(400, {
        error: 'The observation tags are invalid.',
        fields: { locationId: 'Choose one of the locations listed for this assessment.' },
      })
    await openObservations()
    openPage(HOSE_REEL.note!)

    chooseTag('Location', /Pump house/)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not saved: Choose one of the locations listed for this assessment.',
    )
    // Nothing changed on screen.
    expect(screen.getByRole('button', { name: /^Location: .*Bay 3/ })).toBeInTheDocument()
    backToList()
    expect(placeOf(screen.getByRole('button', { name: /Hose reel/ }))).toBe(
      'Warehouse › Ground › Bay 3 — north aisle',
    )
  })

  it('edits a sample observation in this demo only', async () => {
    reachable = false
    await openObservations()
    openPage(PUMP_TEST)

    fireEvent.click(within(openTag('Category')).getByRole('menuitemcheckbox', { name: 'Exposure' }))
    chooseTag('Location', /Open-plan office/)

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(patches).toEqual([])
    backToList()
    const row = screen.getByRole('button', { name: /Pump test certificate/ })
    expect(row).toHaveTextContent('Exposure')
    expect(placeOf(row)).toBe('Office annexe › Level 1 › Open-plan office')
    goTo('Open-plan office')
    expect(shown(RACKING, PUMP_TEST, SORTATION)).toEqual([PUMP_TEST])
  })
})

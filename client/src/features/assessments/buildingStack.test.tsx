import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { SiteLocation } from './api'
import {
  buildingStack,
  cellLine,
  cellSummary,
  cellWhere,
  stackKey,
  worstSeverity,
} from './buildingStack'

const place = (
  id: string,
  name: string,
  floor: string | null = null,
  building: string | null = null,
): SiteLocation => ({ id, building, floor, name })
// A location as the stack takes it: the severities shown there, and how many it holds.
const at = (l: SiteLocation, sevs: string[] = [], total = sevs.length) => ({
  ...l,
  items: sevs.map((sev) => ({ sev })),
  total,
})

describe('The building stack (CP-61)', () => {
  const bay = place('l1', 'Loading bay', 'Ground', 'Block A')
  const server = place('l2', 'Server room', 'Level 2', 'Block A')
  const roof = place('l3', 'Roof plant', 'Roof', 'Block A')
  const carPark = place('l4', 'Car park', 'Basement 1', 'Block A')
  const facade = place('l5', 'Facade', null, 'Block A')
  const workshop = place('l6', 'Workshop', 'Ground', 'Block B')
  const guardhouse = place('l7', 'Guardhouse')

  it('takes the worst severity, or none while no observation has one', () => {
    expect(worstSeverity([{ sev: 'low' }, { sev: 'critical' }, { sev: 'high' }])).toBe('critical')
    expect(worstSeverity([{ sev: 'moderate' }, { sev: '' }])).toBe('moderate')
    expect(worstSeverity([{ sev: '' }])).toBe('')
    expect(worstSeverity([])).toBe('')
  })

  it('draws a building top to bottom: whole building, highest level, down to the basement', () => {
    const { buildings } = buildingStack([bay, server, roof, carPark, facade].map((l) => at(l)))
    expect(buildings).toHaveLength(1)
    expect(buildings[0].floors.map((f) => [f.title, f.kind])).toEqual([
      ['Whole building', 'whole'],
      ['Roof', 'above'],
      ['Level 2', 'above'],
      ['Ground', 'ground'],
      ['Basement 1', 'below'],
    ])
  })

  it('puts a level it does not recognise above the rest', () => {
    const podium = place('l9', 'Pool deck', 'Podium', 'Block A')
    const { buildings } = buildingStack([bay, podium, server].map((l) => at(l)))
    expect(buildings[0].floors.map((f) => f.title)).toEqual(['Podium', 'Level 2', 'Ground'])
  })

  it('lines ground floors up across buildings, with basements below', () => {
    const { buildings } = buildingStack(
      [bay, server, roof, carPark, facade, workshop].map((l) => at(l)),
    )
    const [a, b] = buildings
    const rowOf = (building: typeof a, kind: string) =>
      building.floors.find((f) => f.kind === kind)!.row
    expect(rowOf(a, 'ground')).toBe(rowOf(b, 'ground'))
    expect(rowOf(a, 'below')).toBe(rowOf(a, 'ground') + 1)
    // Each name sits just above its building's top floor; the taller building's is in row 1.
    expect(a.headRow).toBe(1)
    expect(b.headRow).toBe(b.floors[0].row - 1)
    expect(b.headRow).toBeGreaterThan(a.headRow)
  })

  it('keeps locations elsewhere on site apart, and every cell in the CP-16 order', () => {
    const stack = buildingStack([guardhouse, workshop, server, bay].map((l) => at(l)))
    expect(stack.elsewhere.map((c) => c.location.name)).toEqual(['Guardhouse'])
    expect(stack.buildings.map((b) => b.title)).toEqual(['Block A', 'Block B'])
    expect(stack.cells.map((c) => c.location.name)).toEqual([
      'Loading bay',
      'Server room',
      'Workshop',
      'Guardhouse',
    ])
  })

  it('draws locations with a level but no building as a building of their own', () => {
    const { buildings } = buildingStack([at(place('l8', 'Stairwell B', 'Level 2'))])
    expect(buildings.map((b) => b.title)).toEqual(['Building not recorded'])
    expect(cellWhere(buildings[0].floors[0].cells[0])).toBe('Building not recorded › Level 2')
  })

  it('says what each cell holds, as a colour and in words', () => {
    const { cells } = buildingStack([
      at(bay, ['critical', 'low', 'low']),
      at(server, ['']),
      at(roof),
      at(carPark, [], 3),
      at(workshop, ['high'], 4),
      at(guardhouse, [], 1),
    ])
    const by = (name: string) => cells.find((c) => c.location.name === name)!
    expect(by('Loading bay').tone).toBe('critical')
    expect(cellLine(by('Loading bay'))).toBe('3 · Critical')
    expect(cellSummary(by('Loading bay'))).toBe('3 observations, worst Critical')
    expect(by('Server room').tone).toBe('unset')
    expect(cellLine(by('Server room'))).toBe('1 · No severity')
    expect(cellSummary(by('Server room'))).toBe('1 observation, no severity yet')
    expect(by('Roof plant').tone).toBe('empty')
    expect(cellLine(by('Roof plant'))).toBe('Nothing recorded')
    // Filters that show none of a location's observations leave it drawn.
    expect(by('Car park').tone).toBe('nomatch')
    expect(cellLine(by('Car park'))).toBe('0 of 3')
    expect(cellSummary(by('Car park'))).toBe('None of its 3 observations match the filters')
    expect(cellSummary(by('Guardhouse'))).toBe('None of its 1 observation matches the filters')
    expect(cellSummary(by('Workshop'))).toBe('1 of 4 observations, worst High')
    expect(cellWhere(by('Loading bay'))).toBe('Block A › Ground')
    expect(cellWhere(by('Guardhouse'))).toBe('Elsewhere on site')
  })

  it('counts the locations of each colour for the key', () => {
    const cells = buildingStack([at(bay, ['critical']), at(server, ['high']), at(roof)]).cells
    expect(stackKey(cells).map((k) => [k.label, k.count])).toEqual([
      ['Critical', 1],
      ['High', 1],
      ['Moderate', 0],
      ['Low', 0],
      ['No severity yet', 0],
      ['Nothing recorded', 1],
    ])
    // No match is named only while a filter leaves a location with none.
    const filtered = buildingStack([at(bay, [], 2)]).cells
    expect(stackKey(filtered).at(-1)).toEqual({ tone: 'nomatch', label: 'No match', count: 1 })
  })
})

const REF = 'RPT-2026-0411'
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const BAY = place('l1', 'Loading bay', 'Ground', 'Block A')
const SERVER = place('l2', 'Server room', 'Level 2', 'Block A')
const ROOF = place('l3', 'Roof plant', 'Roof', 'Block A')
const WORKSHOP = place('l4', 'Workshop', 'Ground', 'Block B')
const GUARDHOUSE = place('l5', 'Guardhouse')
let n = 0
const observation = (
  location: SiteLocation | null,
  note: string,
  severity: string | null,
  fields: Record<string, unknown> = {},
) => ({
  id: 'o' + ++n,
  engineer: 'A. Rowe',
  copeDimensions: ['Protection'],
  standard: null,
  severity,
  location,
  note,
  recordings: [],
  photos: [],
  removedRecordings: [],
  removedPhotos: [],
  recordedAt: '2026-09-29T08:10:00.000Z',
  edited: null,
  deleted: null,
  ...fields,
})
let stored: SiteLocation[] = []
let observations: ReturnType<typeof observation>[] = []

function mockGateway() {
  vi.stubGlobal('fetch', (url: string) => {
    if (url === `/api/assessments/${REF}/capture-session`)
      return json(201, {
        session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
        assessment: {
          id: 'a1',
          reference: REF,
          client: 'Northgate Logistics',
          site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
        },
      })
    // As the gateway: deleted ones only when asked for.
    if (url === OBS_URL)
      return json(
        200,
        observations.filter((o) => !o.deleted),
      )
    if (url === OBS_URL + '?include=deleted') return json(200, observations)
    if (url === LOCATIONS_URL) return json(200, stored)
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

describe('The Observations tab as buildings (CP-61)', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
    Element.prototype.scrollIntoView = function () {}
  })
  beforeEach(() => {
    n = 0
    stored = [BAY, SERVER, ROOF, WORKSHOP, GUARDHOUSE]
    observations = [
      observation(BAY, 'Sprinkler valve found shut.', 'critical'),
      observation(BAY, 'Dock pit holds waste cardboard.', 'low'),
      observation(SERVER, 'Cylinder gauge reads low.', 'high'),
      observation(WORKSHOP, 'Oily rags in an open bin.', 'moderate'),
    ]
    mockGateway()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // The tab switched to Buildings, once the gateway's observations are in the cells.
  async function openStack() {
    render(<App />)
    await signIn()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('tab', { name: /^Observations/ }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Buildings' }))
    await cell(/^Block A › Ground › Loading bay: 2 observations/)
  }
  const cell = (name: RegExp) => screen.findByRole('button', { name })
  const building = (name: string) => screen.getByRole('region', { name })
  const levels = (name: string) =>
    [...building(name).querySelectorAll('.bs-level')].map((el) => el.textContent)

  it('draws each building as its levels, lowest at the bottom, then elsewhere on site', async () => {
    await openStack()
    // The navigator and the list give way to the stacks.
    expect(screen.queryByRole('navigation', { name: 'Locations' })).toBeNull()
    expect(levels('Block A')).toEqual(['Roof', 'Level 2', 'Ground'])
    expect(levels('Block B')).toEqual(['Ground'])
    expect(
      within(building('Elsewhere on site')).getByRole('button', {
        name: 'Elsewhere on site › Guardhouse: Nothing recorded',
      }),
    ).toBeInTheDocument()
  })

  it('shows each location with its count and worst severity, and one with none as Nothing recorded', async () => {
    await openStack()
    const bay = await cell(/^Block A › Ground › Loading bay: 2 observations, worst Critical$/)
    expect(bay).toHaveAttribute('data-tone', 'critical')
    expect(bay).toHaveTextContent('Loading bay2 · Critical')
    expect(await cell(/Server room: 1 observation, worst High$/)).toHaveAttribute(
      'data-tone',
      'high',
    )
    const roof = await cell(/^Block A › Roof › Roof plant: Nothing recorded$/)
    expect(roof).toHaveAttribute('data-tone', 'empty')
    expect(roof).toHaveTextContent('Roof plantNothing recorded')
    // With the demo assessment's own three sample observations, each at its own location.
    expect(screen.getByText('8 locations · 2 with nothing recorded · 7 observations')).toBeVisible()
  })

  it('leaves deleted observations out of the counts', async () => {
    observations.push(
      observation(ROOF, 'Loose flashing.', 'high', {
        deleted: { at: '2026-09-29T09:00:00.000Z', by: { id: 'u1', name: 'A. Rowe' } },
      }),
    )
    await openStack()
    expect(await cell(/Roof plant: Nothing recorded$/)).toBeInTheDocument()
  })

  it('lists the locations with nothing recorded until one is chosen', async () => {
    await openStack()
    const panel = screen.getByRole('complementary', { name: 'Locations with nothing recorded' })
    expect(within(panel).getByRole('heading', { name: 'Nothing recorded yet' })).toBeVisible()
    expect(
      within(panel)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.bs-gap-pick')?.textContent),
    ).toEqual(['Roof plantBlock A › Roof', 'GuardhouseElsewhere on site'])
    // Choosing one there chooses its cell.
    fireEvent.click(within(panel).getByRole('button', { name: /^Roof plant/ }))
    expect(await cell(/Roof plant: Nothing recorded$/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('lists a chosen location’s observations, each opening its own page', async () => {
    await openStack()
    fireEvent.click(await cell(/Loading bay: 2 observations/))
    const panel = screen.getByRole('complementary', { name: 'Block A › Ground › Loading bay' })
    expect(within(panel).getByText('2 observations, worst Critical')).toBeVisible()
    const rows = within(
      within(panel).getByRole('list', { name: 'Observations at Block A › Ground › Loading bay' }),
    ).getAllByRole('button')
    expect(rows.map((r) => r.querySelector('.bs-obs-text')?.textContent)).toEqual([
      'Sprinkler valve found shut.',
      'Dock pit holds waste cardboard.',
    ])
    fireEvent.click(rows[0])
    // Its page, with the title row gone; Back returns to the stacks, the cell still chosen.
    expect(screen.queryByRole('radio', { name: 'Buildings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(await cell(/Loading bay: 2 observations/)).toHaveAttribute('aria-pressed', 'true')
    // Pressing the chosen cell again lets go of it.
    fireEvent.click(await cell(/Loading bay: 2 observations/))
    expect(
      screen.getByRole('complementary', { name: 'Locations with nothing recorded' }),
    ).toBeVisible()
  })

  it('opens capture at the chosen location', async () => {
    await openStack()
    fireEvent.click(await cell(/Roof plant: Nothing recorded$/))
    fireEvent.click(screen.getByRole('button', { name: 'Add observation here' }))
    const bar = await screen.findByRole('button', { name: /^Location:/ })
    expect(within(bar).getByRole('text')).toHaveAccessibleName('Block A, Roof, Roof plant')
  })

  it('follows the tab’s filters, keeping every location drawn', async () => {
    await openStack()
    fireEvent.click(screen.getByRole('button', { name: 'Severity' }))
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Severity' })).getByRole('menuitemradio', {
        name: 'High',
      }),
    )
    expect(await cell(/Server room: 1 observation, worst High$/)).toBeInTheDocument()
    // One whose observations the filter hides stays, and says so.
    const bay = await cell(
      /^Block A › Ground › Loading bay: None of its 2 observations match the filters$/,
    )
    expect(bay).toHaveAttribute('data-tone', 'nomatch')
    expect(bay).toHaveTextContent('Loading bay0 of 2')
    // One with nothing recorded still reads so, whatever the filter.
    expect(await cell(/Roof plant: Nothing recorded$/)).toBeInTheDocument()
    expect(
      screen.getByText('8 locations · 2 with nothing recorded · 2 of 7 observations'),
    ).toBeVisible()
    expect(
      within(screen.getByRole('list', { name: /^Worst severity/ })).getByText('No match'),
    ).toBeVisible()
  })

  it('gives the same values as a table', async () => {
    await openStack()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table', { name: 'Observations at each location' })
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map((c) => c.textContent))
    // In the CP-16 order; the last building and Pump house are the demo assessment's samples.
    expect(rows).toEqual([
      ['Loading bayBlock A › Ground', '2', 'Critical'],
      ['Server roomBlock A › Level 2', '1', 'High'],
      ['Roof plantBlock A › Roof', '0', '–'],
      ['WorkshopBlock B › Ground', '1', 'Moderate'],
      ['Bay 1 — despatchWarehouse › Ground', '1', 'Moderate'],
      ['Bay 3 — north aisleWarehouse › Ground', '1', 'Critical'],
      ['GuardhouseElsewhere on site', '0', '–'],
      ['Pump houseElsewhere on site', '1', 'High'],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Hide table' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('points to observations with no location, which no cell holds', async () => {
    observations.push(observation(null, 'Hot work permit not displayed.', 'high'))
    await openStack()
    fireEvent.click(
      await screen.findByRole('button', { name: '1 observation has no location recorded' }),
    )
    // The list, at Location not recorded.
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked()
    expect(
      await screen.findByRole('button', { name: /Hot work permit not displayed/ }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /Sprinkler valve found shut/ })).toBeNull()
  })

  it('keeps the place chosen across a switch between the list and the stacks', async () => {
    await openStack()
    fireEvent.click(await cell(/Server room: 1 observation/))
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    // The list shows only that location's observations.
    expect(await screen.findByRole('button', { name: /Cylinder gauge reads low/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Sprinkler valve found shut/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Buildings' }))
    expect(await cell(/Server room: 1 observation/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens a chosen location over the stacks where there is no room beside them', async () => {
    // A narrow window (jsdom has no matchMedia, so say so).
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await openStack()
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(await cell(/Loading bay: 2 observations/))
    const sheet = screen.getByRole('dialog', { name: 'Loading bay' })
    expect(within(sheet).getByText('Block A › Ground')).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'Add observation here' })).toBeVisible()
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(2)
  })
})

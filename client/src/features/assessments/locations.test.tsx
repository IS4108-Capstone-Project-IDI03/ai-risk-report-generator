import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { Assessment, SiteLocation } from './api'
import {
  BUILDING_WORDS,
  correctName,
  groupLocations,
  isStandardName,
  levelRank,
  LOCATION_NAMES,
  locationLabel,
  locationText,
  similarName,
  standardLevel,
  suggestLevel,
} from './locations'

const REF = 'RPT-2026-0411'
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const CAPTURE = {
  session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
  assessment: {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
  },
}
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const place = (
  id: string,
  name: string,
  floor: string | null = null,
  building: string | null = null,
): SiteLocation => ({ id, building, floor, name })

// A small stand-in for the gateway. Added and changed locations are kept, and
// the same name, level and building is refused whatever the case, as it does.
let stored: SiteLocation[] = []
let observations: unknown[] = []
let workList: Assessment[] | null = null
let captureStarts = 0
let removeReply: () => Promise<Response> = () =>
  Promise.resolve(new Response(null, { status: 204 }))
const added: Record<string, unknown>[] = []
const edited: { id: string; body: Record<string, unknown> }[] = []
const removed: string[] = []
const key = (l: { name: string; floor?: string | null; building?: string | null }) =>
  [l.name, l.floor ?? '', l.building ?? ''].join('|').toLowerCase()
const duplicate = () => {
  const error = 'This location is already on the list.'
  return json(409, { error, fields: { name: error } })
}
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === '/api/assessments' && workList) return json(200, workList)
    if (url === `/api/assessments/${REF}/capture-session`) {
      captureStarts++
      return json(201, CAPTURE)
    }
    // A saved observation is listed first, at its location.
    if (url === `/api/assessments/${REF}/observations` && init.method === 'POST') {
      const details = JSON.parse(String((init.body as FormData).get('details')))
      const location = stored.find((l) => l.id === details.locationId)!
      const saved = {
        ...observationAt(location, 'o' + (observations.length + 1)),
        note: details.note,
      }
      observations = [saved, ...observations]
      return json(201, saved)
    }
    if (url.startsWith(`/api/assessments/${REF}/observations`)) return json(200, observations)
    const id = url.startsWith(LOCATIONS_URL + '/') ? url.slice(LOCATIONS_URL.length + 1) : null
    if (id && init.method === 'DELETE') {
      removed.push(id)
      return removeReply()
    }
    if (id && init.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      if (stored.some((l) => l.id !== id && key(l) === key(body))) return duplicate()
      edited.push({ id, body })
      const location = place(id, body.name, body.floor ?? null, body.building ?? null)
      stored = stored.map((l) => (l.id === id ? location : l))
      return json(200, location)
    }
    if (url === LOCATIONS_URL && init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      if (stored.some((l) => key(l) === key(body))) return duplicate()
      added.push(body)
      const location = place(
        'l' + (stored.length + 1),
        body.name,
        body.floor ?? null,
        body.building ?? null,
      )
      stored = [...stored, location]
      return json(201, location)
    }
    if (url === LOCATIONS_URL) return json(200, stored)
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

async function openCapture() {
  render(<App />)
  await signIn()
  // Open the assessment from the work list; Add observation is its header's action.
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
  await screen.findByRole('img', { name: 'live' })
}
const sheet = () => screen.getByRole('dialog', { name: 'Where are you?' })
// A field of the picker's form, by label; each suggests names as you type
// (a combobox).
const field = (label: 'Building' | 'Level' | 'Location') =>
  within(sheet()).getByRole('combobox', { name: new RegExp('^' + label) })
function fill(fields: Partial<Record<'Building' | 'Level' | 'Location', string>>) {
  for (const [label, value] of Object.entries(fields))
    fireEvent.change(field(label as 'Building'), { target: { value } })
}
const press = (name: string | RegExp) =>
  fireEvent.click(within(sheet()).getByRole('button', { name }))
// A building's (or Elsewhere on site's) heading, which folds its locations.
const group = (title: string) =>
  within(sheet()).getByRole('button', { name: new RegExp('^' + title + ', \\d+ locations?$') })
// The lists shown, each named by its building and level.
const lists = () =>
  within(sheet())
    .queryAllByRole('list')
    .map((l) => l.getAttribute('aria-label'))
const locationBar = () => screen.getByRole('button', { name: /^(Location:|Choose a location)/ })
// The Remove this location? dialog the bin button opens.
const removeDialog = () => screen.findByRole('dialog', { name: 'Remove this location?' })
async function confirmRemove() {
  const dialog = await removeDialog()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove location' }))
  return dialog
}
const observationAt = (location: SiteLocation, id = 'o1') => ({
  id,
  engineer: 'A. Rowe',
  copeDimensions: ['Protection'],
  standard: null,
  severity: 'high',
  location,
  note: 'Pump test certificate missing.',
  recordings: [],
  photos: [],
  removedRecordings: [],
  removedPhotos: [],
  recordedAt: '2026-09-29T08:10:00.000Z',
})

// Each element scrolled into view, as jsdom does not scroll.
let scrolled: Element[] = []
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this)
  }
})
beforeEach(() => {
  scrolled = []
  stored = []
  observations = []
  workList = null
  captureStarts = 0
  removeReply = () => Promise.resolve(new Response(null, { status: 204 }))
  added.length = 0
  edited.length = 0
  removed.length = 0
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Choosing where observations are captured', () => {
  it('starts capture by adding a location in a building, then captures in it', async () => {
    await openCapture()

    // With no locations yet, the picker opens on the form to add the first one.
    expect(await screen.findByRole('dialog', { name: 'Where are you?' })).toHaveTextContent(
      'Add the first location you’re inspecting.',
    )
    expect(within(sheet()).getByRole('radio', { name: 'In a building' })).toBeChecked()
    fill({ Building: 'Block A', Level: 'Level 2', Location: 'Stairwell B' })
    press('Add location')

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 2 · Stairwell B/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 2', name: 'Stairwell B' }])
  }, 10000)

  it('asks for a building, and adds one elsewhere on site by name alone (CP-16)', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    press('Add location')
    expect(field('Building')).toHaveAccessibleDescription(/Name the building\./)
    expect(field('Location')).toHaveAccessibleDescription(/Name the location\./)
    expect(added).toEqual([])

    fireEvent.click(within(sheet()).getByRole('radio', { name: 'Elsewhere on site' }))
    // Elsewhere on site has no building or level.
    expect(within(sheet()).queryByRole('combobox', { name: /^Building/ })).toBeNull()
    expect(within(sheet()).queryByRole('combobox', { name: /^Level/ })).toBeNull()
    fill({ Location: 'Fire access route' })
    press('Add location')

    expect(
      await screen.findByRole('button', {
        name: /Location: Elsewhere on site · Fire access route/,
      }),
    )
    expect(added).toEqual([{ name: 'Fire access route' }])
  })

  it('adds a location for the whole building when no level is given', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fill({ Building: 'Block A', Location: 'Facade' })
    press('Add location')

    expect(await screen.findByRole('button', { name: /Location: Block A · Facade/ }))
    expect(added).toEqual([{ building: 'Block A', name: 'Facade' }])
  })

  it('groups locations by building and level, lowest first, then elsewhere on site', async () => {
    stored = [
      place('l1', 'Lobby', 'Level 1', 'Block B'),
      place('l2', 'Staircase', 'Level 2', 'Block A'),
      place('l3', 'Plant room', 'Roof', 'Block A'),
      place('l4', 'Fire access route'),
      place('l5', 'Fire pump room', 'Basement 1', 'Block A'),
      place('l6', 'Facade', null, 'Block A'),
      place('l7', 'Store room', 'Level 2', 'Block A'),
      place('l8', 'Stairwell C', 'Level 3'),
    ]
    await openCapture()
    await within(sheet()).findByText('Block A')

    // With none chosen, each group is folded under its heading.
    expect(
      within(sheet())
        .getAllByRole('button', { expanded: false })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Block A, 5 locations',
      'Block B, 1 location',
      'Elsewhere on site, 1 location',
      'Building not recorded, 1 location',
    ])
    expect(lists()).toEqual([])

    fireEvent.click(group('Block A'))
    expect(group('Block A')).toHaveAttribute('aria-expanded', 'true')
    // The whole building first, then levels lowest first; names in order.
    expect(lists()).toEqual([
      'Block A · Whole building',
      'Block A · Basement 1',
      'Block A · Level 2',
      'Block A · Roof',
    ])
    expect(
      within(within(sheet()).getByRole('list', { name: 'Block A · Level 2' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Staircase', 'Store room'])
    fireEvent.click(group('Elsewhere on site'))
    expect(lists()).toContain('Elsewhere on site')
  })

  it('opens the building the engineer is in, and every group a search matches', async () => {
    stored = [
      place('l1', 'Staircase', 'Level 2', 'Block A'),
      place('l2', 'Lobby', 'Level 2', 'Block B'),
      place('l3', 'Guardhouse'),
    ]
    await openCapture()
    await within(sheet()).findByText('Block B')
    fireEvent.click(group('Block B'))
    press(/^Block B · Level 2 · Lobby/)

    fireEvent.click(locationBar())
    expect(group('Block B')).toHaveAttribute('aria-expanded', 'true')
    expect(group('Block A')).toHaveAttribute('aria-expanded', 'false')
    expect(lists()).toEqual(['Block B · Level 2'])

    fireEvent.change(within(sheet()).getByRole('searchbox', { name: /Search locations/ }), {
      target: { value: 'level 2' },
    })
    // Searching shows every match, with nothing to fold.
    expect(lists()).toEqual(['Block A · Level 2', 'Block B · Level 2'])
    expect(within(sheet()).queryByRole('button', { expanded: false })).toBeNull()
  })

  it('switches location, and adds the next one from where the engineer is', async () => {
    stored = [place('l1', 'Stairwell B', 'Level 2', 'Block A'), place('l2', 'Pump house')]
    await openCapture()
    await within(sheet()).findByText('Block A')
    fireEvent.click(group('Block A'))
    press(/^Block A · Level 2 · Stairwell B/)

    fireEvent.click(locationBar())
    fireEvent.click(group('Elsewhere on site'))
    press(/^Elsewhere on site · Pump house/)
    expect(locationBar()).toHaveAccessibleName(/Location: Elsewhere on site · Pump house/)

    fireEvent.click(locationBar())
    // Block A stays open as the engineer left it this visit.
    expect(group('Block A')).toHaveAttribute('aria-expanded', 'true')
    press(/^Block A · Level 2 · Stairwell B/)
    fireEvent.click(locationBar())
    press('Add a location')
    // The building and level the engineer is on; only the location to type.
    expect(field('Building')).toHaveValue('Block A')
    expect(field('Level')).toHaveValue('Level 2')
    expect(field('Location')).toHaveValue('')
    fill({ Location: 'Lift lobby' })
    press('Add location')

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 2 · Lift lobby/ }))
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 2', name: 'Lift lobby' }])
  })

  it('suggests the buildings and levels already used, then the usual levels', async () => {
    stored = [
      place('l1', 'Staircase', 'Mezzanine', 'Block A'),
      place('l2', 'Lobby', 'G', 'Block B'),
    ]
    await openCapture()
    await within(sheet()).findByText('Block A')
    press('Add a location')

    const options = (input: HTMLElement) =>
      [...document.getElementById(input.getAttribute('list')!)!.querySelectorAll('option')].map(
        (o) => o.value,
      )
    expect(options(field('Building'))).toEqual(['Block A', 'Block B'])
    fill({ Building: 'block b' })
    expect(options(field('Level'))).toEqual([
      'G',
      'Mezzanine',
      'Basement 2',
      'Basement 1',
      'Ground',
      'Level 1',
      'Level 2',
      'Level 3',
      'Roof',
    ])
  })

  it('filters the list by search and starts a new location from it', async () => {
    stored = [place('l1', 'Stairwell B', 'Level 2', 'Block A'), place('l2', 'Loading bay 4')]
    await openCapture()
    await within(sheet()).findByText('Block A')

    fireEvent.change(within(sheet()).getByRole('searchbox', { name: /Search locations/ }), {
      target: { value: 'load' },
    })

    expect(lists()).toEqual(['Elsewhere on site'])
    expect(
      within(within(sheet()).getByRole('list', { name: 'Elsewhere on site' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Loading bay 4'])
    press('Add a location')
    // The search becomes the new location's name.
    expect(field('Location')).toHaveValue('load')

    fireEvent.change(within(sheet()).getByRole('searchbox', { name: /Search locations/ }), {
      target: { value: 'nowhere' },
    })
    expect(within(sheet()).getByText('No location matches "nowhere".')).toBeInTheDocument()
  })

  it('refuses a location already on the list, whatever the case', async () => {
    stored = [place('l1', 'Stairwell B', 'Level 2', 'Block A')]
    await openCapture()
    await within(sheet()).findByText('Block A')
    press('Add a location')

    fill({ Building: 'block a', Level: 'LEVEL 2', Location: 'stairwell b' })
    press('Add location')

    // The gateway refuses it, and says why under the name.
    expect(await within(sheet()).findByText('This location is already on the list.'))
    expect(added).toEqual([])
    expect(field('Location')).toHaveValue('stairwell b')
  })

  it('drops down from the bar, leaving the workspace tabs clear and usable', async () => {
    await openCapture()

    // Not a modal dialog on a wider screen, so nothing behind it is dimmed.
    expect((await screen.findByRole('dialog', { name: 'Where are you?' })).tagName).toBe('DIV')
    expect(locationBar()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('tab', { name: /^Overview/ }))

    expect(screen.getByRole('tab', { name: /^Overview/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('can be closed before choosing a location, which the bar then asks for', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(locationBar()).toHaveAccessibleName('Choose a location')
    // Saving asks for one, and opens the picker again.
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    expect(screen.getByText('Choose a location first.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Where are you?' })).toBeInTheDocument()
    // The back link above the form leaves, as from any capture.
    fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }))
    expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
  })
})

describe('Changing a location (CP-16)', () => {
  it('changes a location in place, and its observations follow it', async () => {
    stored = [place('l1', 'Stiarcase', 'Level 2', 'Block A')]
    observations = [observationAt(stored[0])]
    await openCapture()
    await within(sheet()).findByText('1 observation')

    press('Edit Block A · Level 2 · Stiarcase')
    const form = within(sheet()).getByRole('region', { name: 'Edit location' })
    // It opens in the location's own row, ready to type in.
    expect(within(sheet()).getByRole('list', { name: 'Block A · Level 2' })).toContainElement(form)
    expect(within(form).getByRole('combobox', { name: /^Building/ })).toHaveFocus()
    expect(within(form).getByRole('combobox', { name: /^Building/ })).toHaveValue('Block A')
    expect(within(form).getByRole('combobox', { name: /^Level/ })).toHaveValue('Level 2')
    fill({ Location: 'Staircase' })
    observations = [observationAt(place('l1', 'Staircase', 'Level 2', 'Block A'))]
    press('Save location')

    expect(await within(sheet()).findByText('Staircase')).toBeInTheDocument()
    expect(edited).toEqual([
      { id: 'l1', body: { building: 'Block A', floor: 'Level 2', name: 'Staircase' } },
    ])
    expect(within(sheet()).queryByRole('region', { name: 'Edit location' })).toBeNull()
    // The observation saved there now reads the new name.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }))
    expect(
      await screen.findByRole('button', { name: /Pump test certificate missing/ }),
    ).toHaveTextContent('Block A · Level 2 · Staircase')
  })

  it('moves a location without a building into one, and keeps a clash out', async () => {
    stored = [place('l1', 'Lobby', 'Level 1'), place('l2', 'Lobby', 'Level 1', 'Block A')]
    await openCapture()
    fireEvent.click(await within(sheet()).findByRole('button', { name: /^Building not recorded/ }))

    press('Edit Level 1 · Lobby')
    // A level with no building: the building is asked for.
    expect(within(sheet()).getByRole('radio', { name: 'In a building' })).toBeChecked()
    press('Save location')
    expect(field('Building')).toHaveAccessibleDescription(/Name the building\./)
    fill({ Building: 'Block A' })
    press('Save location')
    expect(await within(sheet()).findByText('This location is already on the list.'))

    fill({ Building: 'Block B' })
    press('Save location')
    await vi.waitFor(() =>
      expect(edited).toEqual([
        { id: 'l1', body: { building: 'Block B', floor: 'Level 1', name: 'Lobby' } },
      ]),
    )
    await vi.waitFor(() =>
      expect(within(sheet()).queryByRole('button', { name: /^Building not recorded/ })).toBeNull(),
    )
    expect(within(sheet()).getByRole('button', { name: 'Block B, 1 location' })).toBeInTheDocument()
  })

  it('cancels a change, leaving the location as it was', async () => {
    stored = [place('l1', 'Guardhouse')]
    await openCapture()
    await within(sheet()).findByText('Guardhouse')
    press('Edit Elsewhere on site · Guardhouse')

    fill({ Location: 'Gatehouse' })
    press('Cancel')

    expect(within(sheet()).getByText('Guardhouse')).toBeInTheDocument()
    expect(within(sheet()).queryByRole('region', { name: 'Edit location' })).toBeNull()
    expect(edited).toEqual([])
  })

  it('offers Edit only to the engineer assigned to the assessment', async () => {
    stored = [place('l1', 'Guardhouse')]
    workList = [
      {
        id: 'a1',
        reference: REF,
        client: 'Northgate Logistics',
        clientId: null,
        surveyType: 'Property risk survey',
        siteVisitDate: '2026-04-11',
        reportDueDate: null,
        engineer: { id: '6ab39017e45cf009e4507799', name: 'Jide Okafor' },
        status: 'capturing',
        captureStartedAt: '2026-04-11T08:00:00.000Z',
        createdAt: '2026-04-01T00:00:00.000Z',
        siteShared: false,
        site: {
          id: 'site1',
          code: 'SITE-0001',
          name: 'Tilbury Distribution Centre',
          address: null,
          jurisdiction: 'GB',
          facilityType: 'Warehouse',
        },
      },
    ]
    await openCapture()

    expect(await within(sheet()).findByText('Guardhouse')).toBeInTheDocument()
    expect(within(sheet()).queryByRole('button', { name: /^Edit / })).toBeNull()
  })
})

describe('Removing a location', () => {
  it('removes a location added by mistake, but not one with observations', async () => {
    stored = [place('l1', 'Stairwel B'), place('l2', 'Boiler room')]
    observations = [observationAt(stored[1])]
    await openCapture()
    await within(sheet()).findByText('1 observation')

    // Only the unused one offers removal, once confirmed in its own dialog.
    expect(
      within(sheet()).queryByRole('button', { name: 'Remove Elsewhere on site · Boiler room' }),
    ).toBeNull()
    press('Remove Elsewhere on site · Stairwel B')
    expect(await removeDialog()).toHaveTextContent('Elsewhere on site · Stairwel B')
    await confirmRemove()

    await vi.waitFor(() => expect(within(sheet()).queryByText('Stairwel B')).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'Remove this location?' })).toBeNull()
    expect(removed).toEqual(['l1'])
    expect(within(sheet()).getByText('Boiler room')).toBeInTheDocument()
  })

  it('keeps the location when removal is cancelled or refused', async () => {
    stored = [place('l1', 'Lift A', 'Ground', 'Block A')]
    await openCapture()
    await within(sheet()).findByText('Lift A')

    press('Remove Block A · Ground · Lift A')
    fireEvent.click(within(await removeDialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Remove this location?' })).toBeNull()
    expect(removed).toEqual([])

    // Someone else saved an observation there in the meantime: the dialog
    // stays open and says why.
    removeReply = () =>
      json(409, {
        error:
          "Lift A, Ground, Block A has 1 observation. It can't be removed while they are saved there.",
      })
    press('Remove Block A · Ground · Lift A')
    const dialog = await confirmRemove()

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Lift A, Ground, Block A has 1 observation. It can't be removed while they are saved there.",
    )
    expect(within(sheet()).getByText('Lift A')).toBeInTheDocument()
  })

  it('asks for another location after removing the one in use', async () => {
    stored = [place('l1', 'Lift A', 'Ground', 'Block A'), place('l2', 'Roof', null, 'Block A')]
    await openCapture()
    await within(sheet()).findByText('Lift A')
    press(/^Block A · Ground · Lift A/)
    fireEvent.click(locationBar())

    press('Remove Block A · Ground · Lift A')
    await confirmRemove()

    // No location is chosen now, so the picker stays open, asking for one.
    await vi.waitFor(() => expect(locationBar()).toHaveAccessibleName('Choose a location'))
    expect(removed).toEqual(['l1'])
    expect(within(sheet()).getByText('Roof')).toBeInTheDocument()
  })
})

describe('Checking building and level names (CP-16)', () => {
  // The question asked under a field before saving, if any.
  const check = () => within(sheet()).queryByRole('alert')

  it('saves level shorthand in its standard spelling, without asking', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fill({ Building: 'Block A', Level: 'L2', Location: 'Lobby' })
    press('Add location')

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 2 · Lobby/ }))
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 2', name: 'Lobby' }])
  })

  it('asks about a mistyped level, offering the one it was probably meant to be', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fill({ Building: 'Block A', Level: 'lvel 2', Location: 'Lobby' })
    press('Add location')

    expect(check()).toHaveTextContent('Did you mean Level 2?')
    expect(check()).toHaveTextContent('“lvel 2” isn’t a level name we recognise.')
    expect(added).toEqual([])
    fireEvent.click(within(check()!).getByRole('button', { name: 'Use Level 2' }))

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 2 · Lobby/ }))
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 2', name: 'Lobby' }])
  })

  it('keeps a level the site really has, asking about it only once', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fill({ Building: 'Block A', Level: 'Podium', Location: 'Garden' })
    press('Add location')
    expect(check()).toHaveTextContent('Check the level')
    expect(check()).toHaveTextContent('“Podium” isn’t a standard level name.')
    fireEvent.click(within(check()!).getByRole('button', { name: 'Keep “Podium”' }))
    await screen.findByRole('button', { name: /Location: Block A · Podium · Garden/ })

    // Now on the site, the same level is not questioned again.
    fireEvent.click(locationBar())
    press('Add a location')
    fill({ Location: 'Pool deck' })
    press('Add location')

    expect(await screen.findByRole('button', { name: /Location: Block A · Podium · Pool deck/ }))
    expect(added.map((l) => l.floor)).toEqual(['Podium', 'Podium'])
  })

  it('lets the engineer change a level it asks about instead', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })
    fill({ Building: 'Block A', Level: 'Podum', Location: 'Garden' })
    press('Add location')

    fireEvent.click(within(check()!).getByRole('button', { name: 'Change it' }))

    expect(check()).toBeNull()
    expect(field('Level')).toHaveValue('Podum')
    expect(added).toEqual([])
  })

  it('asks about a building close to one already on the site', async () => {
    stored = [place('l1', 'Staircase', 'Level 2', 'Block A')]
    await openCapture()
    await within(sheet()).findByText('Block A')
    press('Add a location')

    fill({ Building: 'Blcok A', Level: 'Level 1', Location: 'Lobby' })
    press('Add location')
    expect(check()).toHaveTextContent('Did you mean Block A?')
    expect(check()).toHaveTextContent('Check the spelling of “Blcok A”.')
    fireEvent.click(within(check()!).getByRole('button', { name: 'Use Block A' }))

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 1 · Lobby/ }))
    // Block B is another building, not a slip for Block A.
    fireEvent.click(locationBar())
    press('Add a location')
    fill({ Building: 'Block B', Location: 'Lobby' })
    press('Add location')
    expect(await screen.findByRole('button', { name: /Location: Block B · Level 1 · Lobby/ }))
    expect(added.map((l) => l.building)).toEqual(['Block A', 'Block B'])
  })
})

describe('Checking building and location names against the usual ones (CP-16)', () => {
  const check = () => within(sheet()).queryByRole('alert')

  it('corrects a mistyped building word with no other building on the site', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fill({ Building: 'blcok a', Level: 'Level 1', Location: 'Lobby' })
    press('Add location')
    expect(check()).toHaveTextContent('Did you mean Block A?')
    fireEvent.click(within(check()!).getByRole('button', { name: 'Use Block A' }))

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 1 · Lobby/ }))
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 1', name: 'Lobby' }])
  })

  it('never pulls a correct spelling towards a mistyped one on the site', async () => {
    stored = [
      place('l1', 'Stair', 'Level 3', 'blcok a'),
      place('l2', 'Lobby', 'Level 3', 'blcok a'),
    ]
    await openCapture()
    await within(sheet()).findByText('Stair')

    press('Edit blcok a · Level 3 · Stair')
    fill({ Building: 'Block A' })
    press('Save location')

    await vi.waitFor(() =>
      expect(edited).toEqual([
        { id: 'l1', body: { building: 'Block A', floor: 'Level 3', name: 'Stair' } },
      ]),
    )
    expect(check()).toBeNull()
  })

  it('asks about a mistyped location name, suggesting the usual one', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fill({ Building: 'Block A', Level: 'Level 1', Location: 'stiarcase' })
    press('Add location')
    expect(check()).toHaveTextContent('Did you mean Staircase?')
    expect(check()).toHaveTextContent('Check the spelling of “stiarcase”.')
    fireEvent.click(within(check()!).getByRole('button', { name: 'Use Staircase' }))

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 1 · Staircase/ }))
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 1', name: 'Staircase' }])
  })

  it('saves a usual name with its own mark, or one it cannot match, without asking', async () => {
    stored = [place('l1', 'Riser B', 'Level 1', 'Block A')]
    await openCapture()
    await within(sheet()).findByText('Riser B')
    press('Add a location')

    // Not taken for Riser B: a different mark is a different place.
    fill({ Building: 'Block A', Level: 'Level 1', Location: 'Riser C' })
    press('Add location')
    await screen.findByRole('button', { name: /Location: Block A · Level 1 · Riser C/ })
    fireEvent.click(locationBar())
    press('Add a location')
    fill({ Location: 'Atrium' })
    press('Add location')

    expect(await screen.findByRole('button', { name: /Location: Block A · Level 1 · Atrium/ }))
    expect(added.map((l) => l.name)).toEqual(['Riser C', 'Atrium'])
  })

  it('suggests the location names already used, then the usual ones', async () => {
    stored = [place('l1', 'Atrium', 'Level 1', 'Block A')]
    await openCapture()
    await within(sheet()).findByText('Atrium')
    press('Add a location')

    const input = field('Location')
    const options = [
      ...document.getElementById(input.getAttribute('list')!)!.querySelectorAll('option'),
    ].map((o) => o.value)
    expect(options.slice(0, 4)).toEqual(['Atrium', 'Staircase', 'Stairwell', 'Lobby'])
    expect(options).toContain('Fire access route')
  })
})

describe('The Observations tab by location (CP-16)', () => {
  // The tab as it opens: newest first, once the gateway's observation is listed.
  async function openTab() {
    render(<App />)
    await signIn()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('tab', { name: /^Observations/ }))
    return screen.findByRole('button', { name: /Pump test certificate missing/ })
  }
  // The tab by building, level and location.
  async function openObservations() {
    await openTab()
    fireEvent.click(screen.getByRole('button', { name: 'Group by location' }))
    await screen.findByRole('group', { name: 'Elsewhere on site · Guardhouse' })
  }
  const placeGroup = (name: string) => screen.getByRole('group', { name })
  beforeEach(() => {
    stored = [
      place('l1', 'Staircase', 'Level 2', 'Block A'),
      place('l2', 'Lobby', 'Level 1', 'Block A'),
      place('l3', 'Guardhouse'),
    ]
    observations = [observationAt(stored[0])]
  })

  it('lists observations by building, level and location, empty locations too', async () => {
    await openObservations()

    expect(screen.getByRole('button', { name: 'Block A, 1 observation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      within(placeGroup('Block A · Level 2 · Staircase')).getByText(
        'Pump test certificate missing.',
      ),
    ).toBeInTheDocument()
    expect(placeGroup('Block A · Level 1 · Lobby')).toHaveTextContent('No observations')
    // Levels lowest first, and the headings say where, so no Location column.
    const names = (title: string) =>
      within(screen.getByRole('region', { name: title }))
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    expect(names('Block A')).toEqual(['Lobby', 'Staircase'])
    // The sample assessment's own sample observation is listed where it was
    // saved, though that location is not on the gateway's list.
    expect(names('Elsewhere on site')).toEqual(['Guardhouse', 'Pump house'])
    expect(screen.queryByText('Location', { selector: 'span' })).toBeNull()

    // A building folds away.
    fireEvent.click(screen.getByRole('button', { name: 'Block A, 1 observation' }))
    expect(screen.queryByRole('group', { name: /^Block A · / })).toBeNull()
  })

  it('opens newest first, naming each location in its row, and groups them on request', async () => {
    // Observations can arrive before the separate request for empty locations.
    const gateway = fetch
    let releaseLocations!: () => void
    const locationsReady = new Promise<void>((resolve) => {
      releaseLocations = resolve
    })
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url === LOCATIONS_URL ? locationsReady.then(() => gateway(url, init)) : gateway(url, init),
    )
    const row = await openTab()

    expect(row).toHaveTextContent('Block A · Level 2 · Staircase')
    expect(screen.queryByRole('group', { name: 'Elsewhere on site · Guardhouse' })).toBeNull()

    // One button, its text saying what pressing it does.
    const order = screen.getByRole('button', { name: 'Group by location' })
    expect(order).not.toHaveAttribute('aria-pressed')
    fireEvent.click(order)
    expect(order).toHaveAccessibleName('Show newest first')
    releaseLocations()
    expect(
      await screen.findByRole('group', { name: 'Elsewhere on site · Guardhouse' }),
    ).toHaveTextContent('No observations')
    fireEvent.click(order)
    expect(order).toHaveAccessibleName('Group by location')
    expect(screen.queryByRole('group', { name: 'Elsewhere on site · Guardhouse' })).toBeNull()
  })

  it('adds a location without capturing', async () => {
    await openObservations()

    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a location' })
    for (const [label, value] of [
      [/^Building/, 'Block A'],
      [/^Level/, 'Level 1'],
      [/^Location/, 'Store room'],
    ] as const)
      fireEvent.change(within(dialog).getByRole('combobox', { name: label }), {
        target: { value },
      })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add location' }))

    expect(
      await screen.findByRole('group', { name: 'Block A · Level 1 · Store room' }),
    ).toHaveTextContent('No observations')
    expect(screen.queryByRole('dialog', { name: 'Add a location' })).toBeNull()
    expect(added).toEqual([{ building: 'Block A', floor: 'Level 1', name: 'Store room' }])
    expect(captureStarts).toBe(0)
  })

  it('adds an observation at a location, opening capture there', async () => {
    await openObservations()

    fireEvent.click(
      screen.getByRole('button', { name: 'Add observation at Block A · Level 1 · Lobby' }),
    )

    expect(
      await screen.findByRole('button', { name: /^Location: Block A · Level 1 · Lobby/ }),
    ).toBeInTheDocument()
    // Where is already chosen, so the picker stays closed.
    expect(screen.queryByRole('dialog', { name: 'Where are you?' })).toBeNull()
  })

  // Capture from the header's Add observation, choosing where in the picker.
  async function captureAt(building: string, location: RegExp) {
    fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
    await screen.findByRole('dialog', { name: 'Where are you?' })
    fireEvent.click(group(building))
    press(location)
  }
  // Writes a note, grades it and saves it once the capture session is live.
  async function saveNote(note: string) {
    await screen.findByRole('img', { name: 'live' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: note } })
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    await screen.findByText('Observation saved to ' + REF + '.')
  }
  const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }))

  it('returns from capture to the location, with what was saved there marked New', async () => {
    await openObservations()
    fireEvent.click(
      screen.getByRole('button', { name: 'Add observation at Block A · Level 1 · Lobby' }),
    )
    await saveNote('Fire door wedged open.')
    back()

    const lobby = await screen.findByRole('group', { name: 'Block A · Level 1 · Lobby' })
    await vi.waitFor(() => expect(lobby).toHaveFocus())
    expect(scrolled).toEqual([lobby])
    const saved = within(lobby).getByRole('button', { name: /Fire door wedged open/ })
    expect(within(saved).getByText('New')).toBeInTheDocument()
    // Saved before this visit, so not marked.
    expect(within(placeGroup('Block A · Level 2 · Staircase')).queryByText('New')).toBeNull()

    // Marked only until the engineer leaves the tab.
    fireEvent.click(screen.getByRole('tab', { name: /^Overview/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^Observations/ }))
    await screen.findByRole('group', { name: 'Block A · Level 1 · Lobby' })
    expect(screen.queryByText('New')).toBeNull()
    expect(scrolled).toHaveLength(1)
  })

  it('returns to the location last saved in, opening its folded building', async () => {
    await openObservations()
    fireEvent.click(screen.getByRole('button', { name: 'Block A, 1 observation' }))
    await captureAt('Block A', /^Block A · Level 1 · Lobby/)
    await saveNote('Fire door wedged open.')
    back()

    const lobby = await screen.findByRole('group', { name: 'Block A · Level 1 · Lobby' })
    expect(screen.getByRole('button', { name: 'Block A, 2 observations' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await vi.waitFor(() => expect(lobby).toHaveFocus())
    expect(within(lobby).getByText('New')).toBeInTheDocument()
  })

  it('newest first, returns to the newest observation saved', async () => {
    await openTab()
    await captureAt('Block A', /^Block A · Level 1 · Lobby/)
    await saveNote('Fire door wedged open.')
    back()

    const saved = await screen.findByRole('button', { name: /Fire door wedged open/ })
    await vi.waitFor(() => expect(saved).toHaveFocus())
    expect(scrolled).toEqual([saved])
    expect(within(saved).getByText('New')).toBeInTheDocument()
  })

  it('stays at the top when capture was opened from the header and saved nothing', async () => {
    await openObservations()
    fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
    await screen.findByRole('dialog', { name: 'Where are you?' })
    back()

    await screen.findByRole('group', { name: 'Block A · Level 1 · Lobby' })
    expect(scrolled).toEqual([])
    expect(screen.queryByText('New')).toBeNull()
  })

  it('changes and removes a location from the list', async () => {
    await openObservations()

    // One with an observation saved there cannot be removed.
    expect(
      screen.queryByRole('button', { name: 'Remove Block A · Level 2 · Staircase' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Block A · Level 1 · Lobby' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit location' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Location/ }), {
      target: { value: 'Lift lobby' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save location' }))
    expect(
      await screen.findByRole('group', { name: 'Block A · Level 1 · Lift lobby' }),
    ).toBeInTheDocument()
    expect(edited).toEqual([
      { id: 'l2', body: { building: 'Block A', floor: 'Level 1', name: 'Lift lobby' } },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Remove Elsewhere on site · Guardhouse' }))
    await confirmRemove()
    await vi.waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Elsewhere on site · Guardhouse' })).toBeNull(),
    )
    expect(removed).toEqual(['l3'])
  })
})

describe('Locations by building and level (CP-16)', () => {
  it('corrects a slip in a usual building or location name, keeping its mark', () => {
    expect(correctName('blcok a', BUILDING_WORDS)).toBe('Block A')
    expect(correctName('towre 1', BUILDING_WORDS)).toBe('Tower 1')
    expect(correctName('bulding 2', BUILDING_WORDS)).toBe('Building 2')
    expect(correctName('lobbty', LOCATION_NAMES)).toBe('Lobby')
    expect(correctName('stiarcase', LOCATION_NAMES)).toBe('Staircase')
    expect(correctName('fire pmp room', LOCATION_NAMES)).toBe('Fire pump room')
    // Already usual, too short to judge, or close to nothing: left alone.
    expect(correctName('block a', BUILDING_WORDS)).toBeNull()
    expect(correctName('Riser C', LOCATION_NAMES)).toBeNull()
    expect(correctName('Hal', BUILDING_WORDS)).toBeNull()
    expect(correctName('COM2', BUILDING_WORDS)).toBeNull()
    expect(correctName('Atrium', LOCATION_NAMES)).toBeNull()
    expect(isStandardName('block a', BUILDING_WORDS)).toBe(true)
    expect(isStandardName('blcok a', BUILDING_WORDS)).toBe(false)
  })

  it('spells levels it knows one way, and suggests one for a slip', () => {
    expect(
      ['L2', 'lvl 2', '2nd floor', 'b1', 'GF', 'mezz', 'Rooftop'].map((l) => standardLevel(l)),
    ).toEqual(['Level 2', 'Level 2', 'Level 2', 'Basement 1', 'Ground', 'Mezzanine', 'Roof'])
    expect(standardLevel('Podium')).toBeNull()
    expect(
      ['lvel 2', 'levle 3', 'basment 1', 'grond', 'rooof', 'Podium'].map(suggestLevel),
    ).toEqual(['Level 2', 'Level 3', 'Basement 1', 'Ground', 'Roof', null])
  })

  it('takes a name for one already used only when a word is a slip', () => {
    const buildings = ['Block A', 'Tower 1', 'Warehouse']
    expect(similarName('Blcok A', buildings)).toBe('Block A')
    expect(similarName('Warehose', buildings)).toBe('Warehouse')
    // A different letter or number is a different building.
    expect(similarName('Block B', buildings)).toBeNull()
    expect(similarName('Tower 2', buildings)).toBeNull()
    // The same name in another case is the same building, not a slip.
    expect(similarName('block a', buildings)).toBeNull()
  })

  it('ranks levels lowest first, and leaves names it does not know unranked', () => {
    const levels = ['Roof', 'Level 10', 'L2', 'Mezzanine', 'Level 1', 'Ground', 'B1', 'Basement 2']
    expect(
      [...levels].sort((a, b) => (levelRank(a) ?? Infinity) - (levelRank(b) ?? Infinity)),
    ).toEqual(['Basement 2', 'B1', 'Ground', 'Level 1', 'Mezzanine', 'L2', 'Level 10', 'Roof'])
    expect(levelRank('Plant deck')).toBeNull()
  })

  it('labels a place general to specific on screen, and most specific first for reports', () => {
    const staircase = place('l1', 'Staircase', 'Level 2', 'Block A')
    expect(locationLabel(staircase)).toBe('Block A · Level 2 · Staircase')
    expect(locationText(staircase)).toBe('Staircase, Level 2, Block A')
    expect(locationLabel(place('l2', 'Fire access route'))).toBe(
      'Elsewhere on site · Fire access route',
    )
    // One saved before buildings keeps the report wording it had.
    expect(locationText(place('l3', 'Pump room', 'B1'))).toBe('Pump room, B1')
  })

  it('groups one building whatever its case, under the first spelling', () => {
    const groups = groupLocations([
      place('l1', 'Lobby', 'Level 1', 'Block A'),
      place('l2', 'Staircase', 'level 1', 'block a'),
    ])
    expect(groups.map((g) => [g.title, g.levels.map((l) => l.title)])).toEqual([
      ['Block A', ['Level 1']],
    ])
  })
})

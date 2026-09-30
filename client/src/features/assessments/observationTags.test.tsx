import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { SavedObservation } from './api'

const REF = 'RPT-2026-0411'
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', name: 'Bay 3 — north aisle', floor: 'Ground' }
const STAIRWELL = { id: 'l2', name: 'Stairwell B', floor: 'Level 2' }
const PUMP_HOUSE = { id: 'l3', name: 'Pump house', floor: null }

function observation(fields: Partial<SavedObservation> = {}): SavedObservation {
  return {
    id: 'o1',
    engineer: 'A. Rowe',
    copeDimension: 'Protection',
    standard: null,
    severity: 'high',
    location: BAY_3,
    note: 'Hose reel H3 blocked by pallets.',
    recordings: [],
    recordedAt: '2026-09-29T08:10:00.000Z',
    ...fields,
  }
}
const HOSE_REEL = observation()
const STAIRWELL_DOOR = observation({
  id: 'o2',
  copeDimension: 'Exposure',
  severity: 'low',
  location: STAIRWELL,
  note: 'Stairwell door wedged open.',
})
const VALVE = observation({
  id: 'o3',
  copeDimension: null,
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
    if (url === OBS_URL) return json(200, listed)
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
              ...('copeDimension' in tags && { copeDimension: tags.copeDimension }),
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
  render(<App />)
  await signIn()
  fireEvent.click(screen.getByRole('button', { name: 'Tilbury Distribution Centre' }))
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  // The sample observations show straight away; wait for the gateway's.
  if (reachable && listed.length) await screen.findByText(listed[0].note!)
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// A select by the start of its label, which also holds any hint below it.
const select = (label: string, container: HTMLElement = document.body) =>
  within(container).getByLabelText(new RegExp('^' + label))
const choose = (label: string, value: string, container?: HTMLElement) =>
  fireEvent.change(select(label, container), { target: { value } })
// Which of these observations the list shows, by their summary.
const shown = (...summaries: string[]) => summaries.filter((text) => screen.queryByText(text))
const ALL = [HOSE_REEL.note!, STAIRWELL_DOOR.note!, VALVE.note!, RACKING, PUMP_TEST, SORTATION]
// Expands the observation, unless it still is from last time, and edits its tags.
async function editTags(summary: string) {
  if (!screen.queryByRole('button', { name: 'Edit tags' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(summary.slice(0, 20)) }))
  click('Edit tags')
  return screen.findByRole('dialog', { name: 'Edit tags' })
}
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
      ['Filter by category', 'External exposures', [STAIRWELL_DOOR.note]],
      ['Filter by category', 'Not categorised yet', [VALVE.note]],
      ['Filter by category', 'Fire protection', [HOSE_REEL.note, RACKING, PUMP_TEST]],
      ['Filter by severity', 'moderate', [VALVE.note, SORTATION]],
      // The location's name is its zone; the same zone on any floor matches.
      ['Filter by location', 'Pump house', [VALVE.note, PUMP_TEST]],
      ['Filter by floor', 'Level 2', [STAIRWELL_DOOR.note]],
      ['Filter by floor', 'Ground', [HOSE_REEL.note, RACKING, SORTATION]],
    ] as const
    for (const [filter, value, expected] of cases) {
      choose(filter, value)
      expect(shown(...ALL)).toEqual(expected)
      expect(screen.getByText(`Showing ${expected.length} of 6 observations`)).toBeInTheDocument()
      click('Clear filters')
      expect(shown(...ALL)).toEqual(ALL)
    }
  })

  it('narrows by every label chosen, and says so when none match', async () => {
    await openObservations()

    choose('Filter by category', 'Fire protection')
    choose('Filter by location', 'Pump house')
    expect(shown(...ALL)).toEqual([PUMP_TEST])

    choose('Filter by severity', 'low')
    expect(shown(...ALL)).toEqual([])
    expect(screen.getByText('No observations match those filters')).toBeInTheDocument()
  })

  it('offers the shared category vocabulary, and the locations and floors on file', async () => {
    await openObservations()

    expect(optionLabels(select('Filter by category'))).toEqual([
      'All categories',
      'Construction',
      'Occupancy, hazards and utilities',
      'Fire protection',
      'External exposures',
      'Not categorised yet',
    ])
    expect(optionLabels(select('Filter by location'))).toEqual([
      'All locations',
      'Bay 3 — north aisle',
      'Stairwell B',
      'Pump house',
      'Bay 1 — despatch',
    ])
    expect(optionLabels(select('Filter by floor'))).toEqual(['All floors', 'Ground', 'Level 2'])
  })
})

describe('Editing an observation’s tags (CP-06 AC1, AC3)', () => {
  it('categorises an observation and keeps its new tags after reopening', async () => {
    await openObservations()
    const dialog = await editTags(VALVE.note!)
    // The category comes from the shared vocabulary (AC3).
    expect(optionLabels(select('COPE category', dialog))).toEqual([
      'Construction',
      'Occupancy, hazards and utilities',
      'Fire protection',
      'External exposures',
      'Not categorised yet',
    ])

    choose('COPE category', 'External exposures', dialog)
    choose('Severity', 'critical', dialog)
    choose('Location', 'l2', dialog)
    choose('Standard reference', 'NFPA 25 – 2026 Edition', dialog)
    click('Save tags')

    expect(await screen.findByText('Tags updated.')).toBeInTheDocument()
    // The label is stored as its COPE dimension.
    expect(patches).toEqual([
      {
        id: 'o3',
        tags: {
          copeDimension: 'Exposure',
          severity: 'critical',
          locationId: 'l2',
          standard: 'NFPA 25 – 2026 Edition',
        },
      },
    ])
    expect(screen.queryByRole('dialog', { name: 'Edit tags' })).not.toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Unlabelled valve/ })
    expect(row).toHaveTextContent('External exposures')
    expect(row).toHaveTextContent('Critical')
    expect(row).toHaveTextContent('Stairwell B · Level 2')

    // Reopening reads the observation back from the gateway.
    cleanup()
    await openObservations()
    const reopened = await screen.findByRole('button', { name: /Unlabelled valve/ })
    expect(reopened).toHaveTextContent('External exposures')
    expect(reopened).toHaveTextContent('Critical')
    expect(reopened).toHaveTextContent('Stairwell B · Level 2')
    fireEvent.click(reopened)
    expect(screen.getByRole('button', { name: 'NFPA 25 – 2026 Edition' })).toBeInTheDocument()
  })

  it('sends only the tags that changed, and can uncategorise and remove the standard', async () => {
    listed = [observation({ standard: 'NFPA 13 – 2022 Edition' })]
    await openObservations()

    let dialog = await editTags(HOSE_REEL.note!)
    // Opens on the observation's current tags.
    expect(select('Severity', dialog)).toHaveValue('high')
    expect(select('Location', dialog)).toHaveValue('l1')
    choose('Severity', 'low', dialog)
    click('Save tags')
    await screen.findByText('Tags updated.')

    dialog = await editTags(HOSE_REEL.note!)
    choose('COPE category', 'Not categorised yet', dialog)
    choose('Standard reference', '', dialog)
    expect(
      within(dialog).getByText(
        'Report drafting leaves this observation out until it is categorised.',
      ),
    ).toBeInTheDocument()
    click('Save tags')

    await vi.waitFor(() =>
      expect(patches.map((p) => p.tags)).toEqual([
        { severity: 'low' },
        { copeDimension: null, standard: null },
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
    click('Save tags')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Choose one of the locations listed for this assessment. Your changes are still here; press Save tags to try again.',
    )
    expect(select('Location', dialog)).toHaveValue('l3')
    // Nothing changed on screen.
    expect(screen.getByRole('button', { name: /Hose reel/ })).toHaveTextContent(
      'Bay 3 — north aisle · Ground',
    )
  })

  it('edits a sample observation in this demo only', async () => {
    reachable = false
    await openObservations()
    const dialog = await editTags(PUMP_TEST)

    choose('COPE category', 'External exposures', dialog)
    choose('Location', 'demo-office', dialog)
    click('Save tags')

    expect(
      await screen.findByText('Tags updated. They are kept in this demo only.'),
    ).toBeInTheDocument()
    expect(patches).toEqual([])
    const row = screen.getByRole('button', { name: /Pump test certificate/ })
    expect(row).toHaveTextContent('External exposures')
    expect(row).toHaveTextContent('Office annexe · Level 1')
    choose('Filter by floor', 'Level 1')
    expect(shown(RACKING, PUMP_TEST, SORTATION)).toEqual([PUMP_TEST])
  })
})

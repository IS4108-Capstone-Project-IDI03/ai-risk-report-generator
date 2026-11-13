// The Details panel's blocks and its site map (AS-06, boards D1, D2, D3). jsdom lays nothing
// out, so the panel's height is faked to test the budgets; Google Maps is faked as in
// assessments/components/SiteMapCard.test.tsx.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGoogleMaps } from '../../assessments/googleMaps'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { DetailsContent, type DetailedRecord } from './DetailsContent'
import { toast, Toaster } from '../../../design-system'
import { DetailsToaster } from './DetailsToaster'
import { DETAILS_TOASTER } from './detailsToast'
import { SiteMapPanel } from './SiteMapPanel'

vi.mock('../../assessments/googleMaps', async (original) => ({
  ...(await original<typeof import('../../assessments/googleMaps')>()),
  loadGoogleMaps: vi.fn(),
}))

type Listener = (event: { latLng: { lat: () => number; lng: () => number } }) => void
let mapClick: Listener | undefined
let center: ReturnType<typeof vi.fn>
function fakeMaps() {
  center = vi.fn()
  return {
    Map: class {
      addListener = (_: string, listener: Listener) => (mapClick = listener)
      setCenter = center
      setZoom = vi.fn()
      fitBounds = vi.fn()
    },
    Marker: class {
      setMap = vi.fn()
      addListener = vi.fn()
    },
    LatLngBounds: class {
      extend = vi.fn()
    },
  }
}

const person = (name: string, role: string) => ({ name, role })
const CONTACTS = [
  person('Rachel Ong', 'Building Manager'),
  person('Thomas Lim', 'Facilities Lead'),
  person('Suresh Kumar', 'Safety Officer'),
  person('Mei Wong', 'Finance'),
]
const RECORD = {
  id: 'a1',
  reference: 'RPT-2026-0072',
  client: 'Harbourline Properties Pte Ltd',
  clientId: 'c1',
  surveyType: 'First survey',
  siteVisitDate: '2026-11-11',
  reportDueDate: '2026-12-16',
  engineer: { id: 'e1', name: 'Alex Rowe' },
  site: {
    id: 's1',
    name: 'Pasir Gudang Cold Store',
    address: 'Lot 4521',
    jurisdiction: 'MY',
    facilityType: 'Cold store',
  },
  siteContacts: CONTACTS,
} as unknown as DetailedRecord
const DOCS = [1, 2, 3, 4, 5].map((n) => ({
  id: 'd' + n,
  name: `Document ${n}.pdf`,
  contentType: 'application/pdf',
  size: 1000,
  placement: { kind: 'client' },
  uploadedAt: `2026-11-0${n}T00:00:00.000Z`,
}))
const MAP = {
  site: {
    id: 's1',
    coordinates: { lat: 1.4521, lng: 103.9012 },
    pins: [{ name: 'Administration', lat: 1.4526, lng: 103.9008 }],
  },
  buildings: ['Administration', 'Cold Store Block', 'Dispatch Hall', 'Plant Room', 'Loading Bays'],
  canEdit: true,
}
const workflow = (over: Record<string, unknown> = {}) =>
  ({ ovSiteFacts: [], ovMap: MAP, ovEdit: null, ...over }) as unknown as AssessmentWorkflow

function serveDocuments(docs: unknown[]) {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(docs), { status: 200 })))
}
const showDetails = (record = RECORD, v = workflow(), onOpenMap = vi.fn()) => {
  render(<DetailsContent v={v} record={record} onOpenMap={onOpenMap} />)
  return { onOpenMap }
}

beforeEach(() => {
  mapClick = undefined
  vi.mocked(loadGoogleMaps).mockResolvedValue(fakeMaps() as never)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Details blocks', () => {
  it('shows 2 contacts, 3 documents newest first and 4 places, with +N more under each', async () => {
    serveDocuments(DOCS)
    showDetails()
    const contacts = screen.getByRole('heading', { name: 'Site Contacts' }).closest('section')!
    expect(within(contacts).getAllByRole('listitem')).toHaveLength(2)
    expect(within(contacts).getByText('+2 more')).toBeInTheDocument()
    const docs = (await screen.findByRole('heading', { name: 'Client Documents' })).closest(
      'section',
    )!
    expect(
      within(docs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('Document 5.pdf'),
      expect.stringContaining('Document 4.pdf'),
      expect.stringContaining('Document 3.pdf'),
    ])
    expect(within(docs).getByText('+2 more')).toBeInTheDocument()
    const map = screen.getByRole('heading', { name: 'Site Map' }).closest('section')!
    expect(within(map).getAllByRole('listitem')).toHaveLength(4)
    expect(within(map).getByText('+2 more')).toBeInTheDocument()
  })

  it('puts See All and Open Map on the heading rows, and never says Pinned in words', async () => {
    serveDocuments(DOCS)
    const { onOpenMap } = showDetails()
    expect(screen.getAllByRole('button', { name: /See All/ })).toHaveLength(1) // contacts only: no client page here
    fireEvent.click(screen.getByRole('button', { name: /Open Map/ }))
    expect(onOpenMap).toHaveBeenCalled()
    // A pin only on the pinned places: the site and Administration.
    const map = screen.getByRole('heading', { name: 'Site Map' }).closest('section')!
    expect(within(map).getAllByRole('img', { name: 'Pinned' })).toHaveLength(2)
    expect(within(map).queryByText(/pinned/i)).not.toBeInTheDocument()
  })

  it('lists every contact in a small list over the panel, and Escape closes it', async () => {
    serveDocuments([])
    showDetails()
    fireEvent.click(screen.getByRole('button', { name: /See All/ }))
    const list = screen.getByRole('dialog', { name: 'Site Contacts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(list).getByText('Site Contacts')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Site Contacts' })).not.toBeInTheDocument()
  })

  it('offers no See All for contacts that all fit, and says None yet for empty blocks', async () => {
    serveDocuments([])
    showDetails({ ...RECORD, siteContacts: [] } as DetailedRecord, workflow({ ovMap: null }))
    await vi.waitFor(() => expect(screen.getAllByText('None yet')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: /See All/ })).not.toBeInTheDocument()
  })

  // A panel body that fits 100 px of frame plus 40 per listed row, up to `height` px.
  const shortPanel = (height: number) => {
    const rows = (el: HTMLElement) =>
      el.querySelectorAll('.mb-docs li, .mb-people li, .mb-places li').length
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return 100 + 40 * rows(this)
    })
  }

  it('drops the budgets on a short panel until one of each is left', async () => {
    serveDocuments(DOCS)
    shortPanel(300)
    const { container } = render(
      <DetailsContent v={workflow()} record={RECORD} onOpenMap={vi.fn()} />,
    )
    // 9 rows, then 8, are too many; 1 contact, 1 document and 2 places fit.
    await vi.waitFor(() => expect(container.querySelectorAll('.mb-docs li')).toHaveLength(1))
    expect(container.querySelectorAll('.mb-people li')).toHaveLength(1)
    expect(container.querySelectorAll('.mb-places li')).toHaveLength(2)
    expect(screen.queryByText(/\d+ documents/)).not.toBeInTheDocument()
  })

  it('shows three links only when not even one of each fits', async () => {
    serveDocuments(DOCS)
    shortPanel(50)
    const { container } = render(
      <DetailsContent v={workflow()} record={RECORD} onOpenMap={vi.fn()} />,
    )
    await vi.waitFor(() => expect(container.querySelectorAll('.mb-bigrow')).toHaveLength(3))
    expect(container.querySelectorAll('.mb-people li, .mb-docs li, .mb-places li')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Open Map/ })).toBeInTheDocument()
    // Contacts still open their list from the row.
    fireEvent.click(screen.getByRole('button', { name: /See All/ }))
    expect(screen.getByRole('dialog', { name: 'Site Contacts' })).toBeInTheDocument()
  })
})

describe('the site map in the panel', () => {
  const clickMap = (lat: number, lng: number) =>
    act(async () => mapClick!({ latLng: { lat: () => lat, lng: () => lng } }))
  const put = vi.fn()
  const open = (over: Partial<Parameters<typeof SiteMapPanel>[0]['map']> = {}) => {
    const onSaved = vi.fn()
    render(<SiteMapPanel map={{ ...MAP, ...over }} onSaved={onSaved} />)
    return { onSaved }
  }
  const row = (name: string) => within(screen.getByRole('listitem', { name }))
  const sent = () => JSON.parse(put.mock.calls.at(-1)![1].body)
  beforeEach(() => {
    put.mockReset()
    put.mockImplementation(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => put(url, init))
  })

  it('gives a pinned place its coordinates and three icon buttons, an unpinned one a single Pin button', () => {
    open()
    expect(row('Site').getByText('1.4521, 103.9012')).toBeInTheDocument()
    for (const name of ['Directions', 'Move pin', 'Remove pin'])
      expect(
        row('Site').getByRole(name === 'Directions' ? 'link' : 'button', { name }),
      ).toBeInTheDocument()
    expect(
      row('Cold Store Block').getByRole('button', { name: 'Pin on the map' }),
    ).toBeInTheDocument()
    expect(row('Cold Store Block').queryByText(/not pinned/i)).not.toBeInTheDocument()
    // Pinned places come first, the rest follow.
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual([
      'Site',
      'Administration',
      'Cold Store Block',
      'Dispatch Hall',
      'Plant Room',
      'Loading Bays',
    ])
  })

  it('places a pin from the map: a hint, one bar under the map, then saved', async () => {
    const { onSaved } = open()
    fireEvent.click(row('Dispatch Hall').getByRole('button', { name: 'Pin on the map' }))
    expect(screen.getByText('Dispatch Hall', { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText(/Click the map to place/)).toBeInTheDocument()
    expect(screen.getByLabelText('Coordinates')).toBeInTheDocument()
    // The locate button inside the input's end, then Set Pin and Cancel as buttons with words.
    for (const name of ['Use My Location', 'Set Pin', 'Cancel'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.5, 103.5)
    expect(put.mock.calls[0][0]).toBe('/api/sites/s1/map')
    expect(sent()).toEqual({ block: 'Dispatch Hall', point: { lat: 1.5, lng: 103.5 } })
    expect(onSaved).toHaveBeenCalledWith('Pin set', undefined)
  })

  it('takes pasted coordinates, says what is wrong with bad ones, and cancels', async () => {
    open()
    fireEvent.click(row('Plant Room').getByRole('button', { name: 'Pin on the map' }))
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '91, 103' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Pin' }))
    expect(await screen.findByText(/latitude from -90 to 90/)).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Set Pin' })))
    expect(sent()).toEqual({ block: 'Plant Room', point: { lat: 1.2966, lng: 103.852 } })
    fireEvent.click(row('Loading Bays').getByRole('button', { name: 'Pin on the map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Coordinates')).not.toBeInTheDocument()
  })

  it('keeps Set Pin disabled until there are coordinates to set', () => {
    open()
    fireEvent.click(row('Plant Room').getByRole('button', { name: 'Pin on the map' }))
    const setPin = screen.getByRole('button', { name: 'Set Pin' })
    expect(setPin).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    expect(setPin).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '  ' } })
    expect(setPin).toBeDisabled()
  })

  it('moves and removes a pin', async () => {
    open()
    await act(async () =>
      fireEvent.click(row('Administration').getByRole('button', { name: 'Remove pin' })),
    )
    expect(sent()).toEqual({ block: 'Administration', point: null })
    fireEvent.click(row('Site').getByRole('button', { name: 'Move pin' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.46, 103.91)
    expect(sent()).toEqual({ coordinates: { lat: 1.46, lng: 103.91 } })
  })

  it('says a removal and offers Undo, which puts the pin back where it was', async () => {
    const { onSaved } = open()
    await act(async () =>
      fireEvent.click(row('Administration').getByRole('button', { name: 'Remove pin' })),
    )
    expect(onSaved).toHaveBeenLastCalledWith(
      'Pin removed',
      expect.objectContaining({ label: 'Undo' }),
    )
    const undo = onSaved.mock.calls.at(-1)![1] as { onClick: () => void }
    await act(async () => undo.onClick())
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2))
    expect(sent()).toEqual({ block: 'Administration', point: { lat: 1.4526, lng: 103.9008 } })
    expect(onSaved).toHaveBeenLastCalledWith('Pin restored', undefined)
  })

  it('says a move as a move', async () => {
    const { onSaved } = open()
    fireEvent.click(row('Site').getByRole('button', { name: 'Move pin' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.46, 103.91)
    expect(onSaved).toHaveBeenLastCalledWith('Pin moved', undefined)
  })

  it('shows directions but no changes to someone who may not edit', () => {
    open({ canEdit: false })
    expect(row('Site').getByRole('link', { name: 'Directions' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=1.4521,103.9012',
    )
    expect(
      screen.queryByRole('button', { name: /Move pin|Remove pin|Pin on the map/ }),
    ).not.toBeInTheDocument()
  })

  it('centres the map on a pinned place when its row is pressed', async () => {
    open()
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    fireEvent.click(row('Administration').getByText('Administration'))
    expect(center).toHaveBeenLastCalledWith({ lat: 1.4526, lng: 103.9008 })
  })

  it('lists every place with no +N more, and only the list scrolls', () => {
    const { container } = render(<SiteMapPanel map={MAP} onSaved={vi.fn()} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByText(/more/)).not.toBeInTheDocument()
    expect(container.querySelector('.mb-placelist')).toBeInTheDocument()
  })

  it('fills the input from the device without saving, when the locate button is pressed', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (done: (p: unknown) => void) =>
          done({ coords: { latitude: 1.45231, longitude: 103.90087, accuracy: 8 } }),
      },
    })
    open()
    fireEvent.click(row('Plant Room').getByRole('button', { name: 'Pin on the map' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use My Location' })))
    expect(screen.getByLabelText('Coordinates')).toHaveValue('1.45231, 103.90087')
    expect(put).not.toHaveBeenCalled()
  })

  it('says the map is unavailable without the click hint, and the bar still works', async () => {
    vi.mocked(loadGoogleMaps).mockResolvedValue(null)
    const { onSaved } = open()
    fireEvent.click(row('Plant Room').getByRole('button', { name: 'Pin on the map' }))
    expect(await screen.findByText(/map isn’t available/)).toBeInTheDocument()
    expect(screen.queryByText(/Click the map to place/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Set Pin' })))
    expect(sent()).toEqual({ block: 'Plant Room', point: { lat: 1.2966, lng: 103.852 } })
    expect(onSaved).toHaveBeenCalled()
  })
})

describe('the Edit buttons', () => {
  it('name what they edit', () => {
    render(<DetailsContent v={workflow()} record={RECORD} onEditSite={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Edit Site' })).toHaveAttribute('title', 'Edit Site')
  })

  it('stay greyed, not gone, when the site is someone else’s to change', () => {
    render(<DetailsContent v={workflow()} record={RECORD} siteReason="Two other reports use it." />)
    expect(screen.getByRole('button', { name: 'Edit Site' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

describe('toasts raised from the panel', () => {
  it('appear inside the panel’s dialog, so their Undo is not covered by it', async () => {
    const undo = vi.fn()
    // The app's toaster sits outside the modal dialog, and the dialog's own is inside it.
    render(
      <>
        <Toaster />
        <dialog open data-testid="panel">
          <DetailsToaster />
        </dialog>
      </>,
    )
    act(() => {
      toast.success('Pin removed', {
        action: { label: 'Undo', onClick: undo },
        toasterId: DETAILS_TOASTER,
      })
    })
    const dialog = screen.getByTestId('panel')
    const button = await within(dialog).findByRole('button', { name: 'Undo' })
    expect(within(dialog).getByText('Pin removed')).toBeInTheDocument()
    // Shown once: the app's own toaster ignores a toast sent to the panel's.
    expect(screen.getAllByText('Pin removed')).toHaveLength(1)
    fireEvent.click(button)
    expect(undo).toHaveBeenCalled()
  })
})

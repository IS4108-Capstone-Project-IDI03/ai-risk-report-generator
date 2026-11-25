// The Details panel's blocks and its site map (AS-06, boards D1, D2, D3). jsdom lays nothing
// out, so the panel's height is faked to test the budgets; Google Maps is faked
// (its script never loads in jsdom).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGoogleMaps } from '../../assessments/googleMaps'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { DetailsContent, type DetailedRecord } from './DetailsContent'
import { DetailsPanel } from './DetailsPanel'
import { toast, Toaster } from '../../../design-system'
import { DetailsToaster } from './DetailsToaster'
import { DETAILS_TOASTER } from './detailsToast'
import { PlacingBar } from './PlacingBar'
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

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
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

  it('draws every text link in the heading rows in Marsh navy', async () => {
    serveDocuments(DOCS)
    showDetails()
    await screen.findByRole('heading', { name: 'Client Documents' })
    for (const name of [/See All Site Contacts/, /Open Map/])
      expect(screen.getByRole('button', { name })).toHaveStyle({ color: 'var(--marsh-navy)' })
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
    expect(
      row('Site').getByRole('link', { name: 'Directions to Site, opens in a new tab' }),
    ).toBeInTheDocument()
    for (const name of ['Move Pin for Site', 'Remove Pin for Site'])
      expect(row('Site').getByRole('button', { name })).toBeInTheDocument()
    expect(
      row('Cold Store Block').getByRole('button', { name: 'Pin on the Map for Cold Store Block' }),
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
    fireEvent.click(
      row('Dispatch Hall').getByRole('button', { name: 'Pin on the Map for Dispatch Hall' }),
    )
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
    fireEvent.click(
      row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
    )
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '91, 103' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Pin' }))
    expect(await screen.findByText(/latitude from -90 to 90/)).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Set Pin' })))
    expect(sent()).toEqual({ block: 'Plant Room', point: { lat: 1.2966, lng: 103.852 } })
    fireEvent.click(
      row('Loading Bays').getByRole('button', { name: 'Pin on the Map for Loading Bays' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Coordinates')).not.toBeInTheDocument()
  })

  it('keeps Set Pin greyed, focusable and explained until there are coordinates to set', () => {
    open()
    fireEvent.click(
      row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
    )
    const setPin = screen.getByRole('button', { name: 'Set Pin' })
    expect(setPin).toHaveAttribute('aria-disabled', 'true')
    expect(setPin).not.toBeDisabled()
    expect(setPin).toHaveAccessibleDescription('Can’t set yet. Type or find the coordinates first.')
    fireEvent.click(setPin)
    expect(put).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    // The reason's wrapper comes and goes with it, so the button is looked up again.
    expect(screen.getByRole('button', { name: 'Set Pin' })).not.toHaveAttribute('aria-disabled')
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Set Pin' })).toHaveAttribute('aria-disabled', 'true')
  })

  describe('the bar’s Enter key', () => {
    const bar = (typed: string, busy: boolean) => {
      const onSet = vi.fn()
      render(
        <PlacingBar
          typed={typed}
          onTyped={vi.fn()}
          onSet={onSet}
          onCancel={vi.fn()}
          onProblem={vi.fn()}
          busy={busy}
        />,
      )
      fireEvent.keyDown(screen.getByLabelText('Coordinates'), { key: 'Enter' })
      return onSet
    }
    it('sets the pin when there are coordinates', () => {
      expect(bar('1.2966, 103.852', false)).toHaveBeenCalledTimes(1)
    })
    it('does nothing on an empty field', () => {
      expect(bar('  ', false)).not.toHaveBeenCalled()
    })
    it('does nothing while a save is under way, so a double Enter sends one', () => {
      expect(bar('1.2966, 103.852', true)).not.toHaveBeenCalled()
    })
  })

  it('names each place in the button’s own name, and keeps the tooltip to the action', () => {
    open()
    const remove = row('Administration').getByRole('button', {
      name: 'Remove Pin for Administration',
    })
    expect(remove).not.toHaveAttribute('title')
    fireEvent.mouseEnter(remove.parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Remove Pin$/)
  })

  it('moves focus into Coordinates when the bar opens, and back to the row’s button when it closes', async () => {
    open()
    const pin = row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' })
    // Clicked without being focused first, as in Safari, which does not focus a clicked button.
    fireEvent.click(pin)
    expect(screen.getByLabelText('Coordinates')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() =>
      expect(
        row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
      ).toHaveFocus(),
    )
    // After a save the bar closes the same way.
    fireEvent.click(
      row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
    )
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Set Pin' })))
    await vi.waitFor(() => expect(screen.queryByLabelText('Coordinates')).not.toBeInTheDocument())
    await vi.waitFor(() =>
      expect(
        row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
      ).toHaveFocus(),
    )
  })

  it('leaves the keyboard alone on a phone, where focusing Coordinates would pop it up', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    open()
    fireEvent.click(
      row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
    )
    expect(screen.getByLabelText('Coordinates')).not.toHaveFocus()
  })

  it('moves and removes a pin', async () => {
    open()
    await act(async () =>
      fireEvent.click(
        row('Administration').getByRole('button', { name: 'Remove Pin for Administration' }),
      ),
    )
    expect(sent()).toEqual({ block: 'Administration', point: null })
    fireEvent.click(row('Site').getByRole('button', { name: 'Move Pin for Site' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.46, 103.91)
    expect(sent()).toEqual({ coordinates: { lat: 1.46, lng: 103.91 } })
  })

  it('says a removal and offers Undo, which puts the pin back where it was', async () => {
    const { onSaved } = open()
    await act(async () =>
      fireEvent.click(
        row('Administration').getByRole('button', { name: 'Remove Pin for Administration' }),
      ),
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
    fireEvent.click(row('Site').getByRole('button', { name: 'Move Pin for Site' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.46, 103.91)
    expect(onSaved).toHaveBeenLastCalledWith('Pin moved', undefined)
  })

  it('shows directions but no changes to someone who may not edit', () => {
    open({ canEdit: false })
    expect(
      row('Site').getByRole('link', { name: 'Directions to Site, opens in a new tab' }),
    ).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=1.4521,103.9012')
    expect(
      screen.queryByRole('button', { name: /Move Pin|Remove Pin|Pin on the Map/ }),
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
    fireEvent.click(
      row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use My Location' })))
    expect(screen.getByLabelText('Coordinates')).toHaveValue('1.45231, 103.90087')
    expect(put).not.toHaveBeenCalled()
  })

  it('says the map is unavailable without the click hint, and the bar still works', async () => {
    vi.mocked(loadGoogleMaps).mockResolvedValue(null)
    const { onSaved } = open()
    fireEvent.click(
      row('Plant Room').getByRole('button', { name: 'Pin on the Map for Plant Room' }),
    )
    expect(await screen.findByText(/map isn’t available/)).toBeInTheDocument()
    expect(screen.queryByText(/Click the map to place/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '1.2966, 103.852' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Set Pin' })))
    expect(sent()).toEqual({ block: 'Plant Room', point: { lat: 1.2966, lng: 103.852 } })
    expect(onSaved).toHaveBeenCalled()
  })
})

describe('the Edit buttons', () => {
  it('name what they edit, in a real tooltip rather than a native title', () => {
    render(<DetailsContent v={workflow()} record={RECORD} onEditSite={vi.fn()} />)
    const edit = screen.getByRole('button', { name: 'Edit Site' })
    expect(edit).not.toHaveAttribute('title')
    fireEvent.mouseEnter(edit.parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Edit Site')
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

// Who may edit: the panel's own check (ovEdit), as the Edit Details button uses.
const EDIT = { record: RECORD, site: { allowed: true, assessments: 1, reason: null } }
const editable = (over: Record<string, unknown> = {}) => workflow({ ovEdit: EDIT, ...over })

describe('the panel header', () => {
  const panel = (v = editable()) =>
    render(
      <DetailsPanel
        v={{ ...v, liveRecord: RECORD } as AssessmentWorkflow}
        open
        onClose={vi.fn()}
      />,
    )

  it('has Edit Details as an icon named by its tooltip, like Edit Site, and a Close with a real tooltip', () => {
    serveDocuments([])
    panel()
    // Round 10: no words on the button; the same icon button as Edit Site.
    const edit = screen.getByRole('button', { name: 'Edit Details' })
    expect(edit).toHaveTextContent('')
    fireEvent.mouseEnter(edit.parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Edit Details')
    fireEvent.mouseLeave(edit.parentElement!)
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).not.toHaveAttribute('title')
    fireEvent.mouseEnter(close.parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close')
  })

  it('opens the Edit Assessment Details dialog from that button', () => {
    serveDocuments([])
    panel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Details' }))
    expect(screen.getByRole('dialog', { name: 'Edit Assessment Details' })).toBeInTheDocument()
  })

  it('closes on a click on the backdrop, but not when a text drag began inside the panel', () => {
    serveDocuments([])
    const onClose = vi.fn()
    render(
      <DetailsPanel
        v={{ ...editable(), liveRecord: RECORD } as AssessmentWorkflow}
        open
        onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Details' })
    // Press in the panel, release on the backdrop (a text selection that ran too far).
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Details' }))
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    // Press and release on the backdrop.
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers no Edit Details to someone who may not edit', () => {
    serveDocuments([])
    panel(workflow())
    expect(screen.queryByRole('button', { name: 'Edit Details' })).not.toBeInTheDocument()
  })
})

describe('adding a client document from the panel', () => {
  const NEW = {
    ...DOCS[0],
    id: 'd9',
    name: 'Fire Plan.pdf',
    placement: { kind: 'assessment', assessmentId: 'a1' },
  }
  const calls: { url: string; init?: RequestInit }[] = []
  function serve(post: () => Response | Promise<Response>) {
    calls.length = 0
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(init?.method === 'POST' ? post() : Response.json([]))
    })
  }
  const show = () =>
    render(
      <>
        <dialog open>
          <DetailsToaster />
          <DetailsContent v={editable()} record={RECORD} toasterId={DETAILS_TOASTER} />
        </dialog>
      </>,
    )
  const choose = (name = 'Fire Plan.pdf') =>
    fireEvent.change(screen.getByLabelText('Choose client documents to add'), {
      target: { files: [new File(['x'], name, { type: 'application/pdf' })] },
    })

  it('shows a dashed Add Document row where there are none, only to someone who may edit', async () => {
    serve(() => Response.json({}))
    show()
    expect(await screen.findByRole('button', { name: 'Add Document' })).toBeInTheDocument()
    cleanup()
    serveDocuments([])
    render(<DetailsContent v={workflow()} record={RECORD} />)
    await screen.findAllByText('None yet')
    expect(screen.queryByRole('button', { name: 'Add Document' })).not.toBeInTheDocument()
  })

  it('uploads to this assessment, lists it, and says so in one toast inside the panel', async () => {
    let listed = false
    serve(() => {
      listed = true
      return Response.json(
        { files: [{ name: NEW.name, status: 'kept', document: NEW }] },
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (init?.method === 'POST')
        return Promise.resolve(
          Response.json(
            { files: [{ name: NEW.name, status: 'kept', document: NEW }] },
            { status: 201 },
          ),
        )
      listed = listed || false
      return Promise.resolve(Response.json(listed ? [NEW] : []))
    })
    show()
    await screen.findByRole('button', { name: 'Add Document' })
    await act(async () => choose())
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(post.url).toBe('/api/clients/c1/documents')
    expect((post.init!.body as FormData).get('placement')).toBe(
      JSON.stringify({ kind: 'assessment', assessmentId: 'a1' }),
    )
    expect(await screen.findByText('1 document uploaded')).toBeInTheDocument()
    expect(screen.getAllByText('1 document uploaded')).toHaveLength(1)
  })

  it('shows the add row busy: still focusable, but it ignores presses while the files go up', async () => {
    let finish: (r: Response) => void = () => {}
    serve(() => new Promise<Response>((resolve) => (finish = resolve)))
    show()
    const add = await screen.findByRole('button', { name: 'Add Document' })
    add.focus()
    await act(async () => choose())
    const busy = screen.getByRole('button', { name: 'Add Document' })
    // aria-disabled, not disabled: a disabled button would drop the keyboard user's focus.
    expect(busy).not.toBeDisabled()
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveFocus()
    const picker = screen.getByLabelText('Choose client documents to add')
    const opened = vi.spyOn(picker, 'click')
    fireEvent.click(busy)
    expect(opened).not.toHaveBeenCalled()
    await act(async () => finish(Response.json({ files: [] }, { status: 201 })))
    expect(screen.getByRole('button', { name: 'Add Document' })).not.toHaveAttribute(
      'aria-disabled',
    )
  })

  it('puts focus back on the add control that replaces the add row once the first document is in', async () => {
    let listed = false
    vi.stubGlobal('fetch', (_: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        listed = true
        return Promise.resolve(
          Response.json(
            { files: [{ name: NEW.name, status: 'kept', document: NEW }] },
            { status: 201 },
          ),
        )
      }
      return Promise.resolve(Response.json(listed ? [NEW] : []))
    })
    show()
    const row = await screen.findByRole('button', { name: 'Add Document' })
    expect(row).toHaveClass('ds-add-row')
    row.focus()
    await act(async () => choose())
    await vi.waitFor(() => expect(screen.getByText('Fire Plan.pdf')).toBeInTheDocument())
    // The row has gone and the plus beside the heading took its place, with the keyboard on it.
    const plus = screen.getByRole('button', { name: 'Add Document' })
    expect(plus).not.toHaveClass('ds-add-row')
    // Shaded, so it reads as a button and not a stray plus (round 10).
    expect(plus).toHaveClass('ds-icon-button--shaded')
    await vi.waitFor(() => expect(plus).toHaveFocus())
  })

  it('leaves focus alone when it was not on the add control', async () => {
    let listed = false
    vi.stubGlobal('fetch', (_: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        listed = true
        return Promise.resolve(
          Response.json(
            { files: [{ name: NEW.name, status: 'kept', document: NEW }] },
            { status: 201 },
          ),
        )
      }
      return Promise.resolve(Response.json(listed ? [NEW] : []))
    })
    show()
    await screen.findByRole('button', { name: 'Add Document' })
    await act(async () => choose())
    await vi.waitFor(() => expect(screen.getByText('Fire Plan.pdf')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Add Document' })).not.toHaveFocus()
  })

  it('shows the result in the app’s own toaster when the panel was closed while the files went up', async () => {
    let finish: (r: Response) => void = () => {}
    serve(() => new Promise<Response>((resolve) => (finish = resolve)))
    const view = render(
      <>
        <Toaster />
        <dialog open>
          <DetailsToaster />
          <DetailsContent v={editable()} record={RECORD} toasterId={DETAILS_TOASTER} />
        </dialog>
      </>,
    )
    await screen.findByRole('button', { name: 'Add Document' })
    await act(async () => choose())
    // The panel closes: its dialog, its toaster and its content all unmount.
    view.rerender(<Toaster />)
    await act(async () =>
      finish(
        Response.json(
          { files: [{ name: NEW.name, status: 'kept', document: NEW }] },
          { status: 201 },
        ),
      ),
    )
    expect(await screen.findByText('1 document uploaded')).toBeInTheDocument()
  })

  it('says why when a file is refused, with the same words as the client page', async () => {
    serve(() =>
      Response.json(
        { files: [{ name: 'a.zip', status: 'refused', reason: 'Can’t read .zip files.' }] },
        { status: 400 },
      ),
    )
    show()
    await screen.findByRole('button', { name: 'Add Document' })
    await act(async () => choose('a.zip'))
    expect(await screen.findByText('a.zip not uploaded')).toBeInTheDocument()
    expect(screen.getByText('Can’t read .zip files.')).toBeInTheDocument()
  })

  it('says it failed when the gateway cannot be reached', async () => {
    serve(() => {
      throw new TypeError('Failed to fetch')
    })
    show()
    await screen.findByRole('button', { name: 'Add Document' })
    await act(async () => choose())
    expect(await screen.findByText('Upload failed')).toBeInTheDocument()
  })

  it('counts the documents on the heading, and keeps the add action on the heading row once there are some', async () => {
    serveDocuments(DOCS)
    render(<DetailsContent v={editable()} record={RECORD} />)
    const docs = (await screen.findByRole('heading', { name: 'Client Documents' })).closest(
      'section',
    )!
    expect(within(docs).getByText('5')).toBeInTheDocument()
    expect(within(docs).getByRole('button', { name: 'Add Document' })).toBeInTheDocument()
  })
})

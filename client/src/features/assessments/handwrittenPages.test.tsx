import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { SavedObservation, SavedPage } from './api'

// Scanning handwritten notes (CP-19): Scan mode on the capture screen, and
// each page with its transcript on the Observations tab.

const REF = 'RPT-2026-0411'
const CAPTURE_URL = `/api/assessments/${REF}/capture-session`
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', building: 'Warehouse', name: 'Bay 3 — north aisle', floor: 'Ground' }
const CAPTURE = {
  session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
  assessment: {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
  },
}

function page(id: string, transcription: Partial<SavedPage['transcription']> = {}): SavedPage {
  return {
    id,
    name: 'Page 1',
    contentType: 'image/jpeg',
    size: 1200,
    url: `/api/observations/o1/pages/${id}/image`,
    transcription: {
      status: 'transcribing',
      transcript: null,
      uncertain: [],
      error: null,
      attempts: 1,
      model: null,
      ...transcription,
    },
  }
}
function observation(fields: Partial<SavedObservation> = {}): SavedObservation {
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
    pages: [],
    removedRecordings: [],
    removedPhotos: [],
    interpretation: null,
    recordedAt: '2026-09-29T08:10:00.000Z',
    edited: null,
    deleted: null,
    ...fields,
  }
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A small stand-in for the gateway, answering by route. A save echoes what
// was sent, as the gateway does, each page starting to transcribe.
type Sent = { details: Record<string, unknown>; photos: File[]; pages: File[] }
let listed: SavedObservation[] = []
let saveReply: (sent: Sent) => Promise<Response>
const saves: Sent[] = []
const retries: string[] = []
const againRequests: string[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === CAPTURE_URL) return json(201, CAPTURE)
    if (url === OBS_URL && init.method === 'POST') {
      const form = init.body as FormData
      const sent = {
        details: JSON.parse(String(form.get('details'))),
        photos: form.getAll('photo') as File[],
        pages: form.getAll('page') as File[],
      }
      saves.push(sent)
      return saveReply(sent)
    }
    if (url === OBS_URL || url === OBS_URL + '?include=deleted') return json(200, listed)
    if (url === LOCATIONS_URL) return json(200, [BAY_3])
    if (url.endsWith('/transcription/retry')) {
      retries.push(url)
      listed = listed.map((item) => ({
        ...item,
        pages: (item.pages ?? []).map((p) => ({
          ...p,
          transcription: { ...p.transcription, status: 'transcribing', error: null },
        })),
      }))
      return Promise.resolve(new Response(null, { status: 202 }))
    }
    // Transcribing a finished page again clears its text as the attempt starts.
    if (url.endsWith('/retranscribe') && init.method === 'POST') {
      againRequests.push(url)
      listed = listed.map((item) => ({
        ...item,
        pages: (item.pages ?? []).map((p) => ({
          ...p,
          transcription: {
            ...p.transcription,
            status: 'transcribing',
            transcript: null,
            uncertain: [],
          },
        })),
      }))
      return json(200, listed[0])
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}
function echo(sent: Sent) {
  const saved = observation({
    note: (sent.details.note as string | undefined) ?? null,
    pages: sent.pages.map((file, i) => ({ ...page('pg' + i), name: file.name })),
  })
  listed = [saved]
  return json(201, saved)
}

async function openApp() {
  render(<App />)
  await signIn()
}
async function openCapture() {
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
  await screen.findByRole('img', { name: 'live' })
  fireEvent.click(
    await screen.findByRole('button', { name: /^Warehouse · Ground · Bay 3 — north aisle/ }),
  )
}
async function openObservations() {
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const scanMode = () => click(/^Scan/)
const grade = (severity: string) => fireEvent.click(screen.getByRole('radio', { name: severity }))
const save = () => click('Save observation')
const leave = () => click('Back to observations')
const pageList = () => screen.getByRole('region', { name: 'Pages' })
// A page photo as the device hands it over, taken or chosen.
const photo = (name = 'IMG_0710.jpg', type = 'image/jpeg') => new File(['jpeg'], name, { type })
const choosePages = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText('Choose pages'), { target: { files } })
const photographPage = (file: File) =>
  fireEvent.change(screen.getByLabelText('Photograph a page'), { target: { files: [file] } })

beforeAll(() => {
  URL.createObjectURL = () => 'blob:page'
  URL.revokeObjectURL = () => {}
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  listed = []
  saves.length = 0
  retries.length = 0
  againRequests.length = 0
  saveReply = echo
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Scanning handwritten pages on the capture screen (CP-19)', () => {
  it('photographs one page or chooses several, as for photos', async () => {
    await openCapture()
    scanMode()

    const camera = screen.getByLabelText('Photograph a page')
    expect(camera).toHaveAttribute('capture', 'environment')
    expect(camera).toHaveAttribute('accept', 'image/jpeg,image/png')
    expect(camera).not.toHaveAttribute('multiple')
    expect(screen.getByLabelText('Choose pages')).toHaveAttribute('multiple')
    expect(
      screen.getByText('JPG or PNG, one photo per page. Each page is transcribed once you save.'),
    ).toBeInTheDocument()
  }, 10000)

  it('lists the pages, counts them on the switcher and saves them on their own (AC1, AC3)', async () => {
    await openCapture()
    scanMode()
    photographPage(photo('image.jpg'))
    choosePages(photo('notes-2.jpg'), photo('notes-3.png', 'image/png'))

    expect(within(pageList()).getByText('image.jpg')).toBeInTheDocument()
    click('Remove notes-3.png')
    expect(within(pageList()).queryByText('notes-3.png')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan, 2 pages' })).toBeInTheDocument()
    grade('Moderate')
    save()

    expect(
      await screen.findByText('Observation saved to RPT-2026-0411. Transcribing 2 pages now.'),
    ).toBeInTheDocument()
    expect(saves[0].pages.map((f) => f.name)).toEqual(['image.jpg', 'notes-2.jpg'])
    // Pages are not site photos (AC5).
    expect(saves[0].photos).toEqual([])
    expect(saves[0].details).not.toHaveProperty('note')
    expect(screen.queryByRole('region', { name: 'Pages' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument()
  })

  it('refuses a file that is not a JPG or PNG, saying why (AC2)', async () => {
    await openCapture()
    scanMode()

    choosePages(photo('notes.heic', 'image/heic'), photo())

    expect(screen.getByRole('alert')).toHaveTextContent(
      'notes.heic is not a JPG or PNG image. Save it as JPG or PNG and add it again.',
    )
    expect(within(pageList()).queryByText('notes.heic')).not.toBeInTheDocument()
    expect(within(pageList()).getByText('IMG_0710.jpg')).toBeInTheDocument()
  })

  it('names pages among what leaving would discard', async () => {
    await openCapture()
    scanMode()
    choosePages(photo())

    leave()

    expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toHaveTextContent(
      'Not saved yet: 1 page.',
    )
  })

  it('reads the list again after saving, so a page that failed shows as failed (AC7)', async () => {
    saveReply = (sent) => {
      const reply = echo(sent)
      listed = [{ ...listed[0], pages: [page('pg0', { status: 'failed', error: 'Timed out.' })] }]
      return reply
    }
    await openCapture()
    scanMode()
    choosePages(photo())
    grade('High')

    save()
    await screen.findByText(/Observation saved/)
    leave()

    expect(await screen.findByRole('button', { name: /Transcription failed/ })).toBeInTheDocument()
  })

  it('keeps pages in this browser without a capture session, and says they are not transcribed', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET') sent.push(url)
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
    await screen.findByText('Showing sample data')
    fireEvent.click(await screen.findByRole('button', { name: /^Warehouse/, expanded: false }))
    fireEvent.click(
      screen.getByRole('button', { name: /^Warehouse · Ground · Bay 3 — north aisle/ }),
    )
    scanMode()
    expect(
      screen.getByText(
        'No capture session, so pages stay in this browser and are not transcribed.',
      ),
    ).toBeInTheDocument()
    choosePages(photo())
    grade('Low')
    save()
    expect(await screen.findByText(/kept in this demo only/)).toBeInTheDocument()

    leave()
    fireEvent.click(screen.getByRole('button', { name: /1 handwritten page captured at Bay 3/ }))
    const entry = screen.getByRole('region', { name: 'IMG_0710.jpg' })
    expect(
      within(entry).getByText(
        'No capture session, so this page stays in this browser and is not transcribed.',
      ),
    ).toBeInTheDocument()
    // Only the attempt to start a capture session; the page went nowhere.
    expect(sent).toEqual([CAPTURE_URL])
  }, 10000)
})

describe('Handwritten pages on the Observations tab (CP-19)', () => {
  it('shows each page’s transcript, its uncertain words marked, beside its original (AC8, AC9)', async () => {
    const text = 'B1 spk CV found shut,\nno tamper sw'
    listed = [
      observation({
        pages: [
          page('pg1', {
            status: 'transcribed',
            transcript: text,
            uncertain: [[32, 34]],
            model: 'gemini-3.8-flash',
          }),
        ],
      }),
    ]
    await openObservations()

    // The row reads as the page's handwriting, and names its type.
    const row = await screen.findByRole('button', { name: /B1 spk CV found shut/ })
    expect(row).toHaveTextContent('Scan')
    fireEvent.click(row)

    const entry = screen.getByRole('region', { name: 'Page 1' })
    expect(within(entry).getByText('Transcribed')).toBeInTheDocument()
    expect(within(entry).getByText('1 word unsure. Check it against the page.')).toBeInTheDocument()
    const unsure = entry.querySelector('mark')!
    expect(unsure).toHaveTextContent('sw (unsure)')
    expect(entry).toHaveTextContent('B1 spk CV found shut, no tamper sw (unsure)')
    click('Open Page 1')
    expect(screen.getByRole('dialog', { name: 'Page 1' })).toBeInTheDocument()
  })

  it('says when a page has no handwriting, or is still being transcribed (AC4, AC10)', async () => {
    listed = [
      observation({
        id: 'o2',
        note: 'Blank page captured.',
        pages: [page('pg2', { status: 'transcribed', transcript: '' })],
      }),
      observation({ note: 'Still reading.', pages: [page('pg1')] }),
    ]
    await openObservations()

    // Its status comes from the page's transcription.
    const reading = await screen.findByRole('button', { name: /Still reading\./ })
    expect(reading).toHaveTextContent('Transcribing')
    fireEvent.click(reading)
    expect(screen.getByText('Transcribing the page…')).toBeInTheDocument()
    fireEvent.click(reading)

    fireEvent.click(screen.getByRole('button', { name: /Blank page captured\./ }))
    expect(screen.getByText('No handwriting was found on this page.')).toBeInTheDocument()
  })

  it('shows why a page failed and retries that page (AC11)', async () => {
    listed = [
      observation({
        pages: [
          page('pg9', {
            status: 'failed',
            error: 'The handwriting service could not transcribe the page.',
          }),
        ],
      }),
    ]
    await openObservations()

    fireEvent.click(await screen.findByRole('button', { name: /Transcription failed/ }))
    expect(
      screen.getByText('The handwriting service could not transcribe the page.'),
    ).toBeInTheDocument()
    click('Retry transcription')

    await vi.waitFor(() =>
      expect(retries).toEqual(['/api/observations/o1/pages/pg9/transcription/retry']),
    )
    expect((await screen.findAllByText('Transcribing')).length).toBeGreaterThan(0)
  })

  it('filters by the Scan type (AC4)', async () => {
    listed = [
      observation({ id: 'o2', note: 'Typed note only.' }),
      observation({
        note: 'With a page.',
        pages: [page('pg1', { status: 'transcribed', transcript: 'spk ok' })],
      }),
    ]
    await openObservations()
    await screen.findByRole('button', { name: /With a page\./ })

    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    const panel = screen.getByRole('dialog', { name: 'Filters' })
    fireEvent.change(within(panel).getByLabelText(/^Type/), { target: { value: 'Scan' } })

    expect(screen.queryByText('Typed note only.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /With a page\./ })).toBeInTheDocument()
  })

  it('transcribes a finished page again when its text looks misread (CP-20)', async () => {
    listed = [
      observation({
        note: 'Pump room readings.',
        pages: [page('pg1', { status: 'transcribed', transcript: 'FHR 7 bor' })],
      }),
    ]
    await openObservations()
    fireEvent.click(await screen.findByRole('button', { name: /Pump room readings\./ }))

    click('Transcribe again')

    await vi.waitFor(() =>
      expect(againRequests).toEqual(['/api/observations/o1/pages/pg1/retranscribe']),
    )
    // The old text goes while the page is read again.
    expect(await screen.findByText('Transcribing the page…')).toBeInTheDocument()
    expect(screen.queryByText('FHR 7 bor')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transcribe again' })).not.toBeInTheDocument()
  })

  it('offers Retry, not Transcribe again, for a page that failed (CP-20)', async () => {
    listed = [
      observation({
        note: 'Failed page.',
        pages: [page('pg1', { status: 'failed', error: 'Timed out.' })],
      }),
    ]
    await openObservations()
    fireEvent.click(await screen.findByRole('button', { name: /Failed page\./ }))

    expect(screen.getByRole('button', { name: 'Retry transcription' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transcribe again' })).not.toBeInTheDocument()
  })
})

describe('The Scans view (CP-19)', () => {
  it('lists every handwritten page with its transcript, leaving deleted observations out', async () => {
    listed = [
      observation({
        note: 'Pump room readings.',
        pages: [
          page('pg1', {
            status: 'transcribed',
            transcript: 'FHR 7 bar',
            uncertain: [[4, 5]],
          }),
          { ...page('pg2', { status: 'failed', error: 'Timed out.' }), name: 'Page 2' },
        ],
      }),
      observation({
        id: 'o9',
        note: 'Deleted one.',
        pages: [{ ...page('pg9', { status: 'transcribed', transcript: 'gone' }), name: 'Page 9' }],
        deleted: { at: '2026-09-29T09:00:00.000Z', by: { id: 'u1', name: 'Alex Rowe' } },
      }),
    ]
    await openObservations()
    await screen.findByRole('button', { name: /Pump room readings\./ })

    // The Observations tab's Scans box counts them, beside Photos, and opens the view.
    fireEvent.click(screen.getByRole('button', { name: /^Scans, 2, pages\. Open/ }))

    const view = screen.getByRole('list', { name: 'Handwritten pages' })
    expect(within(view).getAllByRole('listitem')).toHaveLength(2)
    // The Observations tab stays selected while it shows.
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const first = within(view).getByRole('region', { name: 'Page 1' })
    expect(first).toHaveTextContent('FHR 7 (unsure) bar')
    expect(within(first).getByRole('button', { name: 'Transcribe again' })).toBeInTheDocument()
    const second = within(view).getByRole('region', { name: 'Page 2' })
    expect(within(second).getByRole('button', { name: 'Retry transcription' })).toBeInTheDocument()
    expect(within(view).queryByText('gone')).not.toBeInTheDocument()

    // The original opens to zoom into, and each page leads back to its observation.
    click('Open Page 1')
    expect(screen.getByRole('dialog', { name: 'Page 1' })).toBeInTheDocument()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Page 1' })).getByRole('button', { name: 'Close' }),
    )
    fireEvent.click(
      within(within(view).getAllByRole('listitem')[0]).getByRole('button', {
        name: 'Go to observation',
      }),
    )
    expect(screen.getByRole('region', { name: 'Page 1' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Handwritten pages' })).not.toBeInTheDocument()
  })

  it('says when there are no pages yet', async () => {
    listed = [observation({ note: 'Typed note only.' })]
    await openObservations()
    await screen.findByRole('button', { name: /Typed note only\./ })

    fireEvent.click(screen.getByRole('button', { name: /^Scans, 0, pages\. Open/ }))

    expect(screen.getByText('No handwritten pages yet')).toBeInTheDocument()
    click('Back to observations')
    expect(screen.getByRole('button', { name: /Typed note only\./ })).toBeInTheDocument()
  })
})

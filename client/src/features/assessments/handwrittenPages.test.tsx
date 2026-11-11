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
    // Transcribing a finished page again clears its text, and any correction,
    // as the attempt starts (CP-20).
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
            correction: null,
          },
        })),
      }))
      return json(200, listed[0])
    }
    // Managing a saved observation's pages (CP-20).
    const pageRoute =
      /^\/api\/observations\/o1\/(media|pages\/([^/]+)(\/transcript|\/restore)?)$/.exec(url)
    if (pageRoute) return pageChange(init, pageRoute[1], pageRoute[2], pageRoute[3])
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}
// What the gateway does with a change to o1's pages (CP-20), unless the next
// change is to be refused.
const BY = { id: 'u1', name: 'Alex Rowe' }
const AT = '2026-09-29T10:00:00.000Z'
let refuseNext: Promise<Response> | null = null
const pageChanges: { method: string; path: string; body: unknown }[] = []
function pageChange(init: RequestInit, path: string, pageId?: string, action?: string) {
  const method = init.method ?? 'GET'
  const form = init.body instanceof FormData ? init.body : null
  const body = form
    ? { pages: (form.getAll('page') as File[]).map((file) => file.name) }
    : init.body
      ? JSON.parse(String(init.body))
      : undefined
  pageChanges.push({ method, path, body })
  if (refuseNext) {
    const refused = refuseNext
    refuseNext = null
    return refused
  }
  const o = listed[0]
  const pages = o.pages ?? []
  const removedPages = o.removedPages ?? []
  let next: SavedObservation
  if (path === 'media')
    next = {
      ...o,
      pages: [
        ...pages,
        ...(form!.getAll('page') as File[]).map((file, i) => ({
          ...page('added' + i),
          name: file.name,
          added: { at: AT, by: BY },
        })),
      ],
    }
  else if (action === '/transcript')
    next = {
      ...o,
      pages: pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              transcription: {
                ...p.transcription,
                correction: { text: (body as { text: string }).text, at: AT, by: BY },
              },
            }
          : p,
      ),
    }
  else if (action === '/restore')
    next = {
      ...o,
      pages: [...pages, ...removedPages.filter((p) => p.id === pageId)],
      removedPages: removedPages.filter((p) => p.id !== pageId),
    }
  else
    next = {
      ...o,
      pages: pages.filter((p) => p.id !== pageId),
      removedPages: [
        ...removedPages,
        ...pages.filter((p) => p.id === pageId).map((p) => ({ ...p, removed: { at: AT, by: BY } })),
      ],
    }
  listed = [{ ...next, edited: { at: AT, by: BY } }, ...listed.slice(1)]
  return json(200, listed[0])
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
  addManually()
  await screen.findByRole('img', { name: 'live' })
  fireEvent.click(
    await screen.findByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
  )
}
async function openObservations() {
  await openApp()
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// Capture starts from the Observations tab's Add manually button.
function addManually() {
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  click('Add manually')
}
const scanMode = () => click(/^Scan/)
const grade = (severity: string) => fireEvent.click(screen.getByRole('radio', { name: severity }))
const save = () => click('Save observation')
const leave = () => click('Back to Observations')
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
  pageChanges.length = 0
  refuseNext = null
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
    // Pages go to an external AI service unmasked, so personal details are best left off
    // (PV-04 keeps handwriting outside protection).
    expect(
      screen.getByText(
        'Leave names, phone numbers and ID numbers off the page: an external AI service reads it.',
      ),
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
      await screen.findByText('Observation saved. Transcribing 2 pages now.'),
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

    expect(screen.getByRole('alert')).toHaveTextContent('notes.heic isn’t a JPG or PNG.')
    expect(within(pageList()).queryByText('notes.heic')).not.toBeInTheDocument()
    expect(within(pageList()).getByText('IMG_0710.jpg')).toBeInTheDocument()
  })

  it('names pages among what leaving would discard', async () => {
    await openCapture()
    scanMode()
    choosePages(photo())

    leave()

    expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toHaveTextContent(
      'Not saved: 1 page.',
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
    addManually()
    await screen.findByText('Showing sample data')
    fireEvent.click(await screen.findByRole('button', { name: /^Warehouse/, expanded: false }))
    fireEvent.click(
      screen.getByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
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
    expect(await screen.findByText(/saved in this demo only/)).toBeInTheDocument()

    // The toast's View button opens the saved observation.
    click('View')
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

    // The row reads as the page's handwriting.
    const row = await screen.findByRole('button', { name: /B1 spk CV found shut/ })
    fireEvent.click(row)

    const entry = screen.getByRole('region', { name: 'Page 1' })
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
    click('Back to Observations')

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
    click('Retry')

    await vi.waitFor(() =>
      expect(retries).toEqual(['/api/observations/o1/pages/pg9/transcription/retry']),
    )
    expect(await screen.findByText('Transcribing the page…')).toBeInTheDocument()
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

    click('Type')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Scan' }))

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

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transcribe again' })).not.toBeInTheDocument()
  })
})

describe('Managing saved pages (CP-20)', () => {
  const READINGS = 'Pump room readings.'
  const transcribed = (transcript: string, fields: Partial<SavedPage['transcription']> = {}) =>
    page('pg1', { status: 'transcribed', transcript, ...fields })
  async function openWith(pages: SavedPage[], note: string | null = READINGS) {
    listed = [observation({ note, pages })]
    await openObservations()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(note ?? 'FHR') }))
  }
  const pageEntry = () => screen.getByRole('region', { name: 'Page 1' })

  it('corrects a page’s text, shown as the engineer’s with what was transcribed kept beneath', async () => {
    await openWith([transcribed('FHR 7 bor')])

    click('Edit text of Page 1')
    const dialog = await screen.findByRole('dialog', { name: 'Edit page text' })
    // The page is shown to check the text against.
    expect(within(dialog).getByRole('img', { name: 'Photo of Page 1' })).toBeInTheDocument()
    const text = within(dialog).getByLabelText('Page text')
    expect(text).toHaveValue('FHR 7 bor')
    fireEvent.change(text, { target: { value: 'FHR 7 bar' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('Page text corrected. Report drafting uses your wording.'),
    ).toBeInTheDocument()
    expect(pageChanges).toEqual([
      { method: 'PUT', path: 'pages/pg1/transcript', body: { text: 'FHR 7 bar' } },
    ])
    const entry = pageEntry()
    expect(within(entry).getByText('FHR 7 bar')).toBeInTheDocument()
    expect(within(entry).getByText(/^Corrected by Alex Rowe · /)).toBeInTheDocument()
    // What the model wrote, folded away beneath.
    const original = within(entry).getByText('As transcribed').closest('details')!
    expect(original).toHaveTextContent('FHR 7 bor')
  })

  it('keeps the typed text and says why when a correction is refused', async () => {
    refuseNext = json(409, { error: 'This page changed while saving. Try again.' })
    await openWith([transcribed('FHR 7 bor')])
    click('Edit text of Page 1')
    const dialog = await screen.findByRole('dialog', { name: 'Edit page text' })
    fireEvent.change(within(dialog).getByLabelText('Page text'), { target: { value: 'FHR 7 bar' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This page changed while saving. Try again.',
    )
    expect(within(dialog).getByLabelText('Page text')).toHaveValue('FHR 7 bar')
  })

  it('offers no text to correct while a page is transcribing or after it failed', async () => {
    listed = [
      observation({
        note: READINGS,
        pages: [
          page('pg1'),
          { ...page('pg2', { status: 'failed', error: 'Timed out.' }), name: 'Page 2' },
        ],
      }),
    ]
    await openObservations()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(READINGS) }))

    expect(screen.queryByRole('button', { name: /^Edit text of/ })).not.toBeInTheDocument()
  })

  it('asks before transcribing a corrected page again, as the correction goes', async () => {
    await openWith([
      transcribed('FHR 7 bor', { correction: { text: 'FHR 7 bar', at: AT, by: BY } }),
    ])

    click('Transcribe again')
    const dialog = await screen.findByRole('dialog', { name: 'Transcribe this page again?' })
    expect(dialog).toHaveTextContent('Your corrected text is replaced by the new transcription')
    expect(againRequests).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transcribe again' }))

    await vi.waitFor(() =>
      expect(againRequests).toEqual(['/api/observations/o1/pages/pg1/retranscribe']),
    )
    expect(await screen.findByText('Transcribing the page…')).toBeInTheDocument()
    expect(screen.queryByText(/^Corrected by/)).not.toBeInTheDocument()
  })

  it('removes a page once confirmed, and restores it from Removed media', async () => {
    await openWith([transcribed('FHR 7 bar')])

    click('Remove Page 1')
    const confirm = await screen.findByRole('dialog', { name: 'Remove this page?' })
    expect(confirm).toHaveTextContent('The report stops using its text.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove page' }))

    expect(
      await screen.findByText(
        'Page removed. Report drafting no longer uses its text. Restore it under Removed media.',
      ),
    ).toBeInTheDocument()
    expect(pageChanges).toEqual([{ method: 'DELETE', path: 'pages/pg1', body: undefined }])
    expect(screen.queryByRole('region', { name: 'Page 1' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Removed media (1)'))
    click('Restore Page 1')
    expect(
      await screen.findByText('Page restored. Report drafting uses its text again.'),
    ).toBeInTheDocument()
    expect(pageEntry()).toHaveTextContent('FHR 7 bar')
  })

  it('offers no Remove for a page that is all the observation holds', async () => {
    listed = [observation({ pages: [transcribed('FHR 7 bar')] })]
    await openObservations()
    fireEvent.click(await screen.findByRole('button', { name: /FHR 7 bar/ }))

    expect(screen.getByRole('button', { name: 'Edit text of Page 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Page 1' })).not.toBeInTheDocument()
  })

  it('adds pages to a saved observation through Add media, each transcribed', async () => {
    await openWith([], READINGS)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add media' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Add to observation' })

    fireEvent.change(within(dialog).getByLabelText('Choose pages'), {
      target: { files: [photo('IMG_0810.jpg'), photo('notes.heic', 'image/heic')] },
    })
    // Refused here, as in Scan mode.
    expect(within(dialog).getByRole('alert')).toHaveTextContent('notes.heic isn’t a JPG or PNG.')
    expect(within(dialog).getByRole('region', { name: 'Ready to add' })).toHaveTextContent(
      'IMG_0810.jpg',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to observation' }))

    expect(await screen.findByText('Added 1 page. Transcribing 1 page now.')).toBeInTheDocument()
    expect(pageChanges).toEqual([
      { method: 'POST', path: 'media', body: { pages: ['IMG_0810.jpg'] } },
    ])
    const added = screen.getByRole('region', { name: 'IMG_0810.jpg' })
    expect(within(added).getByText('Transcribing the page…')).toBeInTheDocument()
    expect(within(added).getByText(/^Added by Alex Rowe · /)).toBeInTheDocument()
  })

  it('writes, adds, removes and restores pages of an observation in this demo only', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET') sent.push(url)
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    addManually()
    await screen.findByText('Showing sample data')
    fireEvent.click(await screen.findByRole('button', { name: /^Warehouse/, expanded: false }))
    fireEvent.click(
      screen.getByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
    )
    scanMode()
    choosePages(photo())
    grade('Low')
    save()
    await screen.findByText(/saved in this demo only/)
    click('View')

    // A demo page is never transcribed, so its text can be written by hand.
    click('Edit text of IMG_0710.jpg')
    const write = await screen.findByRole('dialog', { name: 'Edit page text' })
    fireEvent.change(within(write).getByLabelText('Page text'), {
      target: { value: 'Hydrant H2 blocked' },
    })
    fireEvent.click(within(write).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Page text saved in this demo only.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'IMG_0710.jpg' })).toHaveTextContent(
      'Hydrant H2 blocked',
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Add media' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Add to observation' })
    fireEvent.change(within(dialog).getByLabelText('Choose pages'), {
      target: { files: [photo('IMG_0811.jpg')] },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to observation' }))
    expect(await screen.findByText('Added 1 page in this demo only.')).toBeInTheDocument()

    // With a second page, the first can go, and comes back with its text.
    click('Remove IMG_0710.jpg')
    const confirm = await screen.findByRole('dialog', { name: 'Remove this page?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove page' }))
    expect(
      await screen.findByText('Page removed in this demo only. Restore it under Removed media.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Removed media (1)'))
    click('Restore IMG_0710.jpg')
    expect(await screen.findByText('Page restored in this demo only.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'IMG_0710.jpg' })).toHaveTextContent(
      'Hydrant H2 blocked',
    )
    // Only the attempt to start a capture session; nothing went anywhere.
    expect(sent).toEqual([CAPTURE_URL])
  }, 15000)
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

    // The navigator's All handwritten pages opens the view (CP-22).
    fireEvent.click(screen.getByRole('button', { name: 'All handwritten pages' }))

    const view = screen.getByRole('group', { name: 'Handwritten pages' })
    expect(within(view).getAllByRole('listitem')).toHaveLength(2)
    // The Observations tab stays selected while it shows.
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Tiles only: the transcript and its actions are read on the observation's page.
    expect(within(view).queryByText(/FHR 7/)).not.toBeInTheDocument()
    expect(within(view).queryByText('gone')).not.toBeInTheDocument()
    expect(within(view).queryByRole('button', { name: 'Open Page 9' })).not.toBeInTheDocument()

    // The original opens larger, and each page leads to its observation.
    click('Open Page 1')
    expect(screen.getByRole('dialog', { name: 'Page 1' })).toBeInTheDocument()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Page 1' })).getByRole('button', { name: 'Close' }),
    )
    fireEvent.click(
      within(within(view).getAllByRole('listitem')[0]).getByRole('button', {
        name: /Pump room readings\./,
      }),
    )
    const first = screen.getByRole('region', { name: 'Page 1' })
    expect(first).toHaveTextContent('FHR 7 (unsure) bar')
    expect(within(first).getByRole('button', { name: 'Transcribe again' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Page 2' })).getByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Handwritten pages' })).not.toBeInTheDocument()
    // Back returns to the view it was opened from, not the list.
    click('Back to All Handwritten Pages')
    expect(screen.getByRole('group', { name: 'Handwritten pages' })).toBeInTheDocument()
  })

  it('says when there are no pages yet', async () => {
    listed = [observation({ note: 'Typed note only.' })]
    await openObservations()
    await screen.findByRole('button', { name: /Typed note only\./ })

    fireEvent.click(screen.getByRole('button', { name: 'All handwritten pages' }))

    expect(screen.getByText('No handwritten pages yet')).toBeInTheDocument()
    click('Back to Observations')
    expect(screen.getByRole('button', { name: /Typed note only\./ })).toBeInTheDocument()
  })
})

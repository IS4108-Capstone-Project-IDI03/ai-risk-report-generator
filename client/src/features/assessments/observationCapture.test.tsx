import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { openProposalCapture } from '../site-walk/proposalCapture'
import type { SavedObservation, SavedRecording } from './api'

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

function recording(id: string, transcription: Partial<SavedRecording['transcription']> = {}) {
  return {
    id,
    name: 'Recording 1',
    contentType: 'audio/webm',
    size: 1200,
    url: `/api/observations/o1/recordings/${id}/audio`,
    transcription: {
      status: 'transcribing',
      transcript: null,
      correction: null,
      error: null,
      attempts: 1,
      ...transcription,
    },
    added: null,
  } satisfies SavedRecording
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

// A small stand-in for the gateway, answering by route. The dashboard list is
// unreachable, so the app falls back to its sample rows. A save echoes what
// was sent, as the gateway does.
type Sent = { details: Record<string, unknown>; recordings: File[]; photos: File[] }
let listed: SavedObservation[] = []
let saveReply: (sent: Sent) => Promise<Response>
const saves: Sent[] = []
const retries: string[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === CAPTURE_URL) return json(201, CAPTURE)
    if (url === OBS_URL && init.method === 'POST') {
      const form = init.body as FormData
      const sent = {
        details: JSON.parse(String(form.get('details'))),
        recordings: form.getAll('recording') as File[],
        photos: form.getAll('photo') as File[],
      }
      saves.push(sent)
      return saveReply(sent)
    }
    // The workspace lists deleted ones too, for the Deleted button's count.
    if (url === OBS_URL || url === OBS_URL + '?include=deleted') return json(200, listed)
    if (url === LOCATIONS_URL) return json(200, [BAY_3])
    if (url.endsWith('/transcription/retry')) {
      retries.push(url)
      listed = listed.map((item) => ({
        ...item,
        recordings: item.recordings.map((recording) => ({
          ...recording,
          transcription: { ...recording.transcription, status: 'transcribing', error: null },
        })),
      }))
      return Promise.resolve(new Response(null, { status: 202 }))
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}
function echo(sent: Sent) {
  const saved = observation({
    note: (sent.details.note as string | undefined) ?? null,
    copeDimensions: sent.details.copeDimensions as string[] | null,
    recordings: sent.recordings.map((file, i) => ({ ...recording('r' + i), name: file.name })),
    photos: sent.photos.map((file, i) => ({
      id: 'p' + i,
      name: file.name,
      contentType: 'image/jpeg',
      size: file.size,
      url: `/api/observations/o1/photos/p${i}/image`,
      added: null,
    })),
  })
  listed = [saved]
  return json(201, saved)
}

// jsdom has no microphone: getUserMedia and MediaRecorder are stubbed.
function allowMicrophone() {
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => {} }] }),
    },
  })
  vi.stubGlobal(
    'MediaRecorder',
    class {
      mimeType = 'audio/webm'
      ondataavailable: (event: { data: Blob }) => void = () => {}
      onstop: () => void = () => {}
      start() {}
      stop() {
        this.ondataavailable({ data: new Blob(['audio'], { type: 'audio/webm' }) })
        this.onstop()
      }
    },
  )
}

async function openApp() {
  render(<App />)
  await signIn()
}
// Opens capture and picks the location, as the engineer does first.
async function openCapture() {
  await openApp()
  // Open the assessment from the work list; Add manually is on its Observations tab.
  fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
  addManually()
  await screen.findByRole('img', { name: 'live' })
  fireEvent.click(
    await screen.findByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
  )
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// Capture starts from the Observations tab's Add manually button.
function addManually() {
  fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  click('Add manually')
}
// The Note, Voice and Photo modes, named with what each holds ("Voice, 2 recordings").
const mode = (name: 'Note' | 'Voice' | 'Photo') => click(new RegExp('^' + name))
const write = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: text } })
async function record() {
  mode('Voice')
  click(/^(Start recording|Record another)$/)
  fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
}
// What the Voice and Photo modes hold, each listed under its mode.
const recordingList = () => screen.getByRole('region', { name: 'Recordings' })
const photoList = () => screen.getByRole('region', { name: 'Photos' })
const grade = (severity: string) => fireEvent.click(screen.getByRole('radio', { name: severity }))
const save = () => click('Save observation')
// The back button over the form, to the assessment's Observations tab.
const leave = () => click('Back to Observations')
// A photo as the device hands it over, taken or chosen (CP-04 AC6).
const photo = (name = 'IMG_0460.jpg', type = 'image/jpeg') => new File(['jpeg'], name, { type })
const addPhotos = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText('Choose photographs'), { target: { files } })
const takePhoto = (file: File) =>
  fireEvent.change(screen.getByLabelText('Take photograph'), { target: { files: [file] } })

beforeAll(() => {
  // jsdom cannot play blobs; the list only needs a URL to hand the player.
  URL.createObjectURL = () => 'blob:clip'
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
  saveReply = echo
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Capturing site photographs (CP-04)', () => {
  it('opens the camera to take one photo, and the library to choose several (AC6)', async () => {
    await openCapture()
    mode('Photo')

    // `capture` sends a phone straight to its camera; Chrome on Android 14+
    // offers no camera without it. One photo per shot.
    const camera = screen.getByLabelText('Take photograph')
    expect(camera).toHaveAttribute('capture', 'environment')
    expect(camera).toHaveAttribute('accept', 'image/jpeg,image/png')
    expect(camera).not.toHaveAttribute('multiple')
    // Without `capture`, so the photo library stays on offer.
    const library = screen.getByLabelText('Choose photographs')
    expect(library).not.toHaveAttribute('capture')
    expect(library).toHaveAttribute('multiple')
  }, 10000)

  it('saves photos on their own, as taken or chosen on the device (AC1, AC6)', async () => {
    await openCapture()
    mode('Photo')
    // A phone camera names every capture image.jpg.
    takePhoto(photo('image.jpg'))
    addPhotos(photo('image.jpg'), photo('riser.png', 'image/png'))

    expect(within(photoList()).getAllByText('image.jpg')).toHaveLength(2)
    expect(within(photoList()).getByText('riser.png')).toBeInTheDocument()
    click('Remove riser.png')
    // The switcher counts what the Photo mode holds.
    expect(screen.getByRole('button', { name: 'Photo, 2 photos' })).toBeInTheDocument()
    grade('Moderate')
    save()

    expect(await screen.findByText('Observation saved.')).toBeInTheDocument()
    expect(saves[0].photos.map((f) => f.name)).toEqual(['image.jpg', 'image.jpg'])
    expect(saves[0].details).not.toHaveProperty('note')
    expect(screen.queryByRole('region', { name: 'Photos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo' })).toBeInTheDocument()
  })

  it('refuses a file that is not a JPG or PNG, saying why (AC4)', async () => {
    await openCapture()
    mode('Photo')

    addPhotos(photo('IMG_0461.HEIC', 'image/heic'), photo())

    expect(screen.getByRole('alert')).toHaveTextContent('IMG_0461.HEIC isn’t a JPG or PNG.')
    expect(within(photoList()).queryByText('IMG_0461.HEIC')).not.toBeInTheDocument()
    expect(within(photoList()).getByText('IMG_0460.jpg')).toBeInTheDocument()
    // The next good choice clears the reason.
    addPhotos(photo('IMG_0462.jpg'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the photos listed when the gateway refuses one (AC4)', async () => {
    saveReply = () =>
      json(415, {
        error: 'image.jpg is not a JPG or PNG image. Save it as JPG or PNG and add it again.',
      })
    await openCapture()
    mode('Photo')
    addPhotos(photo('image.jpg'))
    grade('High')

    save()

    expect(await screen.findByText(/^image\.jpg is not a JPG or PNG image/)).toBeInTheDocument()
    expect(within(photoList()).getByText('image.jpg')).toBeInTheDocument()
  })
})

describe('Reading an observation only when asked (CP-05, CP-21)', () => {
  it('keeps demo photos unread until asked, then shows a labelled sample', async () => {
    // No gateway: capture and the Observations tab stay in the demo.
    const sent: string[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET') sent.push(url)
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    addManually()
    await screen.findByText('Showing sample data')
    // The sample site has several buildings; each opens to list its locations (CP-16).
    fireEvent.click(await screen.findByRole('button', { name: /^Warehouse/, expanded: false }))
    fireEvent.click(
      screen.getByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
    )
    mode('Photo')
    addPhotos(photo('IMG_0470.jpg'))
    grade('Low')
    save()
    expect(await screen.findByText(/saved in this demo only/)).toBeInTheDocument()

    // The toast's View button opens the saved observation.
    click('View')
    // The card waits with Get AI proposal; nothing is read until it is pressed.
    const card = screen.getByRole('region', { name: 'AI suggestions' })
    expect(within(card).queryByText('Reading…')).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Get AI proposal' }))

    const reading = screen.getByRole('region', { name: 'AI suggestions' })
    expect(within(reading).getAllByText('Reading…').length).toBeGreaterThan(0)
    expect(
      await screen.findByText(/it was observed that/, {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    // Only the attempt to start a capture session; the photos went nowhere.
    expect(sent).toEqual([CAPTURE_URL])
  }, 10000) // Waits out the sample reading's two seconds, on top of capturing.
})

describe('Capturing an observation (CP-02, CP-03)', () => {
  it('saves a note, a recording and a photo together as one observation', async () => {
    allowMicrophone()
    await openCapture()
    const text = '  Valve V-12 chained open.\nTag missing.'
    write(text)
    await record()
    mode('Photo')
    addPhotos(photo())

    // Each mode says what it holds; nothing is sent yet.
    expect(screen.getByRole('button', { name: 'Note, written' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voice, 1 recording' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo, 1 photo' })).toBeInTheDocument()
    expect(saves).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Protection' }))
    grade('High')

    save()

    expect(
      await screen.findByText('Observation saved. Transcribing 1 recording now.'),
    ).toBeInTheDocument()
    expect(saves).toHaveLength(1)
    // The note exactly as typed, filed under the tags chosen. The standard is
    // left to drafting.
    expect(saves[0].details).toEqual({
      note: text,
      copeDimensions: ['Protection'],
      severity: 'high',
      locationId: 'l1',
    })
    expect(saves[0].recordings.map((f) => f.name)).toEqual(['Recording 1'])
    expect(saves[0].photos.map((f) => f.name)).toEqual(['IMG_0460.jpg'])
    // The form starts again empty, tags and all.
    expect(screen.getByRole('button', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Protection' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'High' })).not.toBeChecked()

    // It is listed on the Observations tab, which the back button goes to.
    leave()
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      await screen.findByRole('button', { name: /Valve V-12 chained open/ }),
    ).toHaveTextContent('Transcribing')
  }, 15_000) // Many steps through the whole screen; slow when every test file runs at once.

  it('saves the note as typed in the box', async () => {
    await openCapture()
    write('Hose reel H3 blocked by pallets.')
    grade('Moderate')

    save()

    expect(await screen.findByText('Observation saved.')).toBeInTheDocument()
    expect(saves[0].details.note).toBe('Hose reel H3 blocked by pallets.')
    expect(saves[0].recordings).toEqual([])
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('')
  })

  it('removes and edits items before saving', async () => {
    allowMicrophone()
    await openCapture()
    write('First draft.')
    await record()
    await record()
    await record()

    click('Remove Recording 2')
    expect(screen.getByRole('button', { name: 'Voice, 2 recordings' })).toBeInTheDocument()
    mode('Note')
    write('Second draft.')
    grade('Low')
    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].details.note).toBe('Second draft.')
    expect(saves[0].recordings.map((f) => f.name)).toEqual(['Recording 1', 'Recording 3'])
  }, 10000)

  it('sends an uploaded audio file with its own name, and offers no standard to pick', async () => {
    allowMicrophone()
    await openCapture()
    mode('Voice')
    // Drafting finds the standard; Edit can name one once saved.
    expect(screen.queryByLabelText(/Standard reference/)).not.toBeInTheDocument()
    const file = new File(['audio'], 'bay3.m4a', { type: 'audio/x-m4a' })
    fireEvent.change(screen.getByLabelText('Upload audio files'), { target: { files: [file] } })
    expect(within(recordingList()).getByText('bay3.m4a')).toBeInTheDocument()
    grade('High')

    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].recordings[0].name).toBe('bay3.m4a')
    expect(saves[0].details).not.toHaveProperty('standard')
  })

  it('saves an observation left uncategorised and says drafting leaves it out', async () => {
    allowMicrophone()
    await openCapture()
    // No category is ticked until the engineer ticks one.
    expect(
      screen.getByText(
        'None chosen: report drafting leaves this observation out until it is categorised.',
      ),
    ).toBeInTheDocument()
    await record()
    grade('Low')

    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].details.copeDimensions).toBeNull()
  })

  it('asks for a severity, never assuming one', async () => {
    await openCapture()
    write('Exit sign E4 unlit.')
    // No severity is chosen until the engineer picks one.
    expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toEqual([])

    save()

    expect(screen.getByText('Choose a severity first.')).toBeInTheDocument()
    expect(saves).toHaveLength(0)
    grade('Critical')
    save()
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0].details.severity).toBe('critical')
  })

  it('keeps everything when the save fails, then saves it on retry', async () => {
    allowMicrophone()
    saveReply = () => Promise.reject(new TypeError('Failed to fetch'))
    await openCapture()
    write('Sprinkler valve V2 chained open.')
    await record()
    grade('High')

    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Observation not saved' + 'The gateway could not be reached.',
    )
    expect(within(recordingList()).getByText('Recording 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Note, written' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'High' })).toBeChecked()
    saveReply = echo
    save()

    expect(await screen.findByText(/Observation saved/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(saves).toHaveLength(2)
  })

  it('shows the reasons the gateway rejected the observation', async () => {
    saveReply = () =>
      json(400, {
        error: 'The observation details are invalid.',
        fields: { note: 'The note must be 5,000 characters or fewer.' },
      })
    await openCapture()
    write('Too long, as far as the gateway is concerned.')
    grade('Low')

    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The note must be 5,000 characters or fewer. Everything is still listed',
    )
  })

  it('asks for something to save first', async () => {
    await openCapture()
    write('   ')

    save()

    expect(screen.getByText('Add a note, recording, photograph or page first.')).toBeInTheDocument()
    expect(saves).toHaveLength(0)
  })

  it('keeps checking the saved recordings until their transcription finishes', async () => {
    allowMicrophone()
    // The gateway has already failed the transcription by the time the list is re-read.
    saveReply = (sent) => {
      const reply = echo(sent)
      listed = [
        { ...listed[0], recordings: [recording('r0', { status: 'failed', error: 'Timed out.' })] },
      ]
      return reply
    }
    await openCapture()
    await record()
    grade('High')

    save()
    await screen.findByText(/Observation saved/)
    leave()

    expect(await screen.findByRole('button', { name: /Transcription failed/ })).toBeInTheDocument()
  })

  it('explains a blocked microphone and offers upload instead', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      },
    })
    await openCapture()
    mode('Voice')

    click('Start recording')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Microphone access is blocked. Allow it in your browser's site settings, or upload a recording instead.",
    )
  })
})

describe('Leaving capture', () => {
  // Still capturing: the form and its Save are on screen.
  const capturing = () => screen.queryByRole('button', { name: 'Save observation' })

  it('goes back to the Observations tab, asking first when something is unsaved', async () => {
    await openCapture()
    write('Exit sign E4 unlit.')
    mode('Photo')
    addPhotos(photo())

    leave()

    const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' })
    expect(dialog).toHaveTextContent('Not saved: a note and 1 photo.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Note, written' })).toBeInTheDocument()

    leave()
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))

    expect(capturing()).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(saves).toHaveLength(0)
    // Capture opens again empty, in the location the engineer is still in.
    addManually()
    await screen.findByRole('img', { name: 'live' })
    expect(screen.getByRole('button', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Location: Warehouse › Ground › Bay 3/ }),
    ).toBeInTheDocument()
  })

  it('returns to where the engineer saved, marking what was saved New (CP-16)', async () => {
    // No gateway: the observations stay in the demo, beside its samples.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    addManually()
    await screen.findByText('Showing sample data')
    fireEvent.click(await screen.findByRole('button', { name: /^Warehouse/, expanded: false }))
    fireEvent.click(
      screen.getByRole('button', { name: /^Warehouse › Ground › Bay 3 — north aisle/ }),
    )
    for (const note of ['Exit sign E4 unlit.', 'Hose reel H2 blocked.']) {
      write(note)
      grade('Low')
      save()
    }

    leave()

    // Newest first, so it lands on the newest one saved.
    const newest = await screen.findByRole('button', { name: /Hose reel H2 blocked/ })
    await vi.waitFor(() => expect(newest).toHaveFocus())
    // The row's hidden text starts "New. " for what was just saved; the samples were there before.
    for (const note of [/Exit sign E4 unlit/, /Hose reel H2 blocked/])
      expect(screen.getByRole('button', { name: note })).toHaveAccessibleName(/^New\./)
    expect(screen.getAllByRole('button', { name: /^New\./ })).toHaveLength(2)
  })

  it('leaves for any workspace tab, which stays on show with Observations chosen', async () => {
    await openCapture()
    // Capture is part of the Observations tab.
    expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    write('Exit sign E4 unlit.')

    fireEvent.click(screen.getByRole('tab', { name: /^Generation/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))

    expect(capturing()).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Generation/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('stops a recording when capture is left, keeping it for the return', async () => {
    allowMicrophone()
    await openCapture()
    mode('Voice')
    click('Start recording')
    await screen.findByRole('button', { name: 'Stop recording' })

    // Left by the navigation rather than the back button.
    fireEvent.click(screen.getByRole('button', { name: /^Assessment dashboard/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    addManually()

    expect(await screen.findByRole('button', { name: 'Voice, 1 recording' })).toBeInTheDocument()
    expect(within(recordingList()).getByText('Recording 1')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Record another' })).toBeInTheDocument()
  })

  it('drops the draft when another assessment is opened, so it is never saved there', async () => {
    await openCapture()
    write('Tilbury: exit sign E4 unlit.')

    fireEvent.click(screen.getByRole('button', { name: /^Assessment dashboard/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /^Leeds Cold Store/ })[0])
    addManually()

    expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveValue('')
  })
})

describe('Capture layout', () => {
  // The details panel: the location, tags and (on a wide screen) Save.
  const tagsCard = () => screen.getByRole('region', { name: 'Details' }).parentElement!
  async function atWidth(width: number, test: () => Promise<void>) {
    const previous = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    try {
      await test()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous })
    }
  }

  it('puts the tags and Save in a panel beside the form on a wide screen', () =>
    atWidth(1280, async () => {
      await openCapture()

      const panel = tagsCard()
      expect(within(panel).getByRole('button', { name: 'Save observation' })).toBeInTheDocument()
      expect(within(panel).getByRole('group', { name: /^Severity/ })).toBeInTheDocument()
      expect(within(panel).queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
      // The media panel sits beside it, and the back button is above both.
      expect(
        within(screen.getByRole('region', { name: 'What you saw' })).getByRole('textbox', {
          name: 'Note',
        }),
      ).toBeInTheDocument()
      expect(within(panel).queryByRole('button', { name: /Back|Done/ })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'New Observation' })).toBeInTheDocument()
    }))

  it('only picks a location in capture: no edit or remove, and Add a location is last', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    addManually()
    await screen.findByText('Showing sample data')
    fireEvent.click(await screen.findByRole('button', { name: /^Warehouse/, expanded: false }))

    const locations = screen.getByRole('group', { name: 'Locations' })
    expect(
      within(locations).getAllByRole('button', { name: /^Warehouse › /i }).length,
    ).toBeGreaterThan(0)
    // The sidebar manages locations; the picker only chooses one.
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a location' })).toBeInTheDocument()
  })

  it('keeps one column under the workspace header on a narrower screen', async () => {
    await openCapture()

    // Stacked: the media panel under the details, and Save pinned under both.
    expect(within(tagsCard()).getByRole('group', { name: /^Severity/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save observation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Tilbury Distribution Centre',
    )
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('leaves a phone screen to the form, with the top bar as the way back', () =>
    atWidth(390, async () => {
      await openApp()
      fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
      addManually()

      // The location picker is a bottom sheet here, which can be closed.
      const sheet = await screen.findByRole('dialog', { name: 'Where are you?' })
      expect(sheet.tagName).toBe('DIALOG')
      expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Leave capture' })).not.toBeInTheDocument()
      // Once the assessment's locations have loaded.
      fireEvent.click(
        await within(sheet).findByRole('button', {
          name: /^Warehouse › Ground › Bay 3 — north aisle/,
        }),
      )

      // The top bar names the page, with ← in place of the menu; no workspace
      // header or tabs take the screen.
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New Observation')
      expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
      // The top bar's ←, not the page's own back button, which a phone leaves out.
      click('Back to observations')
      expect(screen.getByRole('tab', { name: /Observations/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    }))
})

describe('Tagging on the capture screen (CP-06 AC3)', () => {
  it('offers only the shared COPE vocabulary and saves each category as its shared value', async () => {
    await openCapture()
    const group = screen.getByRole('group', { name: 'COPE categories' })
    const shared = ['Construction', 'Occupancy', 'Protection', 'Exposure']
    expect(
      within(group)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
    ).toEqual(shared)
    const box = (label: string) => screen.getByRole('checkbox', { name: label })

    // Each category is shown and stored as the value the knowledge base tags
    // its chunks with.
    for (const label of shared) {
      fireEvent.click(box(label))
      write('Hose reel H3 blocked by pallets.')
      grade('High')
      save()
      // A save clears the box and the tags, so the next one starts afresh.
      await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(''))
      expect(box(label)).not.toBeChecked()
    }
    expect(saves.map((s) => s.details.copeDimensions)).toEqual(shared.map((c) => [c]))
  }, 15_000) // Four saves in a row; slow when every test file runs at once.

  it('files one observation under several categories, in C-O-P-E order', async () => {
    await openCapture()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exposure' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Construction' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Protection' }))
    write('Shared wall with the neighbouring paint store.')
    grade('Moderate')
    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].details.copeDimensions).toEqual(['Construction', 'Protection', 'Exposure'])
    leave()
    expect(
      await screen.findByRole('button', { name: /Shared wall with the neighbouring paint store/ }),
    ).toHaveTextContent(/Construction\s*Protection\s*Exposure/)
  })
})

describe('Observations tab (CP-03)', () => {
  async function openObservations() {
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  }

  it('shows why a recording failed and retries that recording', async () => {
    listed = [
      observation({
        recordings: [recording('r9', { status: 'failed', error: 'Whisper timed out.' })],
      }),
    ]
    await openObservations()

    fireEvent.click(await screen.findByRole('button', { name: /Transcription failed/ }))
    expect(screen.getByText('Whisper timed out.')).toBeInTheDocument()
    click('Retry')

    await vi.waitFor(() =>
      expect(retries).toEqual(['/api/observations/o1/recordings/r9/transcription/retry']),
    )
    expect(await screen.findByText('Transcribing the recording…')).toBeInTheDocument()
    expect(screen.queryByText(/Unexpected end of JSON/)).not.toBeInTheDocument()
  })

  it('shows the note, then each recording with its transcript and player', async () => {
    listed = [
      observation({
        note: 'Racking is new.',
        recordings: [
          recording('r1', { status: 'transcribed', transcript: 'Racking sits under two heads.' }),
        ],
      }),
    ]
    await openObservations()

    const row = await screen.findByRole('button', { name: /Racking is new\./ })
    // Severity is what the engineer picked; the location is the navigator's grouping now.
    expect(row).toHaveTextContent('High')
    fireEvent.click(row)

    const clip = screen.getByRole('region', { name: 'Recording 1' })
    expect(within(clip).getByText('Racking sits under two heads.')).toBeInTheDocument()
    expect(within(clip).getByLabelText('Play Recording 1')).toHaveAttribute(
      'src',
      '/api/observations/o1/recordings/r1/audio',
    )
  })

  it('marks an observation whose recording is still transcribing', async () => {
    listed = [observation({ recordings: [recording('r1')] })]
    await openObservations()

    expect(await screen.findByText('Transcribing')).toBeInTheDocument()
  })
})

// CP-22 round 3: a site walk proposal's Add observation reuses this screen;
// Save adds to the proposal through the walk's routes, not to the assessment.
describe('Adding to a site walk proposal', () => {
  const WALKS = `/api/assessments/${REF}/site-walks`
  const proposal = {
    locations: [
      {
        ref: 'loc-1',
        existingId: null,
        kind: 'building',
        building: 'Block A',
        floor: 'Level 1',
        name: 'Chiller room',
      },
    ],
    observations: [],
  }
  const put: { url: string; body: unknown }[] = []
  beforeEach(() => {
    put.length = 0
    const gateway = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (!url.startsWith(WALKS)) return gateway(url, init)
      if (init.method === 'PUT') put.push({ url, body: init.body })
      const walk = {
        id: 'w1',
        status: 'ready',
        createdAt: '2026-11-02T08:00:00.000Z',
        recordings: [],
        photos: [],
        notes: [],
        typedText: null,
        proposal,
        error: null,
      }
      return json(200, url === WALKS ? [walk] : walk)
    })
  })

  it('opens on the proposal’s locations and adds the observation to the proposal', async () => {
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    act(() =>
      openProposalCapture({
        reference: REF,
        walkId: 'w1',
        locationId: null,
        locations: [{ id: 'loc-1', building: 'Block A', floor: 'Level 1', name: 'Chiller room' }],
      }),
    )
    await screen.findByRole('img', { name: 'live' })
    // Only the site walk's locations, and nothing to add one with.
    expect(screen.queryByRole('button', { name: /Bay 3/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a location' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Block A › Level 1 › Chiller room/ }))
    write('Coils iced over.')
    mode('Photo')
    addPhotos(photo())
    // One category: a second pick replaces the first.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Protection' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Occupancy' }))
    grade('Moderate')

    click('Add to site walk')

    await vi.waitFor(() => expect(put.some((p) => p.url.endsWith('/proposal'))).toBe(true))
    const media = put.filter((p) => p.url.includes('/media/'))
    expect(media).toHaveLength(1)
    expect((media[0].body as FormData).get('photo')).toBeInstanceOf(Blob)
    const sent = JSON.parse(String(put.at(-1)!.body))
    expect(sent.observations).toEqual([
      expect.objectContaining({
        note: 'Coils iced over.',
        copeDimension: 'Occupancy',
        severity: 'moderate',
        locationRef: 'loc-1',
        mediaIds: [media[0].url.split('/').at(-1)],
      }),
    ])
    // Nothing went to the assessment's observations; the review is back on show.
    expect(saves).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add to site walk' })).not.toBeInTheDocument()
  })

  it('leads Back from Add manually to the site walk review it was opened from', async () => {
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    act(() =>
      openProposalCapture({
        reference: REF,
        walkId: 'w1',
        locationId: null,
        locations: [{ id: 'loc-1', building: 'Block A', floor: 'Level 1', name: 'Chiller room' }],
      }),
    )
    click('Back to Site walk proposal')
    expect(await screen.findByRole('heading', { name: 'Chiller room' })).toBeInTheDocument()
  })
})

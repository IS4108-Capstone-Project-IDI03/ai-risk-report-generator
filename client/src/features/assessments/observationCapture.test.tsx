import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { SavedObservation, SavedRecording } from './api'

const REF = 'RPT-2026-0411'
const CAPTURE_URL = `/api/assessments/${REF}/capture-session`
const OBS_URL = `/api/assessments/${REF}/observations`
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const BAY_3 = { id: 'l1', name: 'Bay 3 — north aisle', floor: 'Ground' }
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
  fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
  await screen.findByText('Capture session started')
  fireEvent.click(await screen.findByRole('button', { name: /^Bay 3 — north aisle · Ground/ }))
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const write = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: text } })
async function record() {
  click('Voice')
  click(/^(Start recording|Record another)$/)
  fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
}
const readyList = () => screen.getByRole('region', { name: 'Ready to save' })
const save = () => click('Save observation')
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
    click('Photo')

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
  })

  it('saves photos on their own, as taken or chosen on the device (AC1, AC6)', async () => {
    await openCapture()
    click('Photo')
    // A phone camera names every capture image.jpg.
    takePhoto(photo('image.jpg'))
    addPhotos(photo('image.jpg'), photo('riser.png', 'image/png'))

    expect(within(readyList()).getAllByText('image.jpg')).toHaveLength(2)
    expect(within(readyList()).getByText('riser.png')).toBeInTheDocument()
    click('Remove riser.png')
    save()

    expect(await screen.findByText('Observation saved to RPT-2026-0411.')).toBeInTheDocument()
    expect(saves[0].photos.map((f) => f.name)).toEqual(['image.jpg', 'image.jpg'])
    expect(saves[0].details).not.toHaveProperty('note')
    expect(screen.queryByRole('region', { name: 'Ready to save' })).not.toBeInTheDocument()
  })

  it('refuses a file that is not a JPG or PNG, saying why (AC4)', async () => {
    await openCapture()
    click('Photo')

    addPhotos(photo('IMG_0461.HEIC', 'image/heic'), photo())

    expect(screen.getByRole('alert')).toHaveTextContent(
      'IMG_0461.HEIC is not a JPG or PNG image. Save it as JPG or PNG and add it again.',
    )
    expect(within(readyList()).queryByText('IMG_0461.HEIC')).not.toBeInTheDocument()
    expect(within(readyList()).getByText('IMG_0460.jpg')).toBeInTheDocument()
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
    click('Photo')
    addPhotos(photo('image.jpg'))

    save()

    expect(await screen.findByText(/^image\.jpg is not a JPG or PNG image/)).toBeInTheDocument()
    expect(within(readyList()).getByText('image.jpg')).toBeInTheDocument()
  })
})

describe('Reading photos only when asked (CP-05)', () => {
  it('keeps demo photos unread until asked, then shows a labelled sample', async () => {
    // No gateway: capture and the Observations tab stay in the demo.
    const sent: string[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET') sent.push(url)
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    await openApp()
    fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
    await screen.findByText('Showing sample data')
    fireEvent.click(await screen.findByRole('button', { name: /^Bay 3 — north aisle · Ground/ }))
    click('Photo')
    addPhotos(photo('IMG_0470.jpg'))
    save()
    expect(await screen.findByText(/kept in this demo only/)).toBeInTheDocument()

    // The side navigation's Open assessment entry is named after the site.
    fireEvent.click(screen.getAllByRole('button', { name: /^Tilbury Distribution Centre/ })[0])
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    fireEvent.click(screen.getByRole('button', { name: /1 photograph captured at Bay 3/ }))
    const proposal = screen.getByRole('region', { name: 'Proposal from the photos' })
    expect(within(proposal).getByText(/^Not read yet\./)).toBeInTheDocument()
    click('Read photos')

    expect(within(proposal).getByText('Sample proposal')).toBeInTheDocument()
    expect(within(proposal).getByText('Interpreting the photos…')).toBeInTheDocument()
    expect(
      await within(proposal).findByText(/it was observed that/, {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    // Only the attempt to start a capture session; the photos went nowhere.
    expect(sent).toEqual([CAPTURE_URL])
  })
})

describe('Capturing an observation (CP-02, CP-03)', () => {
  it('saves a note, a recording and a photo together as one observation', async () => {
    allowMicrophone()
    await openCapture()
    const text = '  Valve V-12 chained open.\nTag missing.'
    write(text)
    click('Add note')
    await record()
    click('Photo')
    addPhotos(photo())

    // Everything waits in one list; nothing is sent yet.
    expect(within(readyList()).getByText('Note')).toBeInTheDocument()
    expect(within(readyList()).getByText('Recording 1')).toBeInTheDocument()
    expect(within(readyList()).getByText('IMG_0460.jpg')).toBeInTheDocument()
    expect(saves).toHaveLength(0)

    save()

    expect(
      await screen.findByText('Observation saved to RPT-2026-0411. Transcribing 1 recording now.'),
    ).toBeInTheDocument()
    expect(saves).toHaveLength(1)
    // The note exactly as typed, filed under the form's defaults: Fire
    // protection is filed as Protection.
    expect(saves[0].details).toEqual({
      note: text,
      copeDimensions: ['Protection'],
      severity: 'high',
      locationId: 'l1',
      standard: '',
    })
    expect(saves[0].recordings.map((f) => f.name)).toEqual(['Recording 1'])
    expect(saves[0].photos.map((f) => f.name)).toEqual(['IMG_0460.jpg'])
    expect(screen.queryByRole('region', { name: 'Ready to save' })).not.toBeInTheDocument()
    expect(screen.getByText(/Note · 1 recording · 1 photo/)).toBeInTheDocument()
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
  }, 15_000) // Many steps through the whole screen; slow when every test file runs at once.

  it('includes a note that was typed but not added to the list', async () => {
    await openCapture()
    write('Hose reel H3 blocked by pallets.')

    save()

    expect(await screen.findByText('Observation saved to RPT-2026-0411.')).toBeInTheDocument()
    expect(saves[0].details.note).toBe('Hose reel H3 blocked by pallets.')
    expect(saves[0].recordings).toEqual([])
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('')
  })

  it('removes and edits items before saving', async () => {
    allowMicrophone()
    await openCapture()
    write('First draft.')
    click('Add note')
    await record()
    await record()
    await record()

    click('Remove Recording 2')
    click('Edit note')
    write('Second draft.')
    click('Add note')
    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].details.note).toBe('Second draft.')
    expect(saves[0].recordings.map((f) => f.name)).toEqual(['Recording 1', 'Recording 3'])
  }, 10000)

  it('sends an uploaded audio file with its own name', async () => {
    allowMicrophone()
    await openCapture()
    click('Voice')
    fireEvent.change(screen.getByLabelText(/Standard reference/), {
      target: { value: 'NFPA 25 – 2026 Edition' },
    })
    const file = new File(['audio'], 'bay3.m4a', { type: 'audio/x-m4a' })
    fireEvent.change(screen.getByLabelText('Upload audio files'), { target: { files: [file] } })
    expect(within(readyList()).getByText('bay3.m4a')).toBeInTheDocument()

    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].recordings[0].name).toBe('bay3.m4a')
    expect(saves[0].details.standard).toBe('NFPA 25 – 2026 Edition')
  })

  it('saves an observation left uncategorised and says drafting leaves it out', async () => {
    allowMicrophone()
    await openCapture()
    // Protection is ticked by default; unticking it leaves none.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Protection' }))
    expect(
      screen.getByText(
        'None chosen: report drafting leaves this observation out until it is categorised.',
      ),
    ).toBeInTheDocument()
    await record()

    save()

    await screen.findByText(/Observation saved/)
    expect(saves[0].details.copeDimensions).toBeNull()
    expect(screen.getByText('Uncategorised', { selector: 'span' })).toBeInTheDocument()
  })

  it('keeps everything listed when the save fails, then saves it on retry', async () => {
    allowMicrophone()
    saveReply = () => Promise.reject(new TypeError('Failed to fetch'))
    await openCapture()
    write('Sprinkler valve V2 chained open.')
    click('Add note')
    await record()

    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Observation not saved' + 'The gateway could not be reached.',
    )
    expect(within(readyList()).getByText('Recording 1')).toBeInTheDocument()
    expect(within(readyList()).getByText('Note')).toBeInTheDocument()
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

    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The note must be 5,000 characters or fewer. Everything is still listed',
    )
  })

  it('asks for something to save first', async () => {
    await openCapture()
    write('   ')

    save()

    expect(screen.getByText('Add a note, recording or photograph first.')).toBeInTheDocument()
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

    save()

    expect(await screen.findByText('Transcription failed')).toBeInTheDocument()
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
    click('Voice')

    click('Start recording')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Microphone access is blocked. Allow it in your browser's site settings, or upload a recording instead.",
    )
  })
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
    fireEvent.click(box('Protection'))
    for (const label of shared) {
      fireEvent.click(box(label))
      write('Hose reel H3 blocked by pallets.')
      save()
      // A saved note clears the box, so the next one starts after this save.
      await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(''))
      fireEvent.click(box(label))
    }
    expect(saves.map((s) => s.details.copeDimensions)).toEqual(shared.map((c) => [c]))
  })

  it('files one observation under several categories, in C-O-P-E order', async () => {
    await openCapture()
    // Protection is ticked by default.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exposure' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Construction' }))
    write('Shared wall with the neighbouring paint store.')
    save()

    await vi.waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0].details.copeDimensions).toEqual(['Construction', 'Protection', 'Exposure'])
    expect(
      await screen.findByText('Construction, Protection, Exposure', { selector: 'span' }),
    ).toBeInTheDocument()
  })
})

describe('Observations tab (CP-03)', () => {
  async function openObservations() {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: 'Tilbury Distribution Centre' }))
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
    click('Retry transcription')

    await vi.waitFor(() =>
      expect(retries).toEqual(['/api/observations/o1/recordings/r9/transcription/retry']),
    )
    expect((await screen.findAllByText('Transcribing')).length).toBeGreaterThan(0)
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
    // Severity and location are what the engineer picked.
    expect(row).toHaveTextContent('High')
    expect(row).toHaveTextContent('Bay 3 — north aisle')
    fireEvent.click(row)

    const clip = screen.getByRole('region', { name: 'Recording 1' })
    expect(within(clip).getByText('Racking sits under two heads.')).toBeInTheDocument()
    expect(within(clip).getByText('Voice')).toBeInTheDocument()
    expect(within(clip).getByText('Transcribed')).toBeInTheDocument()
    expect(screen.getByText('Text')).toBeInTheDocument()
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

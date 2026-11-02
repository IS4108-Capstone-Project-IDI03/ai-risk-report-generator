// Tests for the Recording screen (CP-22 AC1-AC4): record, pause, save, the 20-minute
// cap, photos, finish and kept uploads. Covers screens/Recording.tsx, useWalk.ts and
// useWalkRecorder.ts. Notes, the list and the photo strip are in walkList.test.tsx.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordingKey, type PendingUpload, type UploadStore } from './pendingUploads'
import { SiteWalkRecording } from './screens/Recording'
import { useWalk } from './useWalk'
import { useWalkRecorder } from './useWalkRecorder'
import { audioTrack, finishAs, gw, installWalkTest, REF, tones } from './walkTestKit'

const BASE = `/api/assessments/${REF}/site-walks`
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))
const sent = (path: RegExp) => gw.calls.filter((c) => c.method === 'PUT' && path.test(c.url))
async function openAndStart() {
  render(<SiteWalkRecording reference={REF} onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
  await screen.findByRole('button', { name: 'Save recording' })
}
const endTrack = () =>
  act(async () => {
    audioTrack.readyState = 'ended'
    audioTrack.dispatchEvent(new Event('ended'))
  })

installWalkTest()
afterEach(() => cleanup())

describe('site walk recording', () => {
  it('warns at 19:00 with a tone and a line, then stops at 20:00 with a tone and a toast', async () => {
    await openAndStart()
    await tick(19 * 60 * 1000)
    expect(await screen.findByText(/One minute left in this recording/)).toBeInTheDocument()
    expect(tones.count).toBe(1)

    await tick(60 * 1000)
    // The toast follows the save and upload, which can lag under a busy test run.
    expect(await screen.findByText(/reached 20 minutes and is saved/)).toBeInTheDocument()
    expect(tones.count).toBe(2)
    await waitFor(() => expect(sent(/recordings\/1$/)).toHaveLength(1))
    expect((sent(/recordings\/1$/)[0].body as FormData).get('durationSec')).toBe('1200')
    expect(screen.queryByText(/One minute left/)).not.toBeInTheDocument()

    // The engineer starts the next one: it is not started for them.
    expect(screen.getByRole('button', { name: 'Start next recording' })).toBeInTheDocument()
  })

  it('records audio at 64 kbps so a 20-minute recording fits the upload limit', async () => {
    const Recorder = globalThis.MediaRecorder
    const options: (MediaRecorderOptions | undefined)[] = []
    vi.stubGlobal(
      'MediaRecorder',
      class extends Recorder {
        constructor(stream: MediaStream, settings?: MediaRecorderOptions) {
          super(stream, settings)
          options.push(settings)
        }
      },
    )
    await openAndStart()
    expect(options).toEqual([{ audioBitsPerSecond: 64_000 }])
  })

  it('records on without a tone where Web Audio is missing', async () => {
    vi.stubGlobal('AudioContext', undefined)
    await openAndStart()
    await tick(19 * 60 * 1000)
    expect(await screen.findByText(/One minute left in this recording/)).toBeInTheDocument()
  })

  it('keeps what was recorded when the microphone track ends, and offers to continue', async () => {
    await openAndStart()
    await tick(30_000)
    await endTrack()

    expect(await screen.findByRole('alert')).toHaveTextContent('Recording stopped')
    await waitFor(() => expect(sent(/recordings\/1$/)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Continue recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
  })

  it('saves the recording, confirms it, and offers the next one', async () => {
    await openAndStart()
    await tick(5_000)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))

    expect(await screen.findByText('Recording saved')).toBeInTheDocument()
    await waitFor(() => expect(sent(/recordings\/1$/)).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Start next recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New recording' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start next recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    await tick(2_000)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await waitFor(() => expect(sent(/recordings\/2$/)).toHaveLength(1))
  })

  it('plays a tone on every saved recording', async () => {
    await openAndStart()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    expect(tones.count).toBe(1)
  })

  it('pauses and resumes without counting the pause', async () => {
    await openAndStart()
    await tick(10_000)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await tick(60_000)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    // Under a minute shown: the 60 s pause was not counted. (Real time also
    // passes with shouldAdvanceTime, so a busy machine can add a few seconds.)
    expect(await screen.findByText(/^00:[1-5]\d$/)).toBeInTheDocument()
  })

  it('stamps a photo with its recording and seconds into it, while still recording', async () => {
    await openAndStart()
    await tick(42_000)
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }))
    expect(await screen.findByRole('status')).toHaveTextContent('still recording')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Take photo' })))

    const [photo] = sent(/photos\/[\w-]+$/)
    const form = photo.body as FormData
    expect(form.get('recordingSeq')).toBe('1')
    expect(Number(form.get('offsetSec'))).toBeGreaterThanOrEqual(42)
    expect(Number(form.get('offsetSec'))).toBeLessThan(44)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Save recording' })).toBeInTheDocument()
  })

  it('keeps a recording on the device while offline and sends it when back online', async () => {
    await openAndStart()
    gw.offline = true
    await tick(5_000)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    expect(await screen.findByRole('img', { name: 'On this device' })).toBeInTheDocument()

    gw.offline = false
    await act(async () => void window.dispatchEvent(new Event('online')))
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'On this device' })).not.toBeInTheDocument(),
    )
    expect(sent(/recordings\/1$/).length).toBeGreaterThanOrEqual(2)
  })

  it('sends the last recording, then finishes the walk', async () => {
    await openAndStart()
    await tick(5_000)
    finishAs('Tower B podium')

    expect(await screen.findByText(/let you know when it’s ready/)).toBeInTheDocument()
    const order = gw.calls.map((c) => c.method + ' ' + c.url.replace(BASE, ''))
    expect(order.indexOf('PUT /w1/recordings/1')).toBeLessThan(order.indexOf('POST /w1/finish'))
    const finish = gw.calls.find((c) => c.url.endsWith('/finish'))!
    expect(JSON.parse(String(finish.body))).toEqual({ name: 'Tower B podium' })
  })

  it('asks for a name at Finish walk, and sends nothing until one is typed', async () => {
    await openAndStart()
    fireEvent.click(screen.getByRole('button', { name: 'Finish walk' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Name this site walk' }))
    const submit = dialog.getByRole('button', { name: 'Finish walk' })
    expect(submit).toBeDisabled()
    fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), { target: { value: '   ' } })
    expect(submit).toBeDisabled()
    expect(gw.calls.some((c) => c.url.endsWith('/finish'))).toBe(false)

    fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Dock' } })
    expect(submit).toBeEnabled()
  })

  it('keeps Finish walk off until something is recorded or written', async () => {
    render(<SiteWalkRecording reference={REF} onClose={() => {}} />)
    const finish = await screen.findByRole('button', { name: 'Finish walk' })
    expect(finish).toBeDisabled()
    // Says why it is off, so a greyed-out button isn't a puzzle.
    expect(finish).toHaveAccessibleDescription('Record or write something to finish.')
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    expect(finish).toBeEnabled()
    expect(screen.queryByText('Record or write something to finish.')).not.toBeInTheDocument()
  })

  it('shows the blocked microphone only after an attempt', async () => {
    render(<SiteWalkRecording reference={REF} onClose={() => {}} />)
    await screen.findByRole('button', { name: 'Start recording' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(denied)
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access is blocked')
    // Notes still work without a microphone, so the screen says so.
    expect(screen.getByRole('alert')).toHaveTextContent('typed note')
    expect(screen.getByRole('textbox', { name: 'Add a note' })).toBeEnabled()
  })

  it('locks recording while the walk is finishing', async () => {
    await openAndStart()
    const gateway = fetch
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.endsWith('/finish') ? new Promise(() => {}) : gateway(url, init),
    )
    finishAs('Dock walk')
    await screen.findByText('Finishing…')
    // Without this, a recording started now would run on behind the finished screen.
    expect(screen.getByRole('button', { name: /^Start/ }).closest('[inert]')).not.toBeNull()
  })

  it('numbers on from a recording still on the device after a reload', async () => {
    // Recording 1 was kept before the reload; its re-send hangs (slow connection).
    const kept: PendingUpload = {
      key: recordingKey('w1', 1),
      kind: 'recording',
      reference: REF,
      walkId: 'w1',
      seq: 1,
      durationSec: 60,
      blob: new Blob(['a']),
    }
    const items = new Map<string, PendingUpload>([[kept.key, kept]])
    const store: UploadStore = {
      put: async (i) => void items.set(i.key, i),
      remove: async (k) => void items.delete(k),
      all: async () => [...items.values()],
    }
    const gateway = fetch
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
      init.method === 'PUT' ? new Promise(() => {}) : gateway(url, init),
    )
    const { result } = renderHook(() => useWalk(REF, store))
    // Without this, Record would offer seq 1 again and overwrite the kept recording.
    await waitFor(() => expect(result.current.walk).not.toBeNull())
    expect(result.current.lastSeq).toBe(1)
  })

  it('numbers a recording after a note still saving when Record is tapped', async () => {
    // The note's save hangs (slow connection), so the walk has not yet shown it.
    const gateway = fetch
    const notes: string[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) =>
      /notes\/\d+$/.test(url) ? (notes.push(url), new Promise(() => {})) : gateway(url, init),
    )
    render(<SiteWalkRecording reference={REF} onClose={() => {}} />)
    await screen.findByRole('button', { name: 'Start recording' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), {
      target: { value: 'Sprinkler valve shut.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    await tick(2_000)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))

    // Without one shared count, both took seq 1 and the gateway refused the recording.
    expect(notes).toEqual([`${BASE}/w1/notes/1`])
    await waitFor(() => expect(sent(/recordings\/2$/)).toHaveLength(1))
  })

  it('starts one recording when Start is tapped twice while the microphone opens', async () => {
    let made = 0
    const Recorder = globalThis.MediaRecorder
    vi.stubGlobal(
      'MediaRecorder',
      class extends Recorder {
        constructor(...args: ConstructorParameters<typeof Recorder>) {
          super(...args)
          made++
        }
      },
    )
    const { result } = renderHook(() =>
      useWalkRecorder(
        () => 1,
        () => {},
      ),
    )
    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()])
    })
    // Without the guard, the first recorder keeps capturing with nothing to stop it.
    expect(made).toBe(1)
    expect(result.current.seq).toBe(1)
  })

  it('starts no recording when stopped while the microphone opens', async () => {
    let made = 0
    const Recorder = globalThis.MediaRecorder
    vi.stubGlobal(
      'MediaRecorder',
      class extends Recorder {
        constructor(...args: ConstructorParameters<typeof Recorder>) {
          super(...args)
          made++
        }
      },
    )
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    let open: (s: MediaStream) => void = () => {}
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise((resolve) => (open = resolve)),
    )
    const { result } = renderHook(() =>
      useWalkRecorder(
        () => 1,
        () => {},
      ),
    )
    let started!: Promise<void>
    act(() => void (started = result.current.start()))
    // Finish stops the walk while the microphone is still opening.
    await act(async () => result.current.stop())
    open(stream)
    await act(async () => started)
    // Without this, it would record on behind the finished screen.
    expect(made).toBe(0)
    expect(result.current.phase).toBe('idle')
  })

  it('opens one stream when the camera and Start are tapped together', async () => {
    const { result } = renderHook(() =>
      useWalkRecorder(
        () => 1,
        () => {},
      ),
    )
    await act(async () => {
      await Promise.all([result.current.ensureStream(), result.current.start()])
    })
    // Without this, the first stream's microphone and camera stayed on after closing.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('releases a microphone that opens after the screen has closed', async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    let open: (s: MediaStream) => void = () => {}
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise((resolve) => (open = resolve)),
    )
    const { result, unmount } = renderHook(() =>
      useWalkRecorder(
        () => 1,
        () => {},
      ),
    )
    let started!: Promise<void>
    act(() => void (started = result.current.start()))
    unmount()
    open(stream)
    await expect(started).rejects.toThrow()
    // Without this, the phone's microphone would stay on after leaving the screen.
    expect(audioTrack.readyState).toBe('ended')
  })
})

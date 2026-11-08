// Tests for Sprint 4 fixes on the Recording screen (CP-22 AC3-AC22): Add photo, Upload
// recording, refused files, retry, and removing with Undo. Covers screens/Recording.tsx,
// useWalk.ts, useWalkRemovals.ts, components/PhotoStrip.tsx and RecordingRow.tsx.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, Toaster } from '../../design-system'
import { SiteWalkRecording } from './screens/Recording'
import { finishAs, gw, installWalkTest, REF } from './walkTestKit'

const BASE = `/api/assessments/${REF}/site-walks`
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))
const puts = (path: RegExp) => gw.calls.filter((c) => c.method === 'PUT' && path.test(c.url))
const calls = (method: string, path: RegExp) =>
  gw.calls.filter((c) => c.method === method && path.test(c.url))
const open = () =>
  render(
    <>
      <Toaster />
      <SiteWalkRecording reference={REF} onClose={() => {}} />
    </>,
  )
const rec = (seq: number, over: Partial<(typeof gw.walk.recordings)[0]> = {}) => ({
  seq,
  durationSec: 125,
  transcription: 'transcribed' as const,
  transcript: null,
  audioUrl: `${BASE}/w1/recordings/${seq}`,
  ...over,
})
const photo = (id: string) => ({ id, url: `/photo/${id}.jpg`, recordingSeq: null, offsetSec: null })
const pick = (label: string, ...files: File[]) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files } })
const pdf = () => new File(['x'], 'plan.pdf', { type: 'application/pdf' })

installWalkTest()
afterEach(() => cleanup())
// jsdom can't read a file's length: a stand-in that reports 47 s at once.
beforeEach(() =>
  vi.stubGlobal(
    'Audio',
    class {
      duration = 47.4
      onloadedmetadata: () => void = () => {}
      set src(_: string) {
        queueMicrotask(() => this.onloadedmetadata())
      }
    },
  ),
)

describe('Add photo', () => {
  it('is always the last tile in the grid, after the photos', async () => {
    gw.walk.photos = [photo('p1'), photo('p2')]
    open()
    expect(await screen.findByText('Photos · 2')).toBeInTheDocument()
    const tiles = screen.getAllByRole('listitem').filter((li) => li.closest('.sw-photostrip'))
    expect(tiles).toHaveLength(3)
    expect(tiles[2]).toHaveTextContent('Add photo')
  })

  it('keeps a picked photo like a camera shot', async () => {
    open()
    await screen.findByRole('button', { name: 'Start recording' })
    pick('Choose photos', new File(['jpg'], 'a.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(puts(/photos\/[\w-]+$/)).toHaveLength(1))
    const form = puts(/photos\/[\w-]+$/)[0].body as FormData
    expect(form.get('recordingSeq')).toBeNull()
  })

  it('refuses a PDF with a toast and keeps nothing', async () => {
    open()
    await screen.findByRole('button', { name: 'Start recording' })
    pick('Choose photos', pdf())
    expect(await screen.findByText("Can't add .pdf files")).toBeInTheDocument()
    expect(screen.getByText('Choose a photo')).toBeInTheDocument()
    await tick(500)
    expect(puts(/photos\//)).toHaveLength(0)
  })
})

describe('Upload recording', () => {
  it('shows only when not recording; Save recording takes its place while recording', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    expect(screen.queryByRole('button', { name: 'Upload recording' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save recording' }))
    expect(await screen.findByRole('button', { name: 'Upload recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save recording' })).not.toBeInTheDocument()
  })

  it('sends a picked file with its own name and the length read from it', async () => {
    open()
    await screen.findByRole('button', { name: 'Upload recording' })
    pick('Choose recordings', new File(['a'], 'walk.m4a', { type: 'audio/x-m4a' }))
    await waitFor(() => expect(puts(/recordings\/1$/)).toHaveLength(1))
    const form = puts(/recordings\/1$/)[0].body as FormData
    expect((form.get('recording') as File).name).toBe('walk.m4a')
    expect(form.get('durationSec')).toBe('47')
  })

  it('refuses a PDF with a toast and keeps nothing', async () => {
    open()
    await screen.findByRole('button', { name: 'Upload recording' })
    pick('Choose recordings', pdf())
    expect(await screen.findByText("Can't add .pdf files")).toBeInTheDocument()
    expect(screen.getByText('Choose a recording')).toBeInTheDocument()
    await tick(500)
    expect(puts(/recordings\//)).toHaveLength(0)
  })

  it('drops a file the gateway refuses, with a toast, and never retries it', async () => {
    gw.refuse = { status: 415 }
    open()
    await screen.findByRole('button', { name: 'Upload recording' })
    pick('Choose recordings', new File(['a'], 'walk.mp3', { type: 'audio/mpeg' }))
    expect(await screen.findByText("Can't add .mp3 files")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('On this device')).not.toBeInTheDocument())
    await act(async () => void window.dispatchEvent(new Event('online')))
    expect(puts(/recordings\/1$/)).toHaveLength(1)
  })

  it('says a recording is over 20 minutes, from the gateway’s code', async () => {
    gw.refuse = { status: 413, code: 'too_long' }
    open()
    await screen.findByRole('button', { name: 'Upload recording' })
    pick('Choose recordings', new File(['a'], 'walk.wav', { type: 'audio/wav' }))
    expect(await screen.findByText('Recording is over 20 minutes')).toBeInTheDocument()
    expect(screen.getByText('Choose a shorter one')).toBeInTheDocument()
  })

  it('keeps a refused recorded clip on the device, as it may be the only copy', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    gw.refuse = { status: 415 }
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    expect(await screen.findByText('On this device')).toBeInTheDocument()
  })
})

describe('retry', () => {
  it('calls the retry route and the row goes back to Transcribing', async () => {
    gw.walk.recordings = [rec(1, { transcription: 'failed' })]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Try transcribing again' }))
    await waitFor(() => expect(calls('POST', /recordings\/1\/retry$/)).toHaveLength(1))
    expect(await screen.findByText('Transcribing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try transcribing again' })).not.toBeInTheDocument()
  })

  it('has no retry button unless the recording failed', async () => {
    gw.walk.recordings = [rec(1)]
    open()
    await screen.findByRole('button', { name: 'Remove recording' })
    expect(screen.queryByRole('button', { name: 'Try transcribing again' })).not.toBeInTheDocument()
  })

  it('on a phone the failed word reads Try again, and screen readers still hear the problem', async () => {
    const wide = window.innerWidth
    window.innerWidth = 375
    gw.walk.recordings = [rec(1, { transcription: 'failed' })]
    open()
    expect(await screen.findByText('Try again')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Couldn’t transcribe')).toHaveClass('ds-sr-only')
    window.innerWidth = wide
  })
})

describe('removing', () => {
  it('hides a photo at once, and Undo brings it back', async () => {
    gw.walk.photos = [photo('p1'), photo('p2')]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo 1' }))
    expect(await screen.findByText('Photo removed')).toBeInTheDocument()
    expect(screen.getByText('Photos · 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Photos · 2')).toBeInTheDocument()
    await tick(11_000)
    expect(calls('DELETE', /photos\//)).toHaveLength(0)
  })

  it('deletes on the server after 10 seconds', async () => {
    gw.walk.photos = [photo('p1')]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo 1' }))
    await tick(9_000)
    expect(calls('DELETE', /photos\/p1$/)).toHaveLength(0)
    await tick(1_500)
    await waitFor(() => expect(calls('DELETE', /photos\/p1$/)).toHaveLength(1))
  })

  it('removes a recording with Undo, and deletes it after 10 seconds', async () => {
    gw.walk.recordings = [rec(1)]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove recording' }))
    expect(await screen.findByText('Recording removed')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'This walk' })).not.toBeInTheDocument()
    await tick(10_500)
    await waitFor(() => expect(calls('DELETE', /recordings\/1$/)).toHaveLength(1))
  })

  it('removes a note through the same flow: Undo restores it and nothing is sent', async () => {
    gw.walk.notes = [{ seq: 1, text: 'Door open.' }]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove note' }))
    expect(await screen.findByText('Note removed')).toBeInTheDocument()
    expect(screen.queryByText('Door open.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Door open.')).toBeInTheDocument()
    await tick(11_000)
    expect(puts(/notes\/1$/)).toHaveLength(0)
  })

  it('Finish walk deletes what was removed first, then finishes', async () => {
    gw.walk.recordings = [rec(1), rec(2)]
    open()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remove recording' }))[0])
    finishAs('Block A')
    await screen.findByText('Walk finished')
    const order = gw.calls.map((c) => c.method + ' ' + c.url.replace(BASE, ''))
    expect(order.indexOf('DELETE /w1/recordings/1')).toBeGreaterThan(-1)
    expect(order.indexOf('DELETE /w1/recordings/1')).toBeLessThan(order.indexOf('POST /w1/finish'))
  })

  it('deletes what is waiting when the screen closes', async () => {
    gw.walk.recordings = [rec(1)]
    const screenOpen = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove recording' }))
    screenOpen.unmount()
    await waitFor(() => expect(calls('DELETE', /recordings\/1$/)).toHaveLength(1))
  })

  it('brings the item back with an error toast when the delete fails', async () => {
    gw.walk.recordings = [rec(1)]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove recording' }))
    gw.failDeletes = true
    await tick(10_500)
    expect(await screen.findByText("Couldn't remove it")).toBeInTheDocument()
    expect(screen.getByText('Check your connection')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove recording' })).toBeInTheDocument()
  })

  it('leaves Finish disabled once everything is removed', async () => {
    gw.walk.recordings = [rec(1)]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove recording' }))
    expect(await screen.findByRole('button', { name: 'Finish walk' })).toBeDisabled()
  })

  it('numbers a new recording after a removed one, never reusing its seq', async () => {
    gw.walk.recordings = [rec(1)]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove recording' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await waitFor(() => expect(puts(/recordings\/2$/)).toHaveLength(1))
    expect(puts(/recordings\/1$/)).toHaveLength(0)
  })

  it('drops a device-only recording from the queue and deletes it if it was mid-send', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    gw.offline = true
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await screen.findByText('On this device')
    fireEvent.click(screen.getByRole('button', { name: 'Remove recording' }))
    await tick(10_500)
    gw.offline = false
    await act(async () => void window.dispatchEvent(new Event('online')))
    await tick(500)
    // Never sent after the removal.
    expect(puts(/recordings\/1$/).filter((c) => c.body).length).toBe(1)
  })
})

// Holds every call of this method (and path) until the returned release() is called; the
// call reaches the fake gateway only then, so the call log shows the real order.
function hold(method: string, path: RegExp) {
  const real = globalThis.fetch
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  let held = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === method && path.test(url)) {
      held++
      await gate
    }
    return real(url, init)
  })
  return { release, held: () => held }
}

describe('removing: toast, ordering and device-only items', () => {
  it('closes the Undo toast when the 10 second timer fires', async () => {
    gw.walk.photos = [photo('p1')]
    const dismiss = vi.spyOn(toast, 'dismiss')
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo 1' }))
    expect(dismiss).not.toHaveBeenCalled()
    await tick(10_100)
    expect(dismiss).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(calls('DELETE', /photos\/p1$/)).toHaveLength(1))
  })

  it('closes the Undo toast when Finish flushes, so Undo cannot be pressed afterwards', async () => {
    gw.walk.recordings = [rec(1), rec(2)]
    const dismiss = vi.spyOn(toast, 'dismiss')
    open()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remove recording' }))[0])
    await screen.findByRole('button', { name: 'Undo' })
    finishAs('Block A')
    await screen.findByText('Walk finished')
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('Finish waits for a delete already running before it finishes the walk', async () => {
    gw.walk.recordings = [rec(1), rec(2)]
    open()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remove recording' }))[0])
    const slow = hold('DELETE', /recordings\/1$/)
    await tick(10_500)
    await waitFor(() => expect(slow.held()).toBe(1))
    finishAs('Block A')
    await tick(1_000)
    expect(calls('POST', /\/finish$/)).toHaveLength(0)
    await act(async () => slow.release())
    await screen.findByText('Walk finished')
    const order = gw.calls.map((c) => c.method + ' ' + c.url.replace(BASE, ''))
    expect(order.indexOf('DELETE /w1/recordings/1')).toBeLessThan(order.indexOf('POST /w1/finish'))
  })

  it('a device-only item removed mid-send is deleted after the send lands and before Finish', async () => {
    gw.walk.recordings = [rec(1)]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start next recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    const slow = hold('PUT', /recordings\/2$/)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await waitFor(() => expect(slow.held()).toBe(1))
    // Row 2 is the one still sending; row 1 is already on the server.
    const buttons = screen.getAllByRole('button', { name: 'Remove recording' })
    fireEvent.click(buttons[buttons.length - 1])
    finishAs('Block A')
    await tick(1_000)
    expect(calls('DELETE', /recordings\/2$/)).toHaveLength(0)
    await act(async () => slow.release())
    await screen.findByText('Walk finished')
    const order = gw.calls.map((c) => c.method + ' ' + c.url.replace(BASE, ''))
    const put = order.indexOf('PUT /w1/recordings/2')
    const del = order.indexOf('DELETE /w1/recordings/2')
    expect(put).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(put)
    expect(del).toBeLessThan(order.indexOf('POST /w1/finish'))
  })

  it('offline, a device-only item that never reached the server is dropped with no delete and no error', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    gw.offline = true
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await screen.findByText('On this device')
    fireEvent.click(screen.getByRole('button', { name: 'Remove recording' }))
    await tick(10_500)
    expect(calls('DELETE', /./)).toHaveLength(0)
    expect(screen.queryByText("Couldn't remove it")).not.toBeInTheDocument()
  })
})

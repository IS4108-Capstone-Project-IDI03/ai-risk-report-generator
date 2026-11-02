// Tests for the walk's one list on the Recording screen (CP-22 round 1): typed notes
// beside recordings, status and transcript names, playback, polling and the photo
// strip. Covers screens/Recording.tsx, components/WalkList.tsx and PhotoStrip.tsx.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteWalkRecording } from './screens/Recording'
import { finishAs, gw, installWalkTest, REF } from './walkTestKit'

const BASE = `/api/assessments/${REF}/site-walks`
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))
const puts = (path: RegExp) => gw.calls.filter((c) => c.method === 'PUT' && path.test(c.url))
const open = () => render(<SiteWalkRecording reference={REF} onClose={() => {}} />)
const composer = () => screen.findByRole('textbox', { name: 'Add a note' })
const rec = (seq: number, over: Partial<(typeof gw.walk.recordings)[0]> = {}) => ({
  seq,
  durationSec: 252,
  transcription: 'transcribed' as const,
  transcript: null,
  audioUrl: `${BASE}/w1/recordings/${seq}`,
  ...over,
})

installWalkTest()
afterEach(() => cleanup())

describe('typed notes in the walk', () => {
  it('adds a note before any recording, and the next recording numbers after it', async () => {
    open()
    fireEvent.change(await composer(), { target: { value: 'Block A, Level 1.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    expect(await screen.findByText('Block A, Level 1.')).toBeInTheDocument()
    expect(JSON.parse(String(puts(/notes\/1$/)[0].body))).toEqual({ text: 'Block A, Level 1.' })
    expect(screen.getByRole('textbox', { name: 'Add a note' })).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await waitFor(() => expect(puts(/recordings\/2$/)).toHaveLength(1))
  })

  it('numbers a note after the recordings already in the walk', async () => {
    gw.walk.recordings = [rec(1), rec(2)]
    open()
    fireEvent.change(await composer(), { target: { value: 'Roof access is blocked.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(puts(/notes\/3$/)).toHaveLength(1))
  })

  it('keeps a note typed while a recording runs, numbered after it, and the recording stays 1', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), {
      target: { value: 'Pallets in the fire lane.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText('Pallets in the fire lane.')).toBeInTheDocument()
    // Not seq 1: that number belongs to the recording that is running.
    expect(puts(/notes\/2$/)).toHaveLength(1)
    expect(puts(/notes\/1$/)).toHaveLength(0)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save recording' })))
    await waitFor(() => expect(puts(/recordings\/1$/)).toHaveLength(1))
  })

  it('keeps text still in the box when the walk is finished during a recording', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), {
      target: { value: 'Unsent while recording.' },
    })
    finishAs('Block A walk')
    await waitFor(() => expect(puts(/recordings\/1$/)).toHaveLength(1))
    expect(puts(/notes\/2$/)).toHaveLength(1)
  })

  it('edits and removes a note while a recording runs', async () => {
    gw.walk.notes = [{ seq: 1, text: 'Old text.' }]
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Save recording' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note' }), {
      target: { value: 'New text.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Edit note' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('New text.')).toBeInTheDocument()
    expect(JSON.parse(String(puts(/notes\/1$/)[0].body))).toEqual({ text: 'New text.' })

    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }))
    await waitFor(() => expect(screen.queryByText('New text.')).not.toBeInTheDocument())
    expect(JSON.parse(String(puts(/notes\/1$/)[1].body))).toEqual({ text: '' })
  })

  it('shows a walk typed before notes existed as one read-only note, and still finishes', async () => {
    gw.walk.typedText = 'Block A, Level 1.'
    open()
    expect(await screen.findByText('Block A, Level 1.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument()
    finishAs('Block A walk')
    expect(await screen.findByText('Walk finished')).toBeInTheDocument()
    expect(puts(/\/text$/)).toHaveLength(0)
  })

  it('keeps an unsent note on the device, and sends it as a note when the walk finishes', async () => {
    const first = open()
    fireEvent.change(await composer(), { target: { value: 'Block A.' } })
    first.unmount()

    open()
    expect(await composer()).toHaveValue('Block A.')
    finishAs('Block A walk')
    await screen.findByText('Walk finished')
    // The restored draft is saved as a note before the walk finishes.
    const order = gw.calls.map((c) => c.method + ' ' + c.url.replace(BASE, ''))
    expect(order.indexOf('PUT /w1/notes/1')).toBeLessThan(order.indexOf('POST /w1/finish'))
    // The draft is dropped by an effect just after the screen changes.
    await waitFor(() => expect(localStorage.getItem('site-walk-draft:w1')).toBeNull())
  })
})

describe('the walk list', () => {
  it('lists recordings and notes in seq order, named by their transcript once done', async () => {
    gw.walk.recordings = [
      rec(1, {
        transcript: "We're now at Block A, level one, loading bay, and I can see pallets.",
      }),
      rec(3, { transcription: 'queued', durationSec: 75 }),
    ]
    gw.walk.notes = [{ seq: 2, text: 'Sprinkler heads are painted over.' }]
    open()
    const list = await screen.findByRole('list', { name: 'This walk' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent("“We're now at Block A, level…”")
    expect(within(rows[0]).getByRole('img', { name: 'Transcribed' })).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Sprinkler heads are painted over.')
    expect(rows[2]).toHaveTextContent('Recording · 1:15')
    expect(within(rows[2]).getByRole('img', { name: 'Transcribing' })).toBeInTheDocument()
  })

  it('shows a failed transcription as a labelled cross icon', async () => {
    gw.walk.recordings = [rec(1, { transcription: 'failed' })]
    open()
    expect(await screen.findByRole('img', { name: 'Couldn’t transcribe' })).toBeInTheDocument()
  })

  it('expands the transcript and plays the audio of a finished recording', async () => {
    gw.walk.recordings = [rec(1, { transcript: 'Block A, level one. Pallets in the fire lane.' })]
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const { container } = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Play recording' }))
    expect(play).toHaveBeenCalled()
    expect(container.querySelector('audio')).toHaveAttribute('src', `${BASE}/w1/recordings/1`)

    fireEvent.click(screen.getByRole('button', { name: /Show transcript/ }))
    expect(screen.getByText('Block A, level one. Pallets in the fire lane.')).toBeVisible()
  })

  it('refreshes the walk while a recording is transcribing, then stops', async () => {
    gw.walk.recordings = [rec(1, { transcription: 'transcribing' })]
    open()
    await screen.findByRole('img', { name: 'Transcribing' })
    const reads = () => gw.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/w1')).length

    gw.walk.recordings = [rec(1, { transcript: 'Now at the loading bay of Block A today.' })]
    // Steps 5 s at a time: a save that restarts the poll's timer can land after the
    // first step when the full suite runs, and the poll then fires on the next.
    const refreshed = '“Now at the loading bay of…”'
    for (let i = 0; i < 3 && !screen.queryByText(refreshed); i++) await tick(5_000)
    expect(await screen.findByText(refreshed)).toBeInTheDocument()
    const after = reads()
    expect(after).toBeGreaterThan(0)
    await tick(15_000)
    expect(reads()).toBe(after)
  })
})

describe('the photo strip', () => {
  it('shows the walk’s photos with a count, and opens one larger', async () => {
    gw.walk.photos = [
      { id: 'p1', url: '/photo/p1.jpg', recordingSeq: 1, offsetSec: 4 },
      { id: 'p2', url: '/photo/p2.jpg', recordingSeq: 1, offsetSec: 9 },
    ]
    open()
    expect(await screen.findByText('Photos · 2')).toBeInTheDocument()
    const thumbs = screen.getAllByRole('button', { name: /Open photo/ })
    expect(thumbs).toHaveLength(2)
    fireEvent.click(thumbs[1])
    expect(await screen.findByRole('img', { name: 'Photo 2 of 2' })).toHaveAttribute(
      'src',
      '/photo/p2.jpg',
    )
  })

  it('shows nothing when the walk has no photos yet', async () => {
    open()
    await screen.findByRole('button', { name: 'Start recording' })
    expect(screen.queryByText(/^Photos/)).not.toBeInTheDocument()
  })
})

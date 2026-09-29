import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { TextObservation } from './api'

const REF = 'RPT-2026-0411'
const CAPTURE_URL = `/api/assessments/${REF}/capture-session`
const OBS_URL = `/api/assessments/${REF}/observations`
const NOTE_URL = OBS_URL + '/text'
const CAPTURE = {
  session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
  assessment: {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
  },
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A small stand-in for the gateway, answering by route. The dashboard list is
// unreachable, so the app falls back to its sample rows. A saved note echoes
// what was sent, as the gateway does.
let noteReply: (sent: Record<string, unknown>) => Promise<Response>
const posts: { url: string; body: Record<string, unknown> }[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === CAPTURE_URL) return json(201, CAPTURE)
    if (url === OBS_URL) return json(200, [])
    if (url === NOTE_URL) {
      const body = JSON.parse(String(init.body))
      posts.push({ url, body })
      return noteReply(body)
    }
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}
function saved(sent: Record<string, unknown>): TextObservation {
  return {
    id: 'n' + posts.length,
    type: 'text',
    engineer: String(sent.engineer),
    copeDimension: (sent.copeDimension as string | null) ?? null,
    standard: null,
    severity: String(sent.severity),
    area: String(sent.area),
    recordedAt: '2026-09-29T08:10:00.000Z',
    text: String(sent.text),
  }
}

async function openNoteCapture() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
  await screen.findByText('Capture session started')
}
const noteBox = () => screen.getByRole('textbox', { name: /Observation/ })
const category = () => screen.getByLabelText(/COPE category/)
function write(text: string) {
  fireEvent.change(noteBox(), { target: { value: text } })
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  posts.length = 0
  noteReply = (sent) => json(201, saved(sent))
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Text notes (CP-02)', () => {
  it('saves the note exactly as typed, with the form details, and lists it', async () => {
    await openNoteCapture()
    const text = '  Hose reel H3 blocked by pallets.\nMoved on request.'
    write(text)

    save()

    expect(await screen.findByText('Note saved to RPT-2026-0411.')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    // The form's defaults: Fire protection is filed as Protection.
    expect(posts[0].body).toEqual({
      text,
      engineer: 'A. Rowe',
      copeDimension: 'Protection',
      severity: 'high',
      area: 'Bay 3 — north aisle',
      standard: '',
    })
    expect(noteBox()).toHaveValue('')
    expect(screen.getByText(/Hose reel H3 blocked by pallets\./)).toBeInTheDocument()
  })

  it('files the note under the COPE category the engineer picked', async () => {
    await openNoteCapture()
    fireEvent.change(category(), { target: { value: 'External exposures' } })
    write('Neighbouring timber yard within 10 m of the east wall.')

    save()

    await screen.findByText('Note saved to RPT-2026-0411.')
    expect(posts[0].body.copeDimension).toBe('Exposure')
  })

  it('saves a note left uncategorised and says drafting leaves it out', async () => {
    await openNoteCapture()
    fireEvent.change(category(), { target: { value: 'Not categorised yet' } })
    expect(
      screen.getByText('Report drafting leaves this note out until it is categorised.'),
    ).toBeInTheDocument()
    write('Check the pump house log book before leaving.')

    save()

    await screen.findByText('Note saved to RPT-2026-0411.')
    expect(posts[0].body.copeDimension).toBeNull()
    const list = screen.getByText('Check the pump house log book before leaving.').parentElement!
    expect(within(list).getByText('Not categorised yet')).toBeInTheDocument()
  })

  it('keeps the note and says why when it could not be saved, then saves it on retry', async () => {
    noteReply = () => Promise.reject(new TypeError('Failed to fetch'))
    await openNoteCapture()
    write('Sprinkler valve V2 chained open.')

    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Note not saved' + 'The gateway could not be reached.',
    )
    expect(noteBox()).toHaveValue('Sprinkler valve V2 chained open.')
    noteReply = (sent) => json(201, saved(sent))
    save()

    expect(await screen.findByText('Note saved to RPT-2026-0411.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(posts).toHaveLength(2)
  })

  it('shows the reasons the gateway rejected the note', async () => {
    noteReply = () =>
      json(400, {
        error: 'The observation details are invalid.',
        fields: { text: 'Observation text must be 5,000 characters or fewer.' },
      })
    await openNoteCapture()
    write('Too long, as far as the gateway is concerned.')

    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Observation text must be 5,000 characters or fewer. Your note is still here',
    )
  })

  it('asks for a note before saving an empty one', async () => {
    await openNoteCapture()
    write('   ')

    save()

    expect(screen.getByText('Write a note first.')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('offers no category only for text notes', async () => {
    await openNoteCapture()
    fireEvent.change(category(), { target: { value: 'Not categorised yet' } })

    fireEvent.click(screen.getByRole('button', { name: 'Voice' }))

    // In voice mode the choice reads as a prompt, and saving asks for a category.
    expect(within(category()).queryByRole('option', { name: 'Not categorised yet' })).toBeNull()
    expect(category()).toHaveDisplayValue('Choose a category')
    save()
    expect(
      screen.getByText(
        'Choose a COPE category first. Only a text note can be saved uncategorised.',
      ),
    ).toBeInTheDocument()
    fireEvent.change(category(), { target: { value: 'Construction' } })
    expect(within(category()).queryByRole('option', { name: 'Choose a category' })).toBeNull()
  })
})

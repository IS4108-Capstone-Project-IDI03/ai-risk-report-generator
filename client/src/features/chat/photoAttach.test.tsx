// Attaching photos to a chat question (CB-08): limits, the face choice, and what is sent.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoAttach } from './components/PhotoAttach'
import { idToSend, resetPhotos, usePending, withPhotos } from './photoStore'

let faces = 0
const calls: string[] = []
beforeEach(() => {
  resetPhotos()
  faces = 0
  calls.length = 0
  document.body.innerHTML =
    '<div class="knowledge-assistant"><div class="openui-agent-thread-composer">' +
    '<div class="openui-agent-thread-composer__input-wrapper"><textarea></textarea></div></div></div>'
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
  )
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    const n = calls.filter((c) => c.startsWith('POST')).length
    return Response.json({
      id: `0000000000000000000000000000000${n}.jpg`.slice(-40),
      faces,
      blurredId: faces ? `0000000000000000000000000000000${n}.blurred.jpg`.slice(-48) : null,
    })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const photo = (name = 'riser.jpg', type = 'image/jpeg', size = 1000) =>
  Object.defineProperty(new File(['x'], name, { type }), 'size', { value: size })
const attach = (...files: File[]) =>
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files } })
// Shows what the question would carry, as the chat link would send it.
function Probe() {
  const items = usePending()
  return <output>{items.map(idToSend).join(',')}</output>
}

describe('attach a photo (CB-08)', () => {
  it('adds a JPG, shows it, and sends it with the question, then clears the tray (AC1)', async () => {
    render(
      <>
        <PhotoAttach />
        <Probe />
      </>,
    )
    attach(photo())
    expect(await screen.findByAltText('riser.jpg')).toBeInTheDocument()

    let body = ''
    const send = withPhotos((async (_u: unknown, init?: { body?: string }) => {
      body = init?.body ?? ''
      return new Response('')
    }) as unknown as typeof fetch)
    await act(() =>
      send('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ id: 'q1', role: 'user' }] }),
      }),
    )
    expect(JSON.parse(body).attachments).toHaveLength(1)
    // Emptied: the next send carries none.
    await waitFor(() => expect(screen.queryByAltText('riser.jpg')).not.toBeInTheDocument())
  })

  it('asks what to do about faces and sends the blurred copy unless told otherwise (AC3)', async () => {
    faces = 2
    render(
      <>
        <PhotoAttach />
        <Probe />
      </>,
    )
    attach(photo())
    expect(await screen.findByText('2 faces found')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Blur faces' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(/\.blurred\.jpg$/)
    fireEvent.click(screen.getByRole('radio', { name: 'Send as is' }))
    expect(screen.getByRole('status')).not.toHaveTextContent('.blurred.')
  })

  it('does not ask about faces when there are none', async () => {
    render(<PhotoAttach />)
    attach(photo())
    await screen.findByAltText('riser.jpg')
    expect(screen.queryByText(/faces? found/)).not.toBeInTheDocument()
  })

  it('refuses other types, big files and a fourth photo, saying why (AC2)', async () => {
    render(<PhotoAttach />)
    attach(photo('a.gif', 'image/gif'))
    expect(await screen.findByText('Only JPG and PNG')).toBeInTheDocument()
    attach(photo('big.jpg', 'image/jpeg', 9 * 1024 * 1024))
    expect(await screen.findByText('Over 8 MB')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    attach(photo('1.jpg'), photo('2.jpg'), photo('3.jpg'))
    await screen.findByAltText('3.jpg')
    attach(photo('4.jpg'))
    expect(await screen.findByText('Up to 3 photos')).toBeInTheDocument()
  })

  it('removes a photo from the tray and from storage', async () => {
    render(<PhotoAttach />)
    attach(photo())
    await screen.findByAltText('riser.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo riser.jpg' }))
    expect(screen.queryByAltText('riser.jpg')).not.toBeInTheDocument()
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(true)
  })

  it('says why when the gateway refuses the photo', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        { error: 'Faces could not be checked. Try again in a moment.' },
        { status: 503 },
      ),
    )
    render(<PhotoAttach />)
    attach(photo())
    expect(await screen.findByText('Faces could not be checked')).toBeInTheDocument()
  })
})

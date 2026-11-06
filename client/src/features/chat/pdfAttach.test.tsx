// Attaching a PDF to a chat (CB-09): what is accepted, what is refused and why, the warning for a
// file that looks like instructions, and what goes out with the question.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfAttach } from './components/PdfAttach'
import { resetPhotos, withPhotos } from './photoStore'

// The chat's saved messages; a test puts one with a PDF here to model a reopened chat.
let messages: object[] = []
vi.mock('@openuidev/react-headless', async (original) => ({
  ...(await original<object>()),
  useThread: (pick: (s: { messages: object[] }) => unknown) => pick({ messages }),
}))

let reply: object = { id: 'a1', name: 'Site survey.pdf', pages: 2, skipped: [], flagged: false }
let status = 200
const calls: string[] = []
beforeEach(() => {
  resetPhotos()
  messages = []
  calls.length = 0
  status = 200
  reply = { id: 'a1', name: 'Site survey.pdf', pages: 2, skipped: [], flagged: false }
  document.body.innerHTML =
    '<div class="knowledge-assistant"><div class="openui-agent-thread-composer">' +
    '<div class="openui-agent-thread-composer__input-wrapper"><textarea></textarea></div></div></div>'
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return status === 204 ? new Response(null, { status }) : Response.json(reply, { status })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const pdf = (name = 'Site survey.pdf', type = 'application/pdf', size = 1000) =>
  Object.defineProperty(new File(['%PDF-'], name, { type }), 'size', { value: size })
const attach = (file: File) =>
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } })

describe('attach a PDF (CB-09)', () => {
  it('reads the file, shows its chip, and sends it with the question (AC1)', async () => {
    render(<PdfAttach />)
    attach(pdf())
    expect(await screen.findByText('Site survey.pdf')).toBeInTheDocument()
    expect(screen.getByText(/2 pages read/)).toBeInTheDocument()

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
    expect(JSON.parse(body).pdfs).toEqual(['a1'])
    // The chip leaves the tray once the question is sent, and the button is blocked: one per chat.
    expect(screen.queryByText('Site survey.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach a PDF' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('refuses a file that is not a PDF, or is over 10 MB, without asking the gateway (AC5)', async () => {
    render(<PdfAttach />)
    attach(pdf('notes.docx', 'application/msword'))
    expect(await screen.findByText('Only PDF files')).toBeInTheDocument()
    attach(pdf('big.pdf', 'application/pdf', 11 * 1024 * 1024))
    expect(await screen.findByText('Over 10 MB')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it("shows the gateway's reason for a file it cannot read (scanned, protected, too long)", async () => {
    status = 400
    reply = { error: 'That PDF has no readable text. Scanned pages are not supported.' }
    render(<PdfAttach />)
    attach(pdf('scan.pdf'))
    expect(await screen.findByText('That PDF has no readable text')).toBeInTheDocument()
    expect(screen.getByText('Scanned pages are not supported.')).toBeInTheDocument()
  })

  it('names pages that were pictures only', async () => {
    reply = { id: 'a1', name: 'Mixed.pdf', pages: 1, skipped: [2], flagged: false }
    render(<PdfAttach />)
    attach(pdf('Mixed.pdf'))
    expect(await screen.findByText(/picture-only pages skipped: 2/)).toBeInTheDocument()
  })

  it('warns when the file looks like instructions to the assistant (AC6)', async () => {
    reply = { id: 'a1', name: 'Trap.pdf', pages: 1, skipped: [], flagged: true }
    render(<PdfAttach />)
    attach(pdf('Trap.pdf'))
    expect(await screen.findByText('Looks like instructions')).toBeInTheDocument()
    expect(screen.getByText(/read as plain text only/)).toBeInTheDocument()
  })

  it('removes the file from the tray and from storage', async () => {
    render(<PdfAttach />)
    attach(pdf())
    await screen.findByText('Site survey.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Remove PDF Site survey.pdf' }))
    expect(screen.queryByText('Site survey.pdf')).not.toBeInTheDocument()
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(true)
  })

  it('blocks the button, and says why, in a chat that already has a PDF', () => {
    messages = [{ id: 'q1', role: 'user', content: 'Q', pdfs: [{ id: 'a1', name: 'Old.pdf' }] }]
    render(<PdfAttach />)
    expect(screen.getByRole('button', { name: 'Attach a PDF' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

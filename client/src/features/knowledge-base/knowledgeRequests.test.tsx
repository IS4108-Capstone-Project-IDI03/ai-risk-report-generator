// Tests for the Knowledge base Requests tab (CB-07). fetch is stubbed; no gateway runs.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const REQUESTS = [
  {
    id: 'r1',
    question: 'What is the sprinkler density for plastics?',
    message: 'Maybe FM Data Sheet 8-9',
    askedBy: { id: 'u1', name: 'Alex Rowe' },
    createdAt: '2026-10-20T09:22:00.000Z',
    status: 'open',
  },
  {
    id: 'r2',
    question: 'Second question',
    askedBy: { id: 'u1', name: 'Alex Rowe' },
    createdAt: '2026-10-19T09:22:00.000Z',
    status: 'open',
  },
]
const doc = (id: string, title: string, uploadedAt: string, extra = {}) => ({
  id,
  title,
  edition: '2022',
  uploadedAt,
  unconfirmed: [],
  withdrawn: null,
  match: null,
  status: 'complete',
  ...extra,
})
const DOCS = [
  doc('d1', 'Older standard', '2026-09-01T00:00:00.000Z'),
  doc('d2', 'Newest standard', '2026-10-15T00:00:00.000Z'),
  doc('d3', 'Withdrawn one', '2026-10-18T00:00:00.000Z', {
    withdrawn: { at: '2026-10-19T00:00:00.000Z', by: { id: 'u', name: 'x' } },
  }),
]

// Serves the requests and documents; `close` answers a fill or dismiss.
async function openRequests(
  close: (url: string, body: unknown) => Response = () => Response.json({}),
) {
  let open = [...REQUESTS]
  const closed = vi.fn()
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/knowledge-gaps') return Promise.resolve(Response.json({ requests: open }))
    if (url.startsWith('/api/knowledge-gaps/')) {
      const body = JSON.parse(String(init!.body))
      closed(url, body)
      const response = close(url, body)
      if (response.ok) open = open.filter((r) => !url.includes(`/${r.id}/`))
      return Promise.resolve(response)
    }
    if (url === '/api/knowledge-documents/ingested') return Promise.resolve(Response.json(DOCS))
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  render(<App />)
  await signIn('knowledge_admin')
  fireEvent.click(await screen.findByRole('tab', { name: /^Requests/ }))
  return closed
}

describe('Knowledge base Requests tab (CB-07)', () => {
  it('lists each open request and counts them on the tab', async () => {
    await openRequests()
    expect(await screen.findByText('What is the sprinkler density for plastics?')).toBeVisible()
    expect(screen.getByText('Maybe FM Data Sheet 8-9')).toBeVisible()
    expect(screen.getAllByText(/Alex Rowe/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^\d\d? \w{3} \d\d:\d\d$/)).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'Requests, 2 open' })).toBeInTheDocument()
  })

  it('marks a request filled with the picked documents, newest first', async () => {
    const closed = await openRequests()
    await screen.findByText('Second question')
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark filled' })[0])
    const dialog = await screen.findByRole('dialog')
    const boxes = await within(dialog).findAllByRole('checkbox')
    // Active documents only, newest upload first, with the literal upload date and time.
    expect(boxes).toHaveLength(2)
    expect(
      within(dialog)
        .getByText(/Newest standard/)
        .compareDocumentPosition(within(dialog).getByText(/Older standard/)),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(dialog).getByText(/^15 Oct 2026 \d\d:\d\d$/)).toBeInTheDocument()
    const confirm = within(dialog).getAllByRole('button', { name: 'Mark as filled' }).at(-1)!
    expect(confirm).toBeDisabled()
    fireEvent.click(boxes[0])
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(closed).toHaveBeenCalledWith('/api/knowledge-gaps/r1/fill', { documentIds: ['d2'] }),
    )
    expect(await screen.findByText('Request marked as filled')).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByText('What is the sprinkler density for plastics?')).toBeNull(),
    )
  })

  it('needs a reason to dismiss', async () => {
    const closed = await openRequests()
    await screen.findByText('Second question')
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Dismiss request' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Out of scope' } })
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(closed).toHaveBeenCalledWith('/api/knowledge-gaps/r1/dismiss', {
        reason: 'Out of scope',
      }),
    )
    expect(await screen.findByText('Request dismissed')).toBeVisible()
  })

  it('says so when another admin already closed the request', async () => {
    await openRequests(() =>
      Response.json({ error: 'This request was already closed.' }, { status: 409 }),
    )
    await screen.findByText('Second question')
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss request' }))
    expect(await within(dialog).findByText('This request was already closed.')).toBeVisible()
  })
})

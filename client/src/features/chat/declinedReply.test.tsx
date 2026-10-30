// Tests for the declined-question flow of the chat (CB-07). In its own file because OpenUI's
// chat client keeps the first test's stubbed fetch for the whole file.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { phrase } from './textMatcher'

const sse = (...events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })

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
})

describe('Declined question (CB-07)', () => {
  // Whether the streamed answer's Meta says the knowledge base lacked it. A variable because
  // OpenUI's chat client keeps the first test's stubbed fetch, which reads it each time.
  let gapFlag = true
  // Streams a declined sentence in the model's words, as the rag-service writes it.
  const declined = () =>
    sse(
      { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'root = Answer([s1], meta)\n' },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'a1',
        delta: 's1 = Statement("The knowledge base doesn\'t cover Mars sprinklers.", [])\n',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'a1',
        delta: `meta = Meta([], []${gapFlag ? ', true' : ''})\n`,
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'a1' },
    )

  // Opens the chat as `role` and asks a question the knowledge base declines.
  async function askDeclined(role: 'risk_engineer' | 'knowledge_admin', gap = vi.fn()) {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (url === '/api/chat') return Promise.resolve(declined())
      if (url === '/api/knowledge-gaps') {
        gap(JSON.parse(String(init!.body)))
        return Promise.resolve(Response.json({ id: 'r1' }, { status: 201 }))
      }
      if (url === '/api/knowledge-documents/ingested') return Promise.resolve(Response.json([]))
      // The saved-chat list and a new chat (CB-03): the chat starts with none and saves its first.
      if (url === '/api/chat/conversations')
        return Promise.resolve(
          init?.method === 'POST'
            ? Response.json({ id: 'c1', title: 'Q' }, { status: 201 })
            : Response.json({ threads: [] }),
        )
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    render(<App />)
    await signIn(role)
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask the knowledge base' })[0])
    // The composer by its placeholder: the saved-chats search (CB-03) is a textbox too.
    const box = await screen.findByPlaceholderText(
      'Ask about a standard or a past report',
      {},
      { timeout: 15000 },
    )
    fireEvent.change(box, { target: { value: 'What is the Mars sprinkler rule?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
  }

  it(
    'lets an engineer send the question and a message, then shows Request sent',
    { timeout: 30000 },
    async () => {
      const gap = vi.fn()
      await askDeclined('risk_engineer', gap)

      expect(
        await screen.findByText(
          phrase("The knowledge base doesn't cover Mars sprinklers."),
          {},
          { timeout: 10000 },
        ),
      ).toBeVisible()
      expect(screen.queryByText('No answer in the knowledge base')).toBeNull()
      fireEvent.click(await screen.findByRole('button', { name: 'Ask an admin to add it' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('What is the Mars sprinkler rule?')).toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText(/Message to your admins/), {
        target: { value: 'FM Data Sheet 3-26' },
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }))

      expect(await screen.findByText('Request sent to your knowledge admins')).toBeVisible()
      expect(gap).toHaveBeenCalledWith({
        question: 'What is the Mars sprinkler rule?',
        message: 'FM Data Sheet 3-26',
      })
      expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()
    },
  )

  it('offers a knowledge admin Add documents instead', { timeout: 30000 }, async () => {
    const gap = vi.fn()
    await askDeclined('knowledge_admin', gap)

    expect(
      await screen.findByRole('button', { name: 'Add documents' }, { timeout: 10000 }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Ask an admin to add it' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add documents' }))
    expect(window.location.pathname).toBe('/admin/knowledge-base')
    expect(await screen.findByRole('tab', { name: 'Add documents' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(gap).not.toHaveBeenCalled()
  })

  it('offers no button when Meta has no gap flag', { timeout: 30000 }, async () => {
    gapFlag = false
    await askDeclined('risk_engineer')

    expect(
      await screen.findByText(
        phrase("The knowledge base doesn't cover Mars sprinklers."),
        {},
        { timeout: 10000 },
      ),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Ask an admin to add it' })).toBeNull()
  })
})

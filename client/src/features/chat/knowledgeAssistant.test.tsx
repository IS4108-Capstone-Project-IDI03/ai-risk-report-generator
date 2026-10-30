// Tests for the knowledge assistant screen (CB-01). fetch is stubbed; no gateway runs.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { phrase } from './textMatcher'

const sse = (...events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Knowledge assistant (CB-01)', () => {
  it(
    'opens from the navigation and shows a streamed answer to a question',
    { timeout: 30000 },
    async () => {
      // jsdom has no ResizeObserver or scrollTo; OpenUI's message list measures
      // itself and scrolls to the newest message with them.
      Element.prototype.scrollTo = () => {}
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      )
      const asked = vi.fn()
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (url === '/api/knowledge-documents/ingested')
          return Promise.resolve(
            Response.json([
              {
                id: 'd1',
                title: 'Office Sample 1 - PRE 2026 - REDACTED',
                sourceType: 'marsh_report',
                facilityType: 'Office',
                effectiveDate: '2026-03-05',
                fileUrl: '/f/d1',
                withdrawn: null,
              },
            ]),
          )
        // The saved-chat list (CB-03) loads when the sidebar opens; this test starts with none.
        if (url === '/api/chat/conversations')
          return Promise.resolve(
            init?.method === 'POST'
              ? Response.json({ id: 'c1', title: 'Q' }, { status: 201 })
              : Response.json({ threads: [] }),
          )
        if (url !== '/api/chat') return Promise.reject(new TypeError('Failed to fetch'))
        asked(JSON.parse(String(init!.body)))
        const filters = { jurisdiction: 'SG' }
        return Promise.resolve(
          sse(
            { type: 'TOOL_CALL_START', toolCallId: 's1', toolCallName: 'search_knowledge_base' },
            {
              type: 'TOOL_CALL_ARGS',
              toolCallId: 's1',
              delta: JSON.stringify({ query: 'q', filters }),
            },
            { type: 'TOOL_CALL_END', toolCallId: 's1' },
            {
              type: 'TOOL_CALL_RESULT',
              toolCallId: 's1',
              content: JSON.stringify({ filters, passages: 1 }),
            },
            { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'root = Answer([s1], meta)\n' },
            {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'a1',
              delta: 's1 = Statement("Sprinklers are needed throughout.", [c1])\n',
            },
            {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'a1',
              delta: 'c1 = Cite("P1", "installed throughout")\n',
            },
            {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'a1',
              delta:
                'meta = Meta([{label: "P1", documentId: "d1", pageStart: 12, pageEnd: 12, withdrawn: false}], [])\n',
            },
            { type: 'TEXT_MESSAGE_END', messageId: 'a1' },
          ),
        )
      })
      render(<App />)
      await signIn('risk_engineer')
      fireEvent.click(screen.getAllByRole('button', { name: 'Ask the knowledge base' })[0])
      expect(window.location.pathname).toBe('/ask')

      // The screen's first load brings OpenUI in, which is slow under jsdom.
      const box = await screen.findByPlaceholderText(
        'Ask about a standard or a past report',
        {},
        { timeout: 15000 },
      )
      // AC13: an empty conversation suggests questions about the knowledge base.
      expect(screen.getByText('NFPA 25 inspection intervals')).toBeInTheDocument()
      fireEvent.change(box, { target: { value: 'Where are sprinklers needed?' } })
      fireEvent.keyDown(box, { key: 'Enter' })

      // AC1, AC6: the cited statement and the filters it searched with.
      // The sentence types in letter by letter, so it gets the longer wait (a slow CI machine).
      expect(
        await screen.findByText(
          phrase(/Sprinklers are needed throughout\./),
          {},
          { timeout: 5000 },
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('Searched: Singapore')).toBeInTheDocument()
      // AC1: a marker opens its source in the panel beside the chat; Escape closes it.
      fireEvent.click(
        // The citation names arrive with the last line, which the paced reveal shows last.
        await screen.findByRole(
          'button',
          { name: /^Citation 1: Office Sample 1 - PRE 2026 - REDACTED \(2026-03-05\)/ },
          { timeout: 5000 },
        ),
      )
      const panel = screen.getByRole('complementary', { name: 'Source of citation 1' })
      expect(panel).toHaveTextContent('installed throughout')
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('complementary', { name: /Source of citation/ })).toBeNull()
      // Starting a new chat closes the panel: its citation belongs to the chat just left.
      fireEvent.click(screen.getByRole('button', { name: /^Citation 1/ }))
      fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0])
      await waitFor(() =>
        expect(screen.queryByRole('complementary', { name: /Source of citation/ })).toBeNull(),
      )
      expect(asked.mock.calls[0][0].messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Where are sprinklers needed?',
      })

      // The MarshBot logo and name start a new chat too, as in most chat apps.
      const again = await screen.findByPlaceholderText('Ask about a standard or a past report')
      fireEvent.change(again, { target: { value: 'Where are sprinklers needed?' } })
      fireEvent.keyDown(again, { key: 'Enter' })
      await screen.findByText(phrase(/Sprinklers are needed throughout\./), {}, { timeout: 5000 })
      expect(screen.queryByText("Hi, I'm MarshBot")).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'MarshBot, new chat' }))
      expect(await screen.findByText("Hi, I'm MarshBot")).toBeInTheDocument()
    },
  )
})

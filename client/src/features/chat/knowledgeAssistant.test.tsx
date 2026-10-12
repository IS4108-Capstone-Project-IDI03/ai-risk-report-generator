// Tests for the knowledge assistant screen (CB-01 Step 0). fetch is stubbed; no gateway runs.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

const sse = (...events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Knowledge assistant (CB-01 Step 0)', () => {
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
        if (url !== '/api/chat') return Promise.reject(new TypeError('Failed to fetch'))
        asked(JSON.parse(String(init!.body)))
        return Promise.resolve(
          sse(
            { type: 'TEXT_MESSAGE_START', messageId: 'a1' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Sprinklers are needed ' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'throughout.' },
            { type: 'TEXT_MESSAGE_END', messageId: 'a1' },
          ),
        )
      })
      render(<App />)
      await signIn('risk_engineer')
      fireEvent.click(screen.getAllByRole('button', { name: 'Ask the knowledge base' })[0])
      expect(window.location.pathname).toBe('/ask')

      // The screen's first load brings OpenUI in, which is slow under jsdom.
      const box = await screen.findByRole('textbox', {}, { timeout: 15000 })
      fireEvent.change(box, { target: { value: 'Where are sprinklers needed?' } })
      fireEvent.keyDown(box, { key: 'Enter' })

      expect(await screen.findByText(/Sprinklers are needed throughout\./)).toBeInTheDocument()
      expect(asked.mock.calls[0][0].messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Where are sprinklers needed?',
      })
    },
  )
})

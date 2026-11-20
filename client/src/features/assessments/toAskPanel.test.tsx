// The To ask panel on the Observations tab (CP-35): the info requests from split notes.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { ToAskPanel } from './components/ToAskPanel'

const ITEMS = [
  {
    observationId: 'o1',
    text: 'Ask for the valve schedule.',
    location: 'Fire pump room, Basement 1',
    severity: 'high',
  },
  { observationId: 'o2', text: 'Ask who tests the pump.', location: null, severity: 'critical' },
]
const reply = (items: unknown[], status = 200) =>
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify(status === 200 ? { items } : { error: 'x' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('lists each info request with its place and severity, under a count', async () => {
  reply(ITEMS)
  render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  expect(await screen.findByText('Ask for the valve schedule.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /To ask the client/ })).toHaveTextContent('2')
  expect(screen.getByText(/Fire pump room, Basement 1/)).toBeInTheDocument()
  expect(screen.getByText('Ask who tests the pump.')).toBeInTheDocument()
  expect(screen.getByText(/Critical/)).toBeInTheDocument()
})

it('shows nothing when there is nothing to ask, and nothing when the list cannot be read', async () => {
  reply([])
  const { container, rerender } = render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  await waitFor(() => expect(container).toBeEmptyDOMElement())
  reply([], 500)
  rerender(<ToAskPanel reference="RPT-1" refreshKey="b" />)
  await waitFor(() => expect(container).toBeEmptyDOMElement())
})

it('reads the list again when the observations change', async () => {
  reply([])
  const { rerender } = render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  reply(ITEMS)
  rerender(<ToAskPanel reference="RPT-1" refreshKey="b" />)
  expect(await screen.findByText('Ask for the valve schedule.')).toBeInTheDocument()
})

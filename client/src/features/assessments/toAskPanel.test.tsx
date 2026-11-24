// The To ask the client checklist on the Observations tab (CP-36): progress, ticking, show all.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { ToAskPanel } from './components/ToAskPanel'

const item = (n: number, asked = false) => ({
  observationId: 'o' + n,
  text: `Ask question ${n}.`,
  location: n === 1 ? 'Fire pump room, Basement 1' : null,
  severity: n === 2 ? 'critical' : 'high',
  asked,
})
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// GET lists the items; PATCH answers `patch`.
const serve = (items: unknown[], patch = () => json({ id: 'x' })) => {
  const calls: { method: string; url: string; body?: string }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url: String(url), body: init?.body as string | undefined })
    return Promise.resolve(method === 'GET' ? json({ items }) : patch())
  })
  return calls
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('lists each request as a checkbox row with its place and severity, and the progress', async () => {
  serve([item(1), item(2, true)])
  render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  expect(await screen.findByText('Ask question 1.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'To ask the client' })).toBeInTheDocument()
  expect(screen.getByText('1 of 2 asked')).toBeInTheDocument()
  expect(screen.getByText(/Fire pump room, Basement 1/)).toBeInTheDocument()
  expect(screen.getByText(/Critical/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Ask question 2.' })).toBeChecked()
})

it('sinks ticked rows below unticked ones', async () => {
  serve([item(1, true), item(2), item(3)])
  render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  await screen.findByText('Ask question 2.')
  const order = screen
    .getAllByRole('checkbox')
    .map((c) => c.getAttribute('aria-label') ?? c.closest('label')?.textContent)
  expect(order[2]).toContain('Ask question 1.')
})

it('ticks at once, sends asked:true, and updates the progress', async () => {
  const calls = serve([item(1), item(2)])
  render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Ask question 1.' }))
  expect(screen.getByText('1 of 2 asked')).toBeInTheDocument()
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
  const patch = calls.find((c) => c.method === 'PATCH')!
  expect(patch.url).toContain('/api/observations/o1')
  expect(JSON.parse(patch.body!)).toEqual({ asked: true })
})

it('puts the tick back when the save is refused', async () => {
  serve([item(1)], () => json({ error: 'no' }, 500))
  render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Ask question 1.' }))
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
  expect(screen.getByText('0 of 1 asked')).toBeInTheDocument()
})

it('shows the first 5, then all with Show all', async () => {
  serve([1, 2, 3, 4, 5, 6, 7].map((n) => item(n)))
  render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  await screen.findByText('Ask question 1.')
  expect(screen.getAllByRole('checkbox')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'Show all (7)' }))
  expect(screen.getAllByRole('checkbox')).toHaveLength(7)
})

it('shows nothing when there is nothing to ask, the list cannot be read, or it is not a list', async () => {
  serve([])
  const { container, rerender } = render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  await waitFor(() => expect(container).toBeEmptyDOMElement())
  vi.stubGlobal('fetch', () => Promise.resolve(json({ error: 'x' }, 500)))
  rerender(<ToAskPanel reference="RPT-1" refreshKey="b" />)
  await waitFor(() => expect(container).toBeEmptyDOMElement())
  vi.stubGlobal('fetch', () => Promise.resolve(json({ observations: [] })))
  rerender(<ToAskPanel reference="RPT-1" refreshKey="c" />)
  await waitFor(() => expect(container).toBeEmptyDOMElement())
})

it('reads the list again when the observations change', async () => {
  serve([])
  const { rerender } = render(<ToAskPanel reference="RPT-1" refreshKey="a" />)
  serve([item(1)])
  rerender(<ToAskPanel reference="RPT-1" refreshKey="b" />)
  expect(await screen.findByText('Ask question 1.')).toBeInTheDocument()
})

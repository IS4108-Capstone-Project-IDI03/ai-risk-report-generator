// Settings > Checklist (CP-37 AC4): a knowledge admin's fixed items per site type. Fetch is
// mocked; no gateway is called.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../design-system'
import type { FixedItem, FixedItems, Settings as SettingsData } from './api'
import { Settings } from './Settings'
import { TIER_IDS } from './tiers'

const settings = (canEditGlobal: boolean): SettingsData => ({
  canEditGlobal,
  models: [],
  qaStrictness: 'standard',
  sourcePriority: { order: [...TIER_IDS], history: [] },
})
const fixed = (o: Partial<FixedItem>): FixedItem => ({
  id: 'f1',
  facilityType: 'Warehouse',
  text: 'Is the roof fire rated?',
  area: '7',
  removed: false,
  ...o,
})
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

// The gateway: Settings, the fixed items (kept in `store`, changed by the calls), and `extra`.
function mock(canEdit: boolean, items: FixedItem[], failNext?: { status: number; error: string }) {
  const store: FixedItems = { facilityTypes: ['Warehouse', 'Factory'], items }
  const calls: { url: string; method: string; body: unknown }[] = []
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    if (url.startsWith('/api/settings/checklist')) {
      const method = init.method ?? 'GET'
      if (method !== 'GET') {
        calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null })
        if (failNext) return reply(failNext.status, { error: failNext.error })
        const id = url.split('/')[4]
        const hit = store.items.find((i) => i.id === id)
        if (method === 'POST' && !id)
          store.items.push(fixed({ id: 'new', ...JSON.parse(String(init.body)) }))
        if (hit && method === 'PATCH') Object.assign(hit, JSON.parse(String(init.body)))
        if (hit && method === 'DELETE') hit.removed = true
        if (hit && method === 'POST') hit.removed = false
        return reply(200, hit ?? store.items.at(-1))
      }
      return reply(200, store)
    }
    if (url === '/api/chat/memory')
      return reply(200, { enabled: true, facts: [], maxFacts: 5, maxChars: 200 })
    return reply(200, settings(canEdit))
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}
async function openChecklist() {
  fireEvent.click(await screen.findByRole('button', { name: 'Checklist' }))
  return screen.findByRole('region', { name: 'Checklist' })
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings > Checklist (CP-37)', () => {
  it('lists the fixed items of the chosen site type and shows an empty state for another', async () => {
    mock(true, [fixed({}), fixed({ id: 'f2', facilityType: 'Factory', text: 'Hot work permits?' })])
    render(<Settings />)
    const panel = await openChecklist()
    expect(await within(panel).findByText('Is the roof fire rated?')).toBeInTheDocument()
    expect(within(panel).queryByText('Hot work permits?')).toBeNull()
    fireEvent.change(within(panel).getByLabelText('Site type'), { target: { value: 'Factory' } })
    expect(within(panel).getByText('Hot work permits?')).toBeInTheDocument()
    cleanup()
    mock(true, [])
    render(<Settings />)
    await openChecklist()
    expect(await screen.findByText('No fixed items for Warehouse yet')).toBeInTheDocument()
  })

  it('adds an item with its section', async () => {
    const { calls } = mock(true, [])
    render(
      <>
        <Toaster />
        <Settings />
      </>,
    )
    const panel = await openChecklist()
    await within(panel).findByText('No fixed items for Warehouse yet')
    fireEvent.change(within(panel).getByLabelText('New question'), {
      target: { value: 'Are dock doors sealed?' },
    })
    fireEvent.change(within(panel).getByLabelText('Report section'), {
      target: { value: '7' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add item' }))
    expect(await within(panel).findByText('Are dock doors sealed?')).toBeInTheDocument()
    expect(calls[0]).toEqual({
      url: '/api/settings/checklist',
      method: 'POST',
      body: { facilityType: 'Warehouse', text: 'Are dock doors sealed?', area: '7' },
    })
  })

  it('edits an item in place', async () => {
    const { calls } = mock(true, [fixed({})])
    render(<Settings />)
    const panel = await openChecklist()
    fireEvent.click(await within(panel).findByRole('button', { name: /^Edit Is the roof/ }))
    fireEvent.change(within(panel).getByLabelText('Question'), {
      target: { value: 'Is the roof deck non-combustible?' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    expect(await within(panel).findByText('Is the roof deck non-combustible?')).toBeInTheDocument()
    expect(calls[0]).toEqual({
      url: '/api/settings/checklist/f1',
      method: 'PATCH',
      body: { text: 'Is the roof deck non-combustible?', area: '7' },
    })
  })

  it('removes an item to the Removed list and restores it', async () => {
    const { calls } = mock(true, [fixed({})])
    render(
      <>
        <Toaster />
        <Settings />
      </>,
    )
    const panel = await openChecklist()
    fireEvent.click(await within(panel).findByRole('button', { name: /^Remove Is the roof/ }))
    const restore = await within(panel).findByRole('button', { name: /^Restore Is the roof/ })
    expect(within(panel).getByText('Removed (1)')).toBeInTheDocument()
    expect(calls[0]).toMatchObject({ url: '/api/settings/checklist/f1', method: 'DELETE' })
    fireEvent.click(restore)
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: /^Edit Is the roof/ })).toBeInTheDocument(),
    )
    expect(calls[1]).toMatchObject({ url: '/api/settings/checklist/f1/restore', method: 'POST' })
  })

  it('shows the gateway error beside an add that fails, and an empty question', async () => {
    mock(true, [fixed({})], { status: 400, error: 'That question is already there.' })
    render(<Settings />)
    const panel = await openChecklist()
    await within(panel).findByText('Is the roof fire rated?')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add item' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Write the question first.')
    fireEvent.change(within(panel).getByLabelText('New question'), {
      target: { value: 'Is the roof fire rated?' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add item' }))
    await waitFor(() =>
      expect(within(panel).getByRole('alert')).toHaveTextContent('That question is already there.'),
    )
    // What was typed stays, so nothing is lost.
    expect(within(panel).getByLabelText('New question')).toHaveValue('Is the roof fire rated?')
  })

  it('tells an engineer an admin sets these, and never asks for the items', async () => {
    const { fetchMock } = mock(false, [fixed({})])
    render(<Settings />)
    const panel = await openChecklist()
    expect(within(panel).getByText('Set by an admin')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Add item' })).toBeNull()
    expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain('/api/settings/checklist')
  })

  it('shows a load error with a way to retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/settings/checklist'
          ? reply(403, { error: 'Not allowed.' })
          : url === '/api/chat/memory'
            ? reply(200, { enabled: true, facts: [], maxFacts: 5, maxChars: 200 })
            : reply(200, settings(true)),
      ),
    )
    render(<Settings />)
    const panel = await openChecklist()
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Not allowed.')
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

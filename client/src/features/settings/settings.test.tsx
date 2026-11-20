// Tests for the Settings screen (S-01). Fetch is mocked; no gateway or paid call.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption, ModelRowData, Settings as SettingsData } from './api'
import { Settings } from './Settings'
import { TIER_IDS } from './tiers'

const opt = (id: string, o: Partial<ModelOption> = {}): ModelOption => ({
  id,
  provider: id.split(':')[0],
  model: id,
  label: id,
  recommended: false,
  keySet: true,
  greyed: false,
  selectable: true,
  note: null,
  ...o,
})
const row = (task: string, o: Partial<ModelRowData> = {}): ModelRowData => ({
  task,
  label: task,
  fixed: false,
  selected: 'a:one',
  warning: null,
  options: [
    opt('a:one', { recommended: true }),
    opt('b:two', { keySet: false, greyed: true, selectable: false }),
  ],
  ...o,
})
const data = (
  canEditGlobal: boolean,
  models: ModelRowData[] = [row('Drafting')],
): SettingsData => ({
  canEditGlobal,
  noteTaking: { codes: { fact: 'F', info_request: 'IR', recommendation: 'REC' }, glossary: [] },
  models,
  qaStrictness: 'standard',
  sourcePriority: { order: [...TIER_IDS], history: [] },
})
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

function mock(
  start: SettingsData,
  extra: (url: string, init?: RequestInit) => Promise<Response> | null = () => null,
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const handled = extra(url, init)
    if (handled) return handled
    if (url === '/api/chat/memory')
      return reply(200, { enabled: true, facts: [], maxFacts: 5, maxChars: 200 })
    return reply(200, start)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const open = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings', () => {
  it('shows every section to an engineer and an admin', async () => {
    for (const edit of [false, true]) {
      mock(data(edit))
      render(<Settings />)
      for (const name of [
        'Password',
        'Models',
        'QA eval',
        'Chat and voice',
        'Checklist',
        'Source priority',
        'Note-taking',
      ])
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      // Removed on request: the three defaults, and the Drafting section (S-01 follow-up).
      for (const name of ['Defaults', 'QA check', 'QA criteria', 'Drafting'])
        expect(screen.queryByRole('button', { name })).toBeNull()
      cleanup()
    }
  })

  it('shows Coming soon with the owner, and no controls', async () => {
    mock(data(false))
    render(<Settings />)
    open('Checklist')
    expect(screen.getByText('Coming soon. Being built by Xuren.')).toBeInTheDocument()
    open('QA eval')
    expect(screen.getByText('Coming soon. Being built by Chris.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
    // Note-taking works now (CP-35): not a Coming soon tile.
    expect(screen.queryByRole('button', { name: 'Note-taking' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('highlights the open menu item', async () => {
    mock(data(false))
    render(<Settings />)
    expect(screen.getByRole('button', { name: 'Password' })).toHaveAttribute('aria-current')
    open('Models')
    expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Password' })).not.toHaveAttribute('aria-current')
  })

  it('shows key lights with text, and a no-key option cannot be chosen', async () => {
    const fetchMock = mock(data(true))
    render(<Settings />)
    open('Models')
    const box = await screen.findByRole('combobox', { name: 'Drafting' })
    expect(box).toHaveTextContent('a:one (recommended)')
    fireEvent.click(box)
    const list = screen.getByRole('listbox')
    const none = within(list).getByRole('option', { name: /b:two/ })
    expect(none).toHaveTextContent('No API key')
    expect(none).toHaveAttribute('aria-disabled', 'true')
    expect(none.querySelector('.st-light--off')).not.toBeNull()
    expect(
      within(list).getByRole('option', { name: /a:one/ }).querySelector('.st-light--on'),
    ).not.toBeNull()
    fireEvent.click(none)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('closes an open list when you click elsewhere, even where a click does not move focus (Safari)', async () => {
    mock(data(true))
    render(<Settings />)
    open('Models')
    fireEvent.click(await screen.findByRole('combobox', { name: 'Drafting' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('lets an admin choose a same-provider QA option and sends the PUT', async () => {
    const qa = row('QA check', {
      options: [
        opt('a:one', { recommended: true }),
        opt('c:same', {
          greyed: true,
          selectable: true,
          note: 'Same provider as report generation',
        }),
      ],
    })
    const after = data(true, [
      { ...qa, selected: 'c:same', warning: 'QA would not be independent.' },
    ])
    const fetchMock = mock(data(true, [qa]), (_url, init) =>
      init?.method === 'PUT' ? reply(200, after) : null,
    )
    render(<Settings />)
    open('Models')
    fireEvent.click(await screen.findByRole('combobox', { name: 'QA check' }))
    const same = screen.getByRole('option', { name: /c:same/ })
    expect(same).toHaveTextContent('Same provider as report generation')
    expect(same).not.toHaveAttribute('aria-disabled')
    fireEvent.click(same)
    await screen.findByText('QA would not be independent.')
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/settings/models/QA%20check')
    expect(put[1]?.body).toBe(JSON.stringify({ option: 'c:same' }))
    expect(screen.getByRole('combobox', { name: 'QA check' })).toHaveTextContent('c:same')
  })

  it('shows a row warning, and a fixed task has one option and cannot change', async () => {
    const whisper = row('Voice transcription', {
      fixed: true,
      options: [opt('a:one', { recommended: true })],
    })
    mock(data(true, [row('Drafting', { warning: 'This model cannot be used.' }), whisper]))
    render(<Settings />)
    open('Models')
    expect(await screen.findByText('This model cannot be used.')).toBeInTheDocument()
    const box = screen.getByRole('combobox', { name: 'Voice transcription' })
    expect(box).toBeDisabled()
    expect(box).toHaveTextContent('a:one (recommended)')
  })

  it('makes engineer controls read-only', async () => {
    mock(data(false))
    render(<Settings />)
    open('Models')
    expect(await screen.findByRole('combobox', { name: 'Drafting' })).toBeDisabled()
    expect(screen.getByText('Set by an admin')).toBeInTheDocument()
  })

  it('shows the memory switch from the chat API', async () => {
    mock(data(false))
    render(<Settings />)
    open('Chat and voice')
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  })

  it('tells the person the password rule: a letter and a number', async () => {
    mock(data(false))
    render(<Settings />)
    open('Password')
    expect(screen.getByText('Use at least one letter and one number.')).toBeInTheDocument()
  })

  it('shows password field errors and the lockout message', async () => {
    let n = 0
    mock(data(false), (url) => {
      if (url !== '/api/auth/change-password') return null
      return n++ === 0
        ? reply(400, { error: 'Wrong.', fields: { currentPassword: 'Current password is wrong.' } })
        : reply(429, { error: 'Too many tries. Try again later.' })
    })
    render(<Settings />)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Current password is wrong.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries')
  })
})

describe('Settings QA eval', () => {
  it('is under Coming soon, with its owner and no controls', async () => {
    mock(data(true))
    render(<Settings />)
    const menu = screen.getByRole('navigation', { name: 'Settings sections' })
    const soon = within(menu).getByText('Coming soon').parentElement!
    expect(within(soon).getByRole('button', { name: 'QA eval' })).toBeInTheDocument()
    open('QA eval')
    expect(screen.getByText('Coming soon. Being built by Chris.')).toBeInTheDocument()
    expect(screen.queryByText('Standard (current)')).toBeNull()
  })
})

describe('Settings Chat and voice', () => {
  it('has the Whisper model here, not under Models, plus the voice default', async () => {
    const whisper = row('transcription', {
      label: 'Voice transcription',
      fixed: true,
      options: [opt('a:one')],
    })
    mock(data(true, [row('Drafting'), whisper]))
    render(<Settings />)
    open('Models')
    await screen.findByRole('combobox', { name: 'Drafting' })
    expect(screen.queryByRole('combobox', { name: 'Voice transcription' })).toBeNull()
    open('Chat and voice')
    expect(screen.getByRole('combobox', { name: 'Voice transcription' })).toBeDisabled()
  })
})

describe('Settings: tasks nothing reads yet', () => {
  it('puts them in their own greyed-out section at the bottom, labelled Not used yet', async () => {
    mock({
      ...data(true),
      models: [
        row('ocr', { label: 'OCR', inUse: false }),
        row('Drafting'),
        row('qa', { label: 'QA', inUse: false }),
      ],
    })
    render(<Settings />)
    open('Models')
    const heading = await screen.findByRole('heading', { name: 'Not used yet' })
    expect(screen.getAllByText(/Not used yet/)).toHaveLength(1)
    const before = (el: HTMLElement) =>
      Boolean(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
    // The working task is above the heading; the unused ones are below it, disabled.
    expect(before(screen.getByRole('combobox', { name: 'Drafting' }))).toBe(true)
    for (const name of ['OCR', 'QA']) {
      const box = screen.getByRole('combobox', { name })
      expect(before(box)).toBe(false)
      expect(box).toBeDisabled()
    }
    expect(screen.getByRole('combobox', { name: 'Drafting' })).toBeEnabled()
  })

  it('shows no Not used yet section when every task is in use', async () => {
    mock({ ...data(true), models: [row('Drafting')] })
    render(<Settings />)
    open('Models')
    await screen.findByRole('combobox', { name: 'Drafting' })
    expect(screen.queryByRole('heading', { name: 'Not used yet' })).toBeNull()
  })
})

describe('Settings Source priority (RT-04)', () => {
  const names = () =>
    screen.getAllByRole('listitem').map((li) => li.querySelector('.st-tier-name')?.textContent)
  const DEFAULT = [
    'National code',
    'Manufacturer rating',
    'Marsh precedent',
    'International standard',
  ]
  const openIt = async (settings: SettingsData, extra?: Parameters<typeof mock>[1]) => {
    const fetchMock = mock(settings, extra)
    render(<Settings />)
    await screen.findByRole('button', { name: 'Models' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    open('Source priority')
    await screen.findByRole('list', { name: /Source priority/ })
    return fetchMock
  }

  it('is a working screen, not Coming soon, and shows the default order', async () => {
    await openIt(data(true))
    expect(names()).toEqual(DEFAULT)
    expect(screen.queryByText(/Coming soon. Being built by Chris.*/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move National code up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move International standard down' })).toBeDisabled()
  })

  it('shows an icon for each source type', async () => {
    await openIt(data(true))
    const icons = screen
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.st-tier-icon')?.getAttribute('data-icon'))
    expect(icons).toEqual(['landmark', 'factory', 'briefcase', 'globe'])
  })

  it('highlights the row that moved, announces its new place, and clears the highlight', async () => {
    await openIt(data(true))
    fireEvent.click(screen.getByRole('button', { name: 'Move Marsh precedent up' }))
    const moved = screen.getAllByRole('listitem').filter((li) => li.classList.contains('is-moved'))
    expect(moved).toHaveLength(1)
    expect(moved[0]).toHaveTextContent('Marsh precedent')
    expect(screen.getByRole('status')).toHaveTextContent('Marsh precedent moved to position 2 of 4')
    await waitFor(() => expect(document.querySelector('.is-moved')).toBeNull(), { timeout: 3000 })
  })

  it('says a national code ranks only when the question names its country', async () => {
    await openIt(data(true))
    expect(screen.getByText(/ranks only when the question names its country/)).toBeInTheDocument()
  })

  it('shows no drag grips to an engineer, and no Saved tick beside an unsaved change', async () => {
    await openIt(data(false))
    expect(screen.queryAllByTestId('tier-handle')).toHaveLength(0)
    cleanup()
    const after: SettingsData = {
      ...data(true),
      sourcePriority: {
        ...data(true).sourcePriority,
        order: [
          'manufacturer_rating',
          'national_code',
          'marsh_precedent',
          'international_standard',
        ],
      },
    }
    await openIt(data(true), (_u, init) => (init?.method === 'PUT' ? reply(200, after) : null))
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }))
    await screen.findByText('Saved')
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('moves a tier down and up with the buttons', async () => {
    await openIt(data(true))
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    expect(names().slice(0, 2)).toEqual(['Manufacturer rating', 'National code'])
    fireEvent.click(screen.getByRole('button', { name: 'Move National code up' }))
    expect(names()).toEqual(DEFAULT)
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled()
  })

  it('saves the new order with a PUT and shows the saved history', async () => {
    const after: SettingsData = {
      ...data(true),
      sourcePriority: {
        order: [
          'manufacturer_rating',
          'national_code',
          'marsh_precedent',
          'international_standard',
        ],
        history: [
          {
            at: '2026-11-01T06:05:00.000Z',
            by: { id: 'a1', name: 'Ada Admin' },
            before: [...TIER_IDS],
            after: [
              'manufacturer_rating',
              'national_code',
              'marsh_precedent',
              'international_standard',
            ],
          },
        ],
      },
    }
    const fetchMock = await openIt(data(true), (_u, init) =>
      init?.method === 'PUT' ? reply(200, after) : null,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/settings/source-priority')
    expect(put[1]?.body).toBe(JSON.stringify({ order: after.sourcePriority.order }))
    expect(screen.getByText(/Ada Admin: National code, Manufacturer rating/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled()
  })

  it('reorders by dragging a row onto another', async () => {
    await openIt(data(true))
    const items = screen.getAllByRole('listitem')
    fireEvent.dragStart(items[0])
    fireEvent.dragOver(items[2])
    fireEvent.drop(items[2])
    expect(names()).toEqual([
      'Manufacturer rating',
      'Marsh precedent',
      'National code',
      'International standard',
    ])
    expect(screen.getByRole('button', { name: 'Save order' })).toBeEnabled()
  })

  it('shows a failed save with its reason', async () => {
    await openIt(data(true), (_u, init) =>
      init?.method === 'PUT' ? reply(400, { error: 'Order must list every tier once.' }) : null,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Order must list every tier once.')
  })

  it('is read-only for an engineer, who still sees the history', async () => {
    const withHistory: SettingsData = {
      ...data(false),
      sourcePriority: {
        order: [...TIER_IDS],
        history: [
          {
            at: '2026-11-01T06:05:00.000Z',
            by: { id: 'a1', name: 'Ada Admin' },
            before: ['marsh_precedent', ...TIER_IDS.filter((t) => t !== 'marsh_precedent')],
            after: [...TIER_IDS],
          },
        ],
      },
    }
    await openIt(withHistory)
    expect(screen.getByText('Set by an admin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save order' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Move National code down' })).toBeDisabled()
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false')
    expect(screen.getByText(/Ada Admin: Marsh precedent, National code/)).toBeInTheDocument()
  })

  it('says there are no changes yet', async () => {
    await openIt(data(true))
    expect(screen.getByText('No changes yet.')).toBeInTheDocument()
  })
})

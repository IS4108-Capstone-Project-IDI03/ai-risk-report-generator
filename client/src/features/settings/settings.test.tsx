// Tests for the Settings screen (S-01). Fetch is mocked; no gateway or paid call.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption, ModelRowData, Settings as SettingsData } from './api'
import { Settings } from './Settings'
import { TIER_IDS } from './tiers'

// A good save is a toast; the real one needs the app's Toaster, so the tests watch the calls.
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: toasts,
}))

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
  vi.clearAllMocks()
})
// A changeable control is not aria-disabled; one that is not, stays focusable (never native disabled).
const isGreyed = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true'

describe('Settings', () => {
  it('shows every section to an engineer and an admin', async () => {
    for (const edit of [false, true]) {
      mock(data(edit))
      render(<Settings />)
      for (const name of [
        'Password',
        'Models',
        'QA Eval',
        'Chat and Voice',
        'Checklist',
        'Source Priority',
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
    open('QA Eval')
    expect(screen.getByText('Coming soon. Being built by Chris.')).toBeInTheDocument()
    // One quiet line, under the title: no second name and no card of its own.
    expect(screen.getAllByText('QA Eval')).toHaveLength(2) // the menu item and the title
    expect(document.querySelector('.st-soon')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('keeps what only an admin can change in its own Set by admin group of the menu', async () => {
    mock(data(false))
    render(<Settings />)
    const menu = screen.getByRole('navigation', { name: 'Settings sections' })
    const group = (heading: string) => within(menu).getByText(heading).parentElement!
    const names = (el: HTMLElement) =>
      within(el)
        .getAllByRole('button')
        .map((b) => b.textContent)
    expect(names(group('Set by admin'))).toEqual(['Models', 'Source Priority', 'Checklist'])
    expect(names(group('Coming soon'))).toEqual(['QA Eval'])
    // What a person sets for themselves has no heading and comes first.
    const personal = menu.firstElementChild as HTMLElement
    expect(names(personal)).toEqual(['Password', 'Chat and Voice', 'Walkthroughs'])
    expect(within(personal).queryByText('Set by admin')).toBeNull()
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

  it('closes when the open box is pressed again, even though Safari blurs it before the click', async () => {
    mock(data(true))
    render(<Settings />)
    open('Models')
    const box = await screen.findByRole('combobox', { name: 'Drafting' })
    fireEvent.click(box)
    expect(box).toHaveAttribute('aria-expanded', 'true')
    // What Safari does on a press: pointerdown, then the button loses focus, then the click.
    fireEvent.pointerDown(box)
    fireEvent.blur(box, { relatedTarget: null })
    fireEvent.click(box)
    expect(box).toHaveAttribute('aria-expanded', 'false')
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
    expect(toasts.success).toHaveBeenCalledWith('Model saved')
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
    expect(isGreyed(box)).toBe(true)
    expect(box).toHaveTextContent('a:one (recommended)')
  })

  it('makes engineer controls read-only', async () => {
    mock(data(false))
    render(<Settings />)
    open('Models')
    const box = await screen.findByRole('combobox', { name: 'Drafting' })
    // Greyed but still reachable by keyboard, and it never opens.
    expect(isGreyed(box)).toBe(true)
    expect(box).not.toBeDisabled()
    fireEvent.click(box)
    expect(screen.queryByRole('listbox')).toBeNull()
    // The chip is said once, in the title bar.
    expect(screen.getAllByText('Set by an admin')).toHaveLength(1)
    expect(document.querySelector('.st-titlebar-end')).toHaveTextContent('Set by an admin')
  })

  it('points aria-controls at the list only while it is open', async () => {
    mock(data(true))
    render(<Settings />)
    open('Models')
    const box = await screen.findByRole('combobox', { name: 'Drafting' })
    expect(box).not.toHaveAttribute('aria-controls')
    fireEvent.click(box)
    expect(box.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
  })

  it('shows the memory switch from the chat API', async () => {
    mock(data(false))
    render(<Settings />)
    open('Chat and Voice')
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  })

  it('treats the memory switch like the walkthroughs one: no toast on a change, an error toast on a failure', async () => {
    let fail = false
    mock(data(false), (url, init) =>
      url === '/api/chat/memory' && init?.method === 'PATCH'
        ? fail
          ? reply(500, { error: 'down' })
          : reply(200, { enabled: false, facts: [], maxFacts: 5, maxChars: 200 })
        : null,
    )
    render(<Settings />)
    open('Chat and Voice')
    const memory = await screen.findByRole('switch', { name: 'Remember facts about me in chat' })
    await waitFor(() => expect(memory).toBeChecked())
    fireEvent.click(memory)
    await waitFor(() => expect(memory).not.toBeChecked())
    expect(toasts.success).not.toHaveBeenCalled()
    fail = true
    fireEvent.click(memory)
    await waitFor(() => expect(toasts.error).toHaveBeenCalledOnce())
  })

  it('shows Set by an admin beside the transcription setting only, not in the title bar', async () => {
    const whisper = row('transcription', { label: 'Voice transcription', fixed: true })
    mock(data(false, [whisper]))
    render(<Settings />)
    open('Chat and Voice')
    await screen.findByRole('combobox', { name: 'Voice transcription' })
    expect(screen.getAllByText('Set by an admin')).toHaveLength(1)
    expect(document.querySelector('.st-titlebar-end')).toBeEmptyDOMElement()
  })

  it('changes the password with a toast, clears the boxes, and names the boxes for password managers', async () => {
    const fetchMock = mock(data(false), (url) =>
      url === '/api/auth/change-password' ? reply(200, { message: 'ok' }) : null,
    )
    render(<Settings />)
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeInTheDocument()
    const current = screen.getByLabelText('Current password')
    const next = screen.getByLabelText('New password')
    expect(current).toHaveAttribute('autocomplete', 'current-password')
    expect(next).toHaveAttribute('autocomplete', 'new-password')
    fireEvent.change(current, { target: { value: 'old1' } })
    fireEvent.change(next, { target: { value: 'newer1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Password changed'))
    expect(current).toHaveValue('')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/change-password')).toBe(true)
    expect(screen.queryByText('Password changed')).toBeNull()
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
    expect(within(soon).getByRole('button', { name: 'QA Eval' })).toBeInTheDocument()
    open('QA Eval')
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
    open('Chat and Voice')
    expect(isGreyed(screen.getByRole('combobox', { name: 'Voice transcription' }))).toBe(true)
  })
})

describe('Settings: tasks nothing reads yet', () => {
  it("puts them in their own greyed-out section at the bottom, labelled Can't be changed yet", async () => {
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
    const heading = await screen.findByRole('heading', { name: "Can't be changed yet" })
    expect(screen.getAllByText(/Can't be changed yet/)).toHaveLength(1)
    const before = (el: HTMLElement) =>
      Boolean(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
    // The working task is above the heading; the unused ones are below it, disabled.
    expect(before(screen.getByRole('combobox', { name: 'Drafting' }))).toBe(true)
    for (const name of ['OCR', 'QA']) {
      const box = screen.getByRole('combobox', { name })
      expect(before(box)).toBe(false)
      expect(isGreyed(box)).toBe(true)
    }
    expect(isGreyed(screen.getByRole('combobox', { name: 'Drafting' }))).toBe(false)
  })

  it("shows no Can't be changed yet section when every task is in use", async () => {
    mock({ ...data(true), models: [row('Drafting')] })
    render(<Settings />)
    open('Models')
    await screen.findByRole('combobox', { name: 'Drafting' })
    expect(screen.queryByRole('heading', { name: "Can't be changed yet" })).toBeNull()
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
    open('Source Priority')
    await screen.findByRole('list', { name: /Source priority/ })
    return fetchMock
  }

  it('is a working screen, not Coming soon, and shows the default order', async () => {
    await openIt(data(true))
    expect(names()).toEqual(DEFAULT)
    expect(screen.queryByText(/Coming soon. Being built by Chris.*/)).toBeNull()
    // Greyed with its reason, not hidden: hover or focus says what to do first.
    expect(isGreyed(screen.getByRole('button', { name: 'Save order' }))).toBe(true)
    expect(screen.getByRole('button', { name: 'Save order' })).toHaveAccessibleDescription(
      'No changes. Move a source, then save.',
    )
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

  it('shows no drag grips or move buttons to an engineer, and no toast for an unsaved change', async () => {
    await openIt(data(false))
    expect(screen.queryAllByTestId('tier-handle')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
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
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Order saved'))
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    expect(toasts.success).toHaveBeenCalledTimes(1)
  })

  it('moves a tier down and up with the buttons', async () => {
    await openIt(data(true))
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    expect(names().slice(0, 2)).toEqual(['Manufacturer rating', 'National code'])
    fireEvent.click(screen.getByRole('button', { name: 'Move National code up' }))
    expect(names()).toEqual(DEFAULT)
    expect(isGreyed(screen.getByRole('button', { name: 'Save order' }))).toBe(true)
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
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Order saved'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/settings/source-priority')
    expect(put[1]?.body).toBe(JSON.stringify({ order: after.sourcePriority.order }))
    expect(screen.getByText(/Ada Admin: National code, Manufacturer rating/)).toBeInTheDocument()
    expect(isGreyed(screen.getByRole('button', { name: 'Save order' }))).toBe(true)
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
    expect(isGreyed(screen.getByRole('button', { name: 'Save order' }))).toBe(false)
  })

  it('shows a failed save with its reason', async () => {
    await openIt(data(true), (_u, init) =>
      init?.method === 'PUT' ? reply(400, { error: 'Order must list every tier once.' }) : null,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move National code down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Order must list every tier once.')
    expect(toasts.success).not.toHaveBeenCalled()
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
    expect(screen.queryByRole('button', { name: 'Move National code down' })).toBeNull()
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false')
    expect(screen.getByText(/Ada Admin: Marsh precedent, National code/)).toBeInTheDocument()
  })

  it('says there are no changes yet', async () => {
    await openIt(data(true))
    expect(screen.getByText('No changes yet.')).toBeInTheDocument()
  })
})
